from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError, field_validator


UTC = timezone.utc


class RecallStatus(str, Enum):
    NONE = "none"
    WATCH = "watch"
    ACTIVE = "active"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RecommendedAction(str, Enum):
    TRANSFER_INVENTORY = "transfer_inventory"
    QUARANTINE_LOT = "quarantine_lot"
    NOTIFY_PHARMACIST = "notify_pharmacist"
    REQUEST_HUMAN_APPROVAL = "request_human_approval"
    UPDATE_REORDER_RULES = "update_reorder_rules"
    HOLD = "hold"


class PolicyStatus(str, Enum):
    ALLOW = "allow"
    BLOCK = "block"
    ESCALATE = "escalate"


class TemperatureReading(BaseModel):
    timestamp: datetime
    celsius: float


class MedicationLot(BaseModel):
    lot_id: str = Field(..., min_length=1)
    medication_name: str = Field(..., min_length=1)
    ndc: str = Field(..., min_length=1)
    location_id: str = Field(..., min_length=1)
    location_name: str = Field(default="Unknown")
    quantity: int = Field(..., ge=0)
    expiration_date: date
    demand_7d: int = Field(..., ge=0)
    demand_30d: int = Field(..., ge=0)
    recall_status: RecallStatus = RecallStatus.NONE
    temperature_logs: list[TemperatureReading] = Field(default_factory=list)
    storage_min_c: float = 2.0
    storage_max_c: float = 8.0
    unit_value_usd: float = Field(..., ge=0)
    controlled_substance: bool = False

    @field_validator("temperature_logs")
    @classmethod
    def sort_temperature_logs(
        cls, logs: list[TemperatureReading]
    ) -> list[TemperatureReading]:
        return sorted(logs, key=lambda reading: reading.timestamp)

    @property
    def lot_value_usd(self) -> float:
        return round(self.quantity * self.unit_value_usd, 2)

    @property
    def days_until_expiration(self) -> int:
        return (self.expiration_date - date.today()).days

    @property
    def daily_demand(self) -> float:
        return self.demand_30d / 30 if self.demand_30d else self.demand_7d / 7

    @property
    def projected_days_to_deplete(self) -> float | None:
        if self.daily_demand <= 0:
            return None
        return self.quantity / self.daily_demand

    @property
    def has_temperature_excursion(self) -> bool:
        return any(
            reading.celsius < self.storage_min_c or reading.celsius > self.storage_max_c
            for reading in self.temperature_logs
        )


class IngestionBatch(BaseModel):
    source: str = "api"
    lots: list[MedicationLot]


class AgentRunRequest(BaseModel):
    source: str = "api"
    lots: list[MedicationLot] | None = None
    use_live_source: bool = False


class AgentRecommendation(BaseModel):
    risk_level: RiskLevel
    recommended_action: RecommendedAction
    rationale: str
    safety_concern: bool = False
    compliance_concern: bool = False
    confidence: float = Field(default=0.75, ge=0, le=1)
    model: str


class PolicyDecision(BaseModel):
    status: PolicyStatus
    reason: str
    allowed_tools: list[RecommendedAction] = Field(default_factory=list)
    blocked_tools: list[RecommendedAction] = Field(default_factory=list)
    required_tools: list[RecommendedAction] = Field(default_factory=list)


class ToolCallResult(BaseModel):
    tool_name: RecommendedAction
    status: Literal["executed", "skipped", "failed"]
    payload: dict[str, Any]
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class LotEvaluation(BaseModel):
    lot: MedicationLot
    recommendation: AgentRecommendation
    policy: PolicyDecision
    tool_calls: list[ToolCallResult]


class AgentRunResponse(BaseModel):
    run_id: str
    created_at: datetime
    source: str
    model_roles: dict[str, str]
    evaluations: list[LotEvaluation]
    recurring_waste_patterns: list[dict[str, Any]]


def now_utc() -> datetime:
    return datetime.now(UTC)


def json_dumps(data: Any) -> str:
    return json.dumps(data, default=str, separators=(",", ":"))


@dataclass(frozen=True)
class AgentSettings:
    nvidia_api_key: str | None
    nvidia_base_url: str
    triage_model: str
    compliance_model: str
    pattern_model: str
    pharmacy_data_url: str | None
    database_path: Path
    high_value_threshold_usd: float
    mock_nemotron: bool
    request_timeout_s: float

    @classmethod
    def from_env(cls) -> "AgentSettings":
        db_path = Path(
            os.getenv("AGENT_DB_PATH", "/tmp/medflow_pharmacy_agent.sqlite3")
        )
        return cls(
            nvidia_api_key=os.getenv("NVIDIA_API_KEY"),
            nvidia_base_url=os.getenv(
                "NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"
            ).rstrip("/"),
            triage_model=os.getenv(
                "NEMOTRON_TRIAGE_MODEL",
                "nvidia/llama-3.1-nemotron-70b-instruct",
            ),
            compliance_model=os.getenv(
                "NEMOTRON_COMPLIANCE_MODEL",
                "nvidia/llama-3.1-nemotron-nano-8b-v1",
            ),
            pattern_model=os.getenv(
                "NEMOTRON_PATTERN_MODEL",
                "nvidia/llama-3.1-nemotron-nano-8b-v1",
            ),
            pharmacy_data_url=os.getenv("PHARMACY_DATA_URL"),
            database_path=db_path,
            high_value_threshold_usd=float(
                os.getenv("HIGH_VALUE_THRESHOLD_USD", "5000")
            ),
            mock_nemotron=os.getenv("MOCK_NEMOTRON", "").lower()
            in {"1", "true", "yes"},
            request_timeout_s=float(os.getenv("NVIDIA_REQUEST_TIMEOUT_S", "30")),
        )


class MemoryStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS agent_runs (
                    run_id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    model_roles_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS lot_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    lot_id TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    observation_json TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES agent_runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS recommendations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    lot_id TEXT NOT NULL,
                    recommendation_json TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES agent_runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS policy_decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    lot_id TEXT NOT NULL,
                    decision_json TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES agent_runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS tool_calls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    lot_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES agent_runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS waste_patterns (
                    pattern_key TEXT PRIMARY KEY,
                    medication_name TEXT NOT NULL,
                    location_id TEXT NOT NULL,
                    occurrence_count INTEGER NOT NULL,
                    latest_lot_id TEXT NOT NULL,
                    latest_signal TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def record_run(
        self, run_id: str, created_at: datetime, source: str, model_roles: dict[str, str]
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO agent_runs (run_id, created_at, source, model_roles_json)
                VALUES (?, ?, ?, ?)
                """,
                (run_id, created_at.isoformat(), source, json_dumps(model_roles)),
            )

    def record_lot_evaluation(self, run_id: str, evaluation: LotEvaluation) -> None:
        lot = evaluation.lot
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO lot_observations
                    (run_id, lot_id, observed_at, observation_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    run_id,
                    lot.lot_id,
                    now_utc().isoformat(),
                    lot.model_dump_json(),
                ),
            )
            conn.execute(
                """
                INSERT INTO recommendations
                    (run_id, lot_id, recommendation_json)
                VALUES (?, ?, ?)
                """,
                (
                    run_id,
                    lot.lot_id,
                    evaluation.recommendation.model_dump_json(),
                ),
            )
            conn.execute(
                """
                INSERT INTO policy_decisions
                    (run_id, lot_id, decision_json)
                VALUES (?, ?, ?)
                """,
                (run_id, lot.lot_id, evaluation.policy.model_dump_json()),
            )
            for tool_call in evaluation.tool_calls:
                conn.execute(
                    """
                    INSERT INTO tool_calls
                        (
                            run_id,
                            lot_id,
                            tool_name,
                            status,
                            payload_json,
                            result_json,
                            created_at
                        )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        lot.lot_id,
                        tool_call.tool_name.value,
                        tool_call.status,
                        json_dumps(tool_call.payload),
                        json_dumps(tool_call.result | {"error": tool_call.error}),
                        now_utc().isoformat(),
                    ),
                )
            self._upsert_pattern(conn, lot, evaluation)

    def _upsert_pattern(
        self, conn: sqlite3.Connection, lot: MedicationLot, evaluation: LotEvaluation
    ) -> None:
        signals: list[str] = []
        if lot.days_until_expiration <= 30 and (
            lot.projected_days_to_deplete is None
            or lot.projected_days_to_deplete > lot.days_until_expiration
        ):
            signals.append("near_expiration_low_demand")
        if evaluation.policy.status == PolicyStatus.BLOCK:
            signals.append("blocked_safety_or_recall")
        if evaluation.policy.status == PolicyStatus.ESCALATE:
            signals.append("approval_required_high_value_or_controlled")
        if not signals:
            return

        pattern_key = f"{lot.medication_name.lower()}:{lot.location_id}"
        existing = conn.execute(
            "SELECT occurrence_count FROM waste_patterns WHERE pattern_key = ?",
            (pattern_key,),
        ).fetchone()
        occurrence_count = int(existing["occurrence_count"]) + 1 if existing else 1
        conn.execute(
            """
            INSERT INTO waste_patterns (
                pattern_key,
                medication_name,
                location_id,
                occurrence_count,
                latest_lot_id,
                latest_signal,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pattern_key) DO UPDATE SET
                occurrence_count = excluded.occurrence_count,
                latest_lot_id = excluded.latest_lot_id,
                latest_signal = excluded.latest_signal,
                updated_at = excluded.updated_at
            """,
            (
                pattern_key,
                lot.medication_name,
                lot.location_id,
                occurrence_count,
                lot.lot_id,
                ",".join(signals),
                now_utc().isoformat(),
            ),
        )

    def recent_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT run_id, created_at, source, model_roles_json
                FROM agent_runs
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "run_id": row["run_id"],
                "created_at": row["created_at"],
                "source": row["source"],
                "model_roles": json.loads(row["model_roles_json"]),
            }
            for row in rows
        ]

    def run_detail(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            run = conn.execute(
                """
                SELECT run_id, created_at, source, model_roles_json
                FROM agent_runs WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if not run:
                return None
            observations = conn.execute(
                """
                SELECT lot_id, observation_json FROM lot_observations
                WHERE run_id = ? ORDER BY id
                """,
                (run_id,),
            ).fetchall()
            recommendations = conn.execute(
                """
                SELECT lot_id, recommendation_json FROM recommendations
                WHERE run_id = ? ORDER BY id
                """,
                (run_id,),
            ).fetchall()
            decisions = conn.execute(
                """
                SELECT lot_id, decision_json FROM policy_decisions
                WHERE run_id = ? ORDER BY id
                """,
                (run_id,),
            ).fetchall()
            tool_calls = conn.execute(
                """
                SELECT lot_id, tool_name, status, payload_json, result_json, created_at
                FROM tool_calls WHERE run_id = ? ORDER BY id
                """,
                (run_id,),
            ).fetchall()
        return {
            "run_id": run["run_id"],
            "created_at": run["created_at"],
            "source": run["source"],
            "model_roles": json.loads(run["model_roles_json"]),
            "observations": [
                {"lot_id": row["lot_id"], "data": json.loads(row["observation_json"])}
                for row in observations
            ],
            "recommendations": [
                {
                    "lot_id": row["lot_id"],
                    "data": json.loads(row["recommendation_json"]),
                }
                for row in recommendations
            ],
            "policy_decisions": [
                {"lot_id": row["lot_id"], "data": json.loads(row["decision_json"])}
                for row in decisions
            ],
            "tool_calls": [
                {
                    "lot_id": row["lot_id"],
                    "tool_name": row["tool_name"],
                    "status": row["status"],
                    "payload": json.loads(row["payload_json"]),
                    "result": json.loads(row["result_json"]),
                    "created_at": row["created_at"],
                }
                for row in tool_calls
            ],
        }

    def patterns(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    pattern_key,
                    medication_name,
                    location_id,
                    occurrence_count,
                    latest_lot_id,
                    latest_signal,
                    updated_at
                FROM waste_patterns
                ORDER BY occurrence_count DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]


class DataIngestionLayer:
    def __init__(self, settings: AgentSettings):
        self.settings = settings

    async def pull_live_data(self) -> list[MedicationLot]:
        if not self.settings.pharmacy_data_url:
            return sample_lots()
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.get(self.settings.pharmacy_data_url)
            response.raise_for_status()
        payload = response.json()
        lots_payload = payload["lots"] if isinstance(payload, dict) else payload
        try:
            return [MedicationLot.model_validate(item) for item in lots_payload]
        except ValidationError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "Live pharmacy data source returned invalid lot data",
                    "errors": exc.errors(),
                },
            ) from exc


class NemotronClient:
    def __init__(self, settings: AgentSettings):
        self.settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self.settings.nvidia_api_key) and not self.settings.mock_nemotron

    async def complete_json(
        self,
        *,
        model: str,
        system_prompt: str,
        user_payload: dict[str, Any],
        fallback: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.enabled:
            return fallback | {"model": f"{model} (local-fallback)"}

        request_payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        "Return strict JSON only. Analyze this payload:\n"
                        f"{json_dumps(user_payload)}"
                    ),
                },
            ],
            "temperature": 0.1,
            "top_p": 0.9,
            "max_tokens": 700,
        }
        headers = {
            "Authorization": f"Bearer {self.settings.nvidia_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(
                f"{self.settings.nvidia_base_url}/chat/completions",
                headers=headers,
                json=request_payload,
            )
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start == -1 or end == -1:
                raise
            parsed = json.loads(content[start : end + 1])
        return parsed | {"model": model}


class NemotronReasoningAgent:
    def __init__(self, settings: AgentSettings):
        self.settings = settings
        self.client = NemotronClient(settings)

    async def evaluate_lot(self, lot: MedicationLot) -> AgentRecommendation:
        triage_fallback = self._heuristic_recommendation(lot)
        triage_task = self.client.complete_json(
            model=self.settings.triage_model,
            system_prompt=(
                "You are a Nemotron pharmacy inventory reasoning agent. Decide the "
                "risk level and best medication-saving action for a medication lot. "
                "Use one of these actions: transfer_inventory, quarantine_lot, "
                "notify_pharmacist, request_human_approval, update_reorder_rules, hold."
            ),
            user_payload={"lot": lot.model_dump(mode="json")},
            fallback=triage_fallback,
        )
        compliance_task = self.client.complete_json(
            model=self.settings.compliance_model,
            system_prompt=(
                "You are a Nemotron medication safety and compliance reviewer. "
                "Return JSON with safety_concern, compliance_concern, and rationale."
            ),
            user_payload={"lot": lot.model_dump(mode="json")},
            fallback=self._heuristic_compliance(lot),
        )
        triage, compliance = await asyncio.gather(triage_task, compliance_task)
        merged = {
            **triage,
            "safety_concern": bool(
                triage.get("safety_concern") or compliance.get("safety_concern")
            ),
            "compliance_concern": bool(
                triage.get("compliance_concern")
                or compliance.get("compliance_concern")
            ),
            "rationale": (
                f"{triage.get('rationale', 'No rationale returned')} "
                f"Compliance review: {compliance.get('rationale', 'not provided')}"
            ).strip(),
            "model": (
                f"triage={triage.get('model', self.settings.triage_model)}; "
                f"compliance={compliance.get('model', self.settings.compliance_model)}"
            ),
        }
        try:
            return AgentRecommendation.model_validate(merged)
        except ValidationError:
            return AgentRecommendation.model_validate(
                triage_fallback
                | {
                    "safety_concern": bool(compliance.get("safety_concern")),
                    "compliance_concern": bool(compliance.get("compliance_concern")),
                    "model": merged["model"],
                }
            )

    def _heuristic_recommendation(self, lot: MedicationLot) -> dict[str, Any]:
        if lot.recall_status == RecallStatus.ACTIVE or lot.has_temperature_excursion:
            return {
                "risk_level": RiskLevel.CRITICAL.value,
                "recommended_action": RecommendedAction.QUARANTINE_LOT.value,
                "rationale": (
                    "Lot has an active recall or temperature excursion; containment "
                    "and pharmacist review are required before any waste-saving move."
                ),
                "safety_concern": True,
                "compliance_concern": True,
                "confidence": 0.95,
                "model": self.settings.triage_model,
            }

        days_left = lot.days_until_expiration
        projected = lot.projected_days_to_deplete
        cannot_deplete_before_expiry = projected is None or projected > days_left
        if lot.controlled_substance or lot.lot_value_usd >= self.settings.high_value_threshold_usd:
            return {
                "risk_level": RiskLevel.HIGH.value,
                "recommended_action": RecommendedAction.REQUEST_HUMAN_APPROVAL.value,
                "rationale": (
                    "Lot is high-value or controlled; autonomous transfer/reorder "
                    "changes require pharmacist approval."
                ),
                "safety_concern": False,
                "compliance_concern": lot.controlled_substance,
                "confidence": 0.88,
                "model": self.settings.triage_model,
            }
        if days_left <= 30 and cannot_deplete_before_expiry:
            return {
                "risk_level": RiskLevel.MEDIUM.value,
                "recommended_action": RecommendedAction.TRANSFER_INVENTORY.value,
                "rationale": (
                    "Demand is unlikely to consume the lot before expiration; transfer "
                    "to a higher-demand location can prevent waste."
                ),
                "safety_concern": False,
                "compliance_concern": False,
                "confidence": 0.82,
                "model": self.settings.triage_model,
            }
        if lot.demand_30d == 0 and lot.quantity > 0:
            return {
                "risk_level": RiskLevel.MEDIUM.value,
                "recommended_action": RecommendedAction.UPDATE_REORDER_RULES.value,
                "rationale": "No recent demand; reorder thresholds should be reduced.",
                "safety_concern": False,
                "compliance_concern": False,
                "confidence": 0.78,
                "model": self.settings.triage_model,
            }
        return {
            "risk_level": RiskLevel.LOW.value,
            "recommended_action": RecommendedAction.HOLD.value,
            "rationale": "Lot appears safe and current demand can consume inventory.",
            "safety_concern": False,
            "compliance_concern": False,
            "confidence": 0.72,
            "model": self.settings.triage_model,
        }

    def _heuristic_compliance(self, lot: MedicationLot) -> dict[str, Any]:
        if lot.recall_status == RecallStatus.ACTIVE:
            return {
                "safety_concern": True,
                "compliance_concern": True,
                "rationale": "Active recall blocks autonomous use or transfer.",
                "model": self.settings.compliance_model,
            }
        if lot.has_temperature_excursion:
            return {
                "safety_concern": True,
                "compliance_concern": True,
                "rationale": "Temperature excursion requires quarantine and review.",
                "model": self.settings.compliance_model,
            }
        if lot.controlled_substance:
            return {
                "safety_concern": False,
                "compliance_concern": True,
                "rationale": "Controlled substance handling requires human approval.",
                "model": self.settings.compliance_model,
            }
        return {
            "safety_concern": False,
            "compliance_concern": False,
            "rationale": "No recall, temperature, or controlled-substance concern found.",
            "model": self.settings.compliance_model,
        }


class NemoClawPolicyLayer:
    def __init__(self, high_value_threshold_usd: float):
        self.high_value_threshold_usd = high_value_threshold_usd

    def evaluate(
        self, lot: MedicationLot, recommendation: AgentRecommendation
    ) -> PolicyDecision:
        recommended = recommendation.recommended_action
        if lot.recall_status == RecallStatus.ACTIVE:
            return PolicyDecision(
                status=PolicyStatus.BLOCK,
                reason="Active recall blocks autonomous inventory-saving actions.",
                blocked_tools=[recommended],
                required_tools=[
                    RecommendedAction.QUARANTINE_LOT,
                    RecommendedAction.NOTIFY_PHARMACIST,
                ],
            )
        if lot.has_temperature_excursion:
            return PolicyDecision(
                status=PolicyStatus.BLOCK,
                reason="Temperature excursion blocks autonomous use or transfer.",
                blocked_tools=[recommended],
                required_tools=[
                    RecommendedAction.QUARANTINE_LOT,
                    RecommendedAction.NOTIFY_PHARMACIST,
                ],
            )
        if (
            lot.controlled_substance
            or lot.lot_value_usd >= self.high_value_threshold_usd
            or recommendation.compliance_concern
        ):
            return PolicyDecision(
                status=PolicyStatus.ESCALATE,
                reason=(
                    "High-value, controlled, or compliance-sensitive medication "
                    "requires pharmacist approval."
                ),
                blocked_tools=[recommended],
                required_tools=[RecommendedAction.REQUEST_HUMAN_APPROVAL],
            )
        if recommendation.safety_concern:
            return PolicyDecision(
                status=PolicyStatus.BLOCK,
                reason="Nemotron flagged a safety concern.",
                blocked_tools=[recommended],
                required_tools=[RecommendedAction.NOTIFY_PHARMACIST],
            )
        allowed = [] if recommended == RecommendedAction.HOLD else [recommended]
        return PolicyDecision(
            status=PolicyStatus.ALLOW,
            reason="Safe, low-risk autonomous action.",
            allowed_tools=allowed,
        )


class OpenClawToolExecutionLayer:
    def __init__(self) -> None:
        self._handlers = {
            RecommendedAction.TRANSFER_INVENTORY: self.transfer_inventory,
            RecommendedAction.QUARANTINE_LOT: self.quarantine_lot,
            RecommendedAction.NOTIFY_PHARMACIST: self.notify_pharmacist,
            RecommendedAction.REQUEST_HUMAN_APPROVAL: self.request_human_approval,
            RecommendedAction.UPDATE_REORDER_RULES: self.update_reorder_rules,
        }

    async def execute(
        self, lot: MedicationLot, recommendation: AgentRecommendation, policy: PolicyDecision
    ) -> list[ToolCallResult]:
        calls: list[ToolCallResult] = []
        executable = list(dict.fromkeys(policy.allowed_tools + policy.required_tools))
        if not executable and policy.status == PolicyStatus.ALLOW:
            return [
                ToolCallResult(
                    tool_name=RecommendedAction.HOLD,
                    status="skipped",
                    payload={"lot_id": lot.lot_id},
                    result={"message": "No tool call needed; continue monitoring."},
                )
            ]
        for tool_name in executable:
            handler = self._handlers.get(tool_name)
            payload = self._payload_for(tool_name, lot, recommendation, policy)
            if not handler:
                calls.append(
                    ToolCallResult(
                        tool_name=tool_name,
                        status="skipped",
                        payload=payload,
                        error="No OpenClaw handler registered for tool.",
                    )
                )
                continue
            try:
                result = await handler(payload)
                calls.append(
                    ToolCallResult(
                        tool_name=tool_name,
                        status="executed",
                        payload=payload,
                        result=result,
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive tool boundary
                calls.append(
                    ToolCallResult(
                        tool_name=tool_name,
                        status="failed",
                        payload=payload,
                        error=str(exc),
                    )
                )
        return calls

    def _payload_for(
        self,
        tool_name: RecommendedAction,
        lot: MedicationLot,
        recommendation: AgentRecommendation,
        policy: PolicyDecision,
    ) -> dict[str, Any]:
        common = {
            "lot_id": lot.lot_id,
            "medication_name": lot.medication_name,
            "location_id": lot.location_id,
            "policy_status": policy.status.value,
            "reason": policy.reason,
        }
        if tool_name == RecommendedAction.TRANSFER_INVENTORY:
            return common | {
                "quantity": lot.quantity,
                "target": "highest-demand-nearby-pharmacy",
                "expires_in_days": lot.days_until_expiration,
            }
        if tool_name == RecommendedAction.UPDATE_REORDER_RULES:
            return common | {
                "suggested_min_stock": max(0, lot.demand_30d // 2),
                "current_quantity": lot.quantity,
            }
        if tool_name == RecommendedAction.REQUEST_HUMAN_APPROVAL:
            return common | {
                "lot_value_usd": lot.lot_value_usd,
                "controlled_substance": lot.controlled_substance,
                "recommended_action": recommendation.recommended_action.value,
            }
        return common

    async def transfer_inventory(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "transfer_id": f"tr-{uuid.uuid4().hex[:10]}",
            "status": "queued",
            "target": payload["target"],
        }

    async def quarantine_lot(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "quarantine_id": f"qa-{uuid.uuid4().hex[:10]}",
            "status": "quarantined",
        }

    async def notify_pharmacist(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "notification_id": f"nt-{uuid.uuid4().hex[:10]}",
            "status": "sent",
        }

    async def request_human_approval(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "approval_request_id": f"ap-{uuid.uuid4().hex[:10]}",
            "status": "pending",
        }

    async def update_reorder_rules(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "rule_update_id": f"rr-{uuid.uuid4().hex[:10]}",
            "status": "staged",
            "suggested_min_stock": payload["suggested_min_stock"],
        }


class PharmacyAgentService:
    def __init__(self, settings: AgentSettings):
        self.settings = settings
        self.ingestion = DataIngestionLayer(settings)
        self.reasoning = NemotronReasoningAgent(settings)
        self.policy = NemoClawPolicyLayer(settings.high_value_threshold_usd)
        self.tools = OpenClawToolExecutionLayer()
        self.memory = MemoryStore(settings.database_path)

    @property
    def model_roles(self) -> dict[str, str]:
        return {
            "triage": self.settings.triage_model,
            "compliance": self.settings.compliance_model,
            "patterns": self.settings.pattern_model,
        }

    async def ingest_lots(self, batch: IngestionBatch) -> dict[str, Any]:
        run_id = f"ingest-{uuid.uuid4().hex}"
        created_at = now_utc()
        self.memory.record_run(run_id, created_at, batch.source, self.model_roles)
        for lot in batch.lots:
            evaluation = LotEvaluation(
                lot=lot,
                recommendation=AgentRecommendation(
                    risk_level=RiskLevel.LOW,
                    recommended_action=RecommendedAction.HOLD,
                    rationale="Ingested for observation only.",
                    model="ingestion-only",
                ),
                policy=PolicyDecision(
                    status=PolicyStatus.ALLOW,
                    reason="Observation stored; no action requested.",
                ),
                tool_calls=[],
            )
            self.memory.record_lot_evaluation(run_id, evaluation)
        return {"run_id": run_id, "ingested_lots": len(batch.lots)}

    async def run(self, request: AgentRunRequest) -> AgentRunResponse:
        lots = request.lots
        if request.use_live_source or lots is None:
            lots = await self.ingestion.pull_live_data()
        run_id = f"run-{uuid.uuid4().hex}"
        created_at = now_utc()
        self.memory.record_run(run_id, created_at, request.source, self.model_roles)

        evaluations: list[LotEvaluation] = []
        for lot in lots:
            recommendation = await self.reasoning.evaluate_lot(lot)
            policy = self.policy.evaluate(lot, recommendation)
            tool_calls = await self.tools.execute(lot, recommendation, policy)
            evaluation = LotEvaluation(
                lot=lot,
                recommendation=recommendation,
                policy=policy,
                tool_calls=tool_calls,
            )
            self.memory.record_lot_evaluation(run_id, evaluation)
            evaluations.append(evaluation)

        return AgentRunResponse(
            run_id=run_id,
            created_at=created_at,
            source=request.source,
            model_roles=self.model_roles,
            evaluations=evaluations,
            recurring_waste_patterns=self.memory.patterns(),
        )


def sample_lots() -> list[MedicationLot]:
    return [
        MedicationLot(
            lot_id="AMOX-2401-A",
            medication_name="Amoxicillin 500mg",
            ndc="00093-2263-01",
            location_id="phx-central",
            location_name="Phoenix Central Pharmacy",
            quantity=180,
            expiration_date=date.today().replace(year=date.today().year + 1),
            demand_7d=42,
            demand_30d=168,
            recall_status=RecallStatus.NONE,
            temperature_logs=[
                TemperatureReading(timestamp=now_utc(), celsius=5.1),
            ],
            unit_value_usd=0.42,
        ),
        MedicationLot(
            lot_id="INS-GLAR-0524",
            medication_name="Insulin glargine pen",
            ndc="00088-2219-05",
            location_id="reno-west",
            location_name="Reno West Pharmacy",
            quantity=35,
            expiration_date=date.today(),
            demand_7d=2,
            demand_30d=9,
            recall_status=RecallStatus.NONE,
            temperature_logs=[
                TemperatureReading(timestamp=now_utc(), celsius=5.4),
            ],
            unit_value_usd=97.5,
            storage_min_c=2,
            storage_max_c=8,
        ),
        MedicationLot(
            lot_id="OXY-IR-8821",
            medication_name="Oxycodone IR 5mg",
            ndc="00406-0512-01",
            location_id="vegas-north",
            location_name="Vegas North Pharmacy",
            quantity=250,
            expiration_date=date.today().replace(year=date.today().year + 1),
            demand_7d=10,
            demand_30d=44,
            recall_status=RecallStatus.NONE,
            temperature_logs=[],
            unit_value_usd=12.4,
            controlled_substance=True,
        ),
        MedicationLot(
            lot_id="VACC-9981",
            medication_name="Varicella vaccine",
            ndc="00006-4827-00",
            location_id="phx-central",
            location_name="Phoenix Central Pharmacy",
            quantity=22,
            expiration_date=date.today().replace(year=date.today().year + 1),
            demand_7d=8,
            demand_30d=31,
            recall_status=RecallStatus.NONE,
            temperature_logs=[
                TemperatureReading(timestamp=now_utc(), celsius=11.2),
            ],
            unit_value_usd=145.0,
            storage_min_c=2,
            storage_max_c=8,
        ),
    ]


settings = AgentSettings.from_env()
service = PharmacyAgentService(settings)
app = FastAPI(
    title="MedFlow Pharmacy Agent Backend",
    description=(
        "Autonomous OpenClaw-style pharmacy waste prevention backend powered by "
        "NVIDIA Nemotron reasoning models."
    ),
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "nemotron_enabled": service.reasoning.client.enabled,
        "database_path": str(settings.database_path),
        "model_roles": service.model_roles,
    }


@app.get("/sample-data", response_model=list[MedicationLot])
async def get_sample_data() -> list[MedicationLot]:
    return sample_lots()


@app.post("/ingest/lots")
async def ingest_lots(batch: IngestionBatch) -> dict[str, Any]:
    return await service.ingest_lots(batch)


@app.post("/agent/run", response_model=AgentRunResponse)
async def run_agent(request: AgentRunRequest) -> AgentRunResponse:
    return await service.run(request)


@app.post("/agent/run/live", response_model=AgentRunResponse)
async def run_agent_live() -> AgentRunResponse:
    return await service.run(AgentRunRequest(source="live", use_live_source=True))


@app.get("/audit/runs")
async def audit_runs(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    return service.memory.recent_runs(limit)


@app.get("/audit/runs/{run_id}")
async def audit_run_detail(run_id: str) -> dict[str, Any]:
    detail = service.memory.run_detail(run_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


@app.get("/memory/patterns")
async def memory_patterns(
    limit: int = Query(default=50, ge=1, le=200)
) -> list[dict[str, Any]]:
    return service.memory.patterns(limit)
