from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator


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


class EvidenceType(str, Enum):
    LABEL_PHOTO = "label_photo"
    RECALL_NOTICE = "recall_notice"
    TEMPERATURE_SCREENSHOT = "temperature_screenshot"
    PACKAGE_DAMAGE = "package_damage"
    PHARMACIST_NOTE = "pharmacist_note"
    OTHER = "other"


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


class EvidenceAnalysisRequest(BaseModel):
    evidence_id: str = Field(default_factory=lambda: f"ev-{uuid.uuid4().hex}")
    source: str = "api"
    evidence_type: EvidenceType
    mime_type: str = "text/plain"
    text: str | None = None
    content_base64: str | None = None
    source_uri: str | None = None
    related_lot_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_evidence_payload(self) -> "EvidenceAnalysisRequest":
        if not (self.text or self.content_base64 or self.source_uri):
            raise ValueError("Provide text, content_base64, or source_uri evidence")
        if self.content_base64:
            try:
                base64.b64decode(self.content_base64, validate=True)
            except binascii.Error as exc:
                raise ValueError("content_base64 must be valid base64") from exc
        return self


class EvidenceAnalysisResponse(BaseModel):
    evidence_id: str
    created_at: datetime
    evidence_type: EvidenceType
    model: str
    extracted_facts: dict[str, Any] = Field(default_factory=dict)
    inferred_lot_patch: dict[str, Any] = Field(default_factory=dict)
    safety_signals: list[str] = Field(default_factory=list)
    compliance_signals: list[str] = Field(default_factory=list)
    recommended_next_step: RecommendedAction
    confidence: float = Field(default=0.7, ge=0, le=1)
    rationale: str


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
    omni_model: str
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
            omni_model=os.getenv(
                "NEMOTRON_OMNI_MODEL",
                "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
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

                CREATE TABLE IF NOT EXISTS evidence_reports (
                    evidence_id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    evidence_type TEXT NOT NULL,
                    related_lot_id TEXT,
                    model TEXT NOT NULL,
                    evidence_json TEXT NOT NULL,
                    analysis_json TEXT NOT NULL
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

    def record_evidence_analysis(
        self, request: EvidenceAnalysisRequest, response: EvidenceAnalysisResponse
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO evidence_reports (
                    evidence_id,
                    created_at,
                    source,
                    evidence_type,
                    related_lot_id,
                    model,
                    evidence_json,
                    analysis_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(evidence_id) DO UPDATE SET
                    created_at = excluded.created_at,
                    source = excluded.source,
                    evidence_type = excluded.evidence_type,
                    related_lot_id = excluded.related_lot_id,
                    model = excluded.model,
                    evidence_json = excluded.evidence_json,
                    analysis_json = excluded.analysis_json
                """,
                (
                    response.evidence_id,
                    response.created_at.isoformat(),
                    request.source,
                    request.evidence_type.value,
                    request.related_lot_id,
                    response.model,
                    json_dumps(self._redacted_evidence(request)),
                    response.model_dump_json(),
                ),
            )

    def _redacted_evidence(self, request: EvidenceAnalysisRequest) -> dict[str, Any]:
        encoded_size = len(request.content_base64) if request.content_base64 else 0
        return {
            "evidence_id": request.evidence_id,
            "evidence_type": request.evidence_type.value,
            "mime_type": request.mime_type,
            "source_uri": request.source_uri,
            "related_lot_id": request.related_lot_id,
            "metadata": request.metadata,
            "text": request.text,
            "content_base64": "<redacted>" if request.content_base64 else None,
            "content_base64_chars": encoded_size,
        }

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

    def evidence_reports(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    evidence_id,
                    created_at,
                    source,
                    evidence_type,
                    related_lot_id,
                    model,
                    evidence_json,
                    analysis_json
                FROM evidence_reports
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "evidence_id": row["evidence_id"],
                "created_at": row["created_at"],
                "source": row["source"],
                "evidence_type": row["evidence_type"],
                "related_lot_id": row["related_lot_id"],
                "model": row["model"],
                "evidence": json.loads(row["evidence_json"]),
                "analysis": json.loads(row["analysis_json"]),
            }
            for row in rows
        ]

    def reset_demo(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                DELETE FROM tool_calls;
                DELETE FROM policy_decisions;
                DELETE FROM recommendations;
                DELETE FROM lot_observations;
                DELETE FROM agent_runs;
                DELETE FROM waste_patterns;
                DELETE FROM evidence_reports;
                """
            )


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
        content = await self._post_chat_completion(request_payload)
        return self._parse_json_content(content) | {"model": model}

    async def complete_multimodal_json(
        self,
        *,
        model: str,
        system_prompt: str,
        request: EvidenceAnalysisRequest,
        fallback: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.enabled:
            return fallback | {"model": f"{model} (local-fallback)"}

        user_content: str | list[dict[str, Any]]
        prompt_text = (
            "Return strict JSON only with keys extracted_facts, inferred_lot_patch, "
            "safety_signals, compliance_signals, recommended_next_step, confidence, "
            "and rationale. Analyze this pharmacy evidence:\n"
            f"{json_dumps(self._evidence_prompt_payload(request))}"
        )
        if request.content_base64 and request.mime_type.startswith("image/"):
            user_content = [
                {"type": "text", "text": prompt_text},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": (
                            f"data:{request.mime_type};base64,"
                            f"{request.content_base64}"
                        )
                    },
                },
            ]
        else:
            user_content = prompt_text

        request_payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.1,
            "top_p": 0.9,
            "max_tokens": 900,
        }
        content = await self._post_chat_completion(request_payload)
        return self._parse_json_content(content) | {"model": model}

    def _evidence_prompt_payload(
        self, request: EvidenceAnalysisRequest
    ) -> dict[str, Any]:
        return {
            "evidence_id": request.evidence_id,
            "evidence_type": request.evidence_type.value,
            "mime_type": request.mime_type,
            "text": request.text,
            "source_uri": request.source_uri,
            "related_lot_id": request.related_lot_id,
            "metadata": request.metadata,
            "has_base64_media": bool(request.content_base64),
        }

    async def _post_chat_completion(self, request_payload: dict[str, Any]) -> str:
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
        return response.json()["choices"][0]["message"]["content"]

    def _parse_json_content(self, content: str) -> dict[str, Any]:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start == -1 or end == -1:
                raise
            return json.loads(content[start : end + 1])


class NanoOmniEvidenceAgent:
    def __init__(self, settings: AgentSettings):
        self.settings = settings
        self.client = NemotronClient(settings)

    async def analyze(
        self, request: EvidenceAnalysisRequest
    ) -> EvidenceAnalysisResponse:
        fallback = self._heuristic_evidence_analysis(request)
        result = await self.client.complete_multimodal_json(
            model=self.settings.omni_model,
            system_prompt=(
                "You are Nemotron NanoOmni acting as a multimodal pharmacy evidence "
                "sub-agent. Extract medication facts from labels, screenshots, recall "
                "notices, package-damage images, and pharmacist notes. Flag safety "
                "or compliance concerns, but do not execute tools."
            ),
            request=request,
            fallback=fallback,
        )
        payload = {
            "evidence_id": request.evidence_id,
            "created_at": now_utc(),
            "evidence_type": request.evidence_type,
            "model": result.get("model", self.settings.omni_model),
            "extracted_facts": result.get("extracted_facts", {}),
            "inferred_lot_patch": result.get("inferred_lot_patch", {}),
            "safety_signals": result.get("safety_signals", []),
            "compliance_signals": result.get("compliance_signals", []),
            "recommended_next_step": result.get(
                "recommended_next_step", fallback["recommended_next_step"]
            ),
            "confidence": result.get("confidence", fallback["confidence"]),
            "rationale": result.get("rationale", fallback["rationale"]),
        }
        try:
            return EvidenceAnalysisResponse.model_validate(payload)
        except ValidationError:
            return EvidenceAnalysisResponse.model_validate(
                payload
                | {
                    "recommended_next_step": fallback["recommended_next_step"],
                    "confidence": fallback["confidence"],
                    "rationale": fallback["rationale"],
                }
            )

    def _heuristic_evidence_analysis(
        self, request: EvidenceAnalysisRequest
    ) -> dict[str, Any]:
        evidence_text = " ".join(
            [
                request.text or "",
                request.source_uri or "",
                json_dumps(request.metadata),
                request.evidence_type.value,
            ]
        ).lower()
        extracted_facts: dict[str, Any] = {
            "related_lot_id": request.related_lot_id,
            "mime_type": request.mime_type,
            "source_uri": request.source_uri,
        }
        inferred_patch: dict[str, Any] = {}
        safety_signals: list[str] = []
        compliance_signals: list[str] = []
        next_step = RecommendedAction.HOLD.value
        confidence = 0.62

        if request.content_base64 and request.mime_type.startswith("image/"):
            extracted_facts["media_received"] = "image"
            confidence = 0.58
        elif request.content_base64:
            extracted_facts["media_received"] = request.mime_type

        ndc_match = re.search(r"\b\d{4,5}-\d{3,4}-\d{1,2}\b", evidence_text)
        if ndc_match:
            inferred_patch["ndc"] = ndc_match.group(0)
            confidence = max(confidence, 0.72)

        lot_match = re.search(r"\blot[:\s#-]+([a-z0-9-]+)\b", evidence_text)
        if lot_match:
            inferred_patch["lot_id"] = lot_match.group(1).upper()
            confidence = max(confidence, 0.72)

        temp_values = [
            float(match)
            for match in re.findall(r"(-?\d+(?:\.\d+)?)\s*(?:c|celsius|deg c)", evidence_text)
        ]
        if temp_values:
            extracted_facts["temperature_celsius_values"] = temp_values
            if any(value < 2 or value > 8 for value in temp_values):
                safety_signals.append("temperature_excursion")
                compliance_signals.append("cold_chain_review_required")
                next_step = RecommendedAction.QUARANTINE_LOT.value
                confidence = max(confidence, 0.82)

        if "recall" in evidence_text and not any(
            marker in evidence_text for marker in ["no recall", "not recalled"]
        ):
            inferred_patch["recall_status"] = RecallStatus.ACTIVE.value
            safety_signals.append("possible_active_recall")
            compliance_signals.append("recall_handling_required")
            next_step = RecommendedAction.QUARANTINE_LOT.value
            confidence = max(confidence, 0.8)

        if any(word in evidence_text for word in ["damaged", "cracked", "leaking", "tamper"]):
            safety_signals.append("package_integrity_issue")
            next_step = RecommendedAction.NOTIFY_PHARMACIST.value
            confidence = max(confidence, 0.76)

        if any(word in evidence_text for word in ["controlled", "schedule ii", "c-ii"]):
            compliance_signals.append("controlled_substance_review")
            next_step = RecommendedAction.REQUEST_HUMAN_APPROVAL.value
            confidence = max(confidence, 0.78)

        if not safety_signals and not compliance_signals and request.evidence_type == EvidenceType.LABEL_PHOTO:
            next_step = RecommendedAction.HOLD.value

        return {
            "extracted_facts": extracted_facts,
            "inferred_lot_patch": inferred_patch,
            "safety_signals": safety_signals,
            "compliance_signals": compliance_signals,
            "recommended_next_step": next_step,
            "confidence": confidence,
            "rationale": (
                "NanoOmni evidence pass extracted available facts and surfaced "
                "safety/compliance signals for the structured agent workflow."
            ),
            "model": self.settings.omni_model,
        }


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
        self.evidence = NanoOmniEvidenceAgent(settings)
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
            "multimodal_evidence": self.settings.omni_model,
        }

    async def analyze_evidence(
        self, request: EvidenceAnalysisRequest
    ) -> EvidenceAnalysisResponse:
        response = await self.evidence.analyze(request)
        self.memory.record_evidence_analysis(request, response)
        return response

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

    async def run(
        self,
        request: AgentRunRequest,
        trace_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> AgentRunResponse:
        lots = request.lots
        if request.use_live_source or lots is None:
            lots = await self.ingestion.pull_live_data()
        run_id = f"run-{uuid.uuid4().hex}"
        created_at = now_utc()
        self.memory.record_run(run_id, created_at, request.source, self.model_roles)

        evaluations: list[LotEvaluation] = []
        for lot in lots:
            await self._emit_trace(
                trace_callback,
                tag="OBSERVE",
                lot=lot,
                content=(
                    f"{lot.medication_name} {lot.lot_id}: {lot.quantity} units at "
                    f"{lot.location_name} expire in {lot.days_until_expiration} days. "
                    f"30-day demand is {lot.demand_30d} units."
                ),
            )
            recommendation = await self.reasoning.evaluate_lot(lot)
            await self._emit_trace(
                trace_callback,
                tag="REASON",
                lot=lot,
                content=recommendation.rationale,
            )
            policy = self.policy.evaluate(lot, recommendation)
            await self._emit_trace(
                trace_callback,
                tag="POLICY_CHECK",
                lot=lot,
                content=f"{policy.status.value.upper()}: {policy.reason}",
            )
            tool_calls = await self.tools.execute(lot, recommendation, policy)
            await self._emit_trace(
                trace_callback,
                tag="ACTION",
                lot=lot,
                content=self._action_trace_text(policy, tool_calls),
            )
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

    async def _emit_trace(
        self,
        trace_callback: Callable[[dict[str, Any]], Awaitable[None]] | None,
        *,
        tag: Literal["OBSERVE", "REASON", "POLICY_CHECK", "ACTION"],
        lot: MedicationLot,
        content: str,
    ) -> None:
        if trace_callback is None:
            return
        await trace_callback(
            {
                "type": "reasoning",
                "content": content,
                "tag": tag,
                "lot_id": lot.lot_id,
            }
        )
        await asyncio.sleep(0.15)

    def _action_trace_text(
        self, policy: PolicyDecision, tool_calls: list[ToolCallResult]
    ) -> str:
        if not tool_calls:
            return f"No tool executed. Policy status: {policy.status.value}."
        return "; ".join(
            f"{call.tool_name.value} {call.status}"
            + (f" ({call.error})" if call.error else "")
            for call in tool_calls
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


def demo_date(days_from_today: int) -> date:
    return date.today() + timedelta(days=days_from_today)


def dashboard_demo_lots(run_index: int) -> list[MedicationLot]:
    """Rotating dashboard batches make repeated frontend demos explainable."""
    scenario = run_index % 4
    batches = [
        [
            {
                "lot_id": "CEF-4421",
                "medication_name": "Cefazolin",
                "ndc": "00143-9924-90",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 40,
                "expiration_date": demo_date(8),
                "demand_7d": 6,
                "demand_30d": 20,
                "unit_value_usd": 80,
            },
            {
                "lot_id": "INS-8832",
                "medication_name": "Insulin (Humalog)",
                "ndc": "00002-7510-01",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 60,
                "expiration_date": demo_date(10),
                "demand_7d": 15,
                "demand_30d": 58,
                "unit_value_usd": 70,
                "temperature_logs": [TemperatureReading(timestamp=now_utc(), celsius=12.2)],
            },
            {
                "lot_id": "VIN-2291",
                "medication_name": "Vincristine",
                "ndc": "61703-309-16",
                "location_id": "cancer-center",
                "location_name": "Cancer Center",
                "quantity": 15,
                "expiration_date": demo_date(12),
                "demand_7d": 1,
                "demand_30d": 5,
                "unit_value_usd": 520,
            },
            {
                "lot_id": "AMX-5512",
                "medication_name": "Amoxicillin",
                "ndc": "00093-2263-01",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 120,
                "expiration_date": demo_date(30),
                "demand_7d": 34,
                "demand_30d": 142,
                "unit_value_usd": 12,
            },
            {
                "lot_id": "MET-3301",
                "medication_name": "Metformin",
                "ndc": "00093-1048-01",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 200,
                "expiration_date": demo_date(45),
                "demand_7d": 22,
                "demand_30d": 82,
                "unit_value_usd": 8,
            },
            {
                "lot_id": "LIS-7743",
                "medication_name": "Lisinopril",
                "ndc": "68180-980-03",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 80,
                "expiration_date": demo_date(20),
                "demand_7d": 4,
                "demand_30d": 18,
                "unit_value_usd": 10,
            },
        ],
        [
            {
                "lot_id": "PIP-1028",
                "medication_name": "Piperacillin-Tazobactam",
                "ndc": "63323-002-20",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 32,
                "expiration_date": demo_date(6),
                "demand_7d": 3,
                "demand_30d": 12,
                "unit_value_usd": 155,
            },
            {
                "lot_id": "ENO-7710",
                "medication_name": "Enoxaparin",
                "ndc": "81952-123-23",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 90,
                "expiration_date": demo_date(18),
                "demand_7d": 20,
                "demand_30d": 84,
                "unit_value_usd": 42,
            },
            {
                "lot_id": "NIV-5034",
                "medication_name": "Nivolumab",
                "ndc": "00003-3774-12",
                "location_id": "cancer-center",
                "location_name": "Cancer Center",
                "quantity": 9,
                "expiration_date": demo_date(16),
                "demand_7d": 1,
                "demand_30d": 3,
                "unit_value_usd": 1150,
            },
            {
                "lot_id": "VAN-4109",
                "medication_name": "Vancomycin",
                "ndc": "67457-823-99",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 75,
                "expiration_date": demo_date(11),
                "demand_7d": 18,
                "demand_30d": 76,
                "unit_value_usd": 38,
            },
            {
                "lot_id": "LEV-9022",
                "medication_name": "Levetiracetam",
                "ndc": "68180-115-07",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 130,
                "expiration_date": demo_date(55),
                "demand_7d": 15,
                "demand_30d": 64,
                "unit_value_usd": 14,
            },
            {
                "lot_id": "ROC-1187",
                "medication_name": "Rocuronium",
                "ndc": "0409-9558-10",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 48,
                "expiration_date": demo_date(24),
                "demand_7d": 11,
                "demand_30d": 47,
                "unit_value_usd": 22,
                "temperature_logs": [TemperatureReading(timestamp=now_utc(), celsius=11.0)],
            },
        ],
        [
            {
                "lot_id": "MER-6801",
                "medication_name": "Meropenem",
                "ndc": "63323-507-20",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 58,
                "expiration_date": demo_date(9),
                "demand_7d": 8,
                "demand_30d": 28,
                "unit_value_usd": 96,
            },
            {
                "lot_id": "PAN-3345",
                "medication_name": "Pantoprazole IV",
                "ndc": "0143-9510-10",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 210,
                "expiration_date": demo_date(38),
                "demand_7d": 32,
                "demand_30d": 132,
                "unit_value_usd": 7,
            },
            {
                "lot_id": "RIT-7788",
                "medication_name": "Rituximab",
                "ndc": "50242-051-21",
                "location_id": "cancer-center",
                "location_name": "Cancer Center",
                "quantity": 6,
                "expiration_date": demo_date(13),
                "demand_7d": 1,
                "demand_30d": 2,
                "unit_value_usd": 2100,
            },
            {
                "lot_id": "VAS-5572",
                "medication_name": "Vasopressin",
                "ndc": "42023-164-10",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 44,
                "expiration_date": demo_date(5),
                "demand_7d": 6,
                "demand_30d": 22,
                "unit_value_usd": 125,
            },
            {
                "lot_id": "ALB-9001",
                "medication_name": "Albumin 25%",
                "ndc": "68516-5216-2",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 68,
                "expiration_date": demo_date(28),
                "demand_7d": 20,
                "demand_30d": 88,
                "unit_value_usd": 63,
            },
            {
                "lot_id": "HEP-6120",
                "medication_name": "Heparin",
                "ndc": "63323-047-10",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 95,
                "expiration_date": demo_date(21),
                "demand_7d": 7,
                "demand_30d": 25,
                "unit_value_usd": 18,
            },
        ],
        [
            {
                "lot_id": "CEF-9914",
                "medication_name": "Cefepime",
                "ndc": "63323-280-20",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 52,
                "expiration_date": demo_date(7),
                "demand_7d": 7,
                "demand_30d": 24,
                "unit_value_usd": 72,
            },
            {
                "lot_id": "DEX-3120",
                "medication_name": "Dexmedetomidine",
                "ndc": "63323-165-10",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 36,
                "expiration_date": demo_date(19),
                "demand_7d": 9,
                "demand_30d": 36,
                "unit_value_usd": 185,
                "temperature_logs": [TemperatureReading(timestamp=now_utc(), celsius=0.8)],
            },
            {
                "lot_id": "PEM-8470",
                "medication_name": "Pembrolizumab",
                "ndc": "00006-3029-02",
                "location_id": "cancer-center",
                "location_name": "Cancer Center",
                "quantity": 8,
                "expiration_date": demo_date(14),
                "demand_7d": 1,
                "demand_30d": 3,
                "unit_value_usd": 1760,
            },
            {
                "lot_id": "AZI-2404",
                "medication_name": "Azithromycin IV",
                "ndc": "60505-6154-0",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 88,
                "expiration_date": demo_date(34),
                "demand_7d": 21,
                "demand_30d": 95,
                "unit_value_usd": 16,
            },
            {
                "lot_id": "MOR-2290",
                "medication_name": "Morphine PF",
                "ndc": "0409-1255-30",
                "location_id": "main-hospital",
                "location_name": "Main Hospital",
                "quantity": 140,
                "expiration_date": demo_date(60),
                "demand_7d": 12,
                "demand_30d": 52,
                "unit_value_usd": 9,
                "controlled_substance": True,
            },
            {
                "lot_id": "OND-4771",
                "medication_name": "Ondansetron",
                "ndc": "0641-6078-25",
                "location_id": "satellite-clinic",
                "location_name": "Satellite Clinic",
                "quantity": 160,
                "expiration_date": demo_date(26),
                "demand_7d": 26,
                "demand_30d": 112,
                "unit_value_usd": 6,
            },
        ],
    ]

    defaults: dict[str, Any] = {
        "recall_status": RecallStatus.NONE,
        "temperature_logs": [],
        "storage_min_c": 2,
        "storage_max_c": 8,
        "controlled_substance": False,
    }
    return [MedicationLot(**(defaults | lot)) for lot in batches[scenario]]


def next_dashboard_demo_run_index() -> int:
    return len(dashboard_run_details())


def dashboard_run_details(limit: int = 100) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for run in service.memory.recent_runs(limit):
        if not str(run.get("source", "")).startswith("frontend-dashboard"):
            continue
        detail = service.memory.run_detail(run["run_id"])
        if detail:
            details.append(detail)
    return details


def lot_from_observation(data: dict[str, Any]) -> MedicationLot | None:
    try:
        return MedicationLot.model_validate(data)
    except ValidationError:
        return None


settings = AgentSettings.from_env()
service = PharmacyAgentService(settings)


class AgentTraceHub:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        stale_connections: list[WebSocket] = []
        for websocket in list(self._connections):
            try:
                await websocket.send_json(message)
            except RuntimeError:
                stale_connections.append(websocket)
        for websocket in stale_connections:
            self.disconnect(websocket)


trace_hub = AgentTraceHub()
app = FastAPI(
    title="MedFlow Pharmacy Agent Backend",
    description=(
        "Autonomous OpenClaw-style pharmacy waste prevention backend powered by "
        "NVIDIA Nemotron reasoning models."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def current_inventory_lots() -> list[MedicationLot]:
    try:
        return await service.ingestion.pull_live_data()
    except Exception:
        return sample_lots()


def lots_from_run_detail(detail: dict[str, Any] | None) -> list[MedicationLot]:
    if not detail:
        return []
    lots: list[MedicationLot] = []
    for row in detail.get("observations", []):
        data = row.get("data")
        if isinstance(data, dict) and (lot := lot_from_observation(data)):
            lots.append(lot)
    return lots


def latest_run_detail() -> dict[str, Any] | None:
    runs = service.memory.recent_runs(1)
    if not runs:
        return None
    return service.memory.run_detail(runs[0]["run_id"])


def latest_policy_by_lot(detail: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not detail:
        return {}
    return {
        row["lot_id"]: row["data"]
        for row in detail.get("policy_decisions", [])
        if isinstance(row.get("data"), dict)
    }


def latest_tool_names_by_lot(detail: dict[str, Any] | None) -> dict[str, list[str]]:
    tool_names: dict[str, list[str]] = {}
    if not detail:
        return tool_names
    for tool_call in detail.get("tool_calls", []):
        if tool_call.get("status") == "executed":
            tool_names.setdefault(tool_call["lot_id"], []).append(tool_call["tool_name"])
    return tool_names


def lot_status_for_dashboard(
    lot: MedicationLot,
    policy: dict[str, Any] | None,
    tool_names: list[str],
) -> str:
    if "quarantine_lot" in tool_names:
        return "QUARANTINED"
    if "request_human_approval" in tool_names:
        return "PENDING APPROVAL"
    if policy:
        if policy.get("status") == PolicyStatus.BLOCK.value:
            return "FLAGGED"
        if policy.get("status") == PolicyStatus.ESCALATE.value:
            return "PENDING APPROVAL"
    if lot.recall_status == RecallStatus.ACTIVE or lot.has_temperature_excursion:
        return "FLAGGED"
    if lot.days_until_expiration <= 14:
        return "AT RISK"
    return "NORMAL"


def demand_level_for_dashboard(lot: MedicationLot) -> str:
    if lot.demand_30d >= 90:
        return "High"
    if lot.demand_30d >= 25:
        return "Medium"
    return "Low"


def inventory_lot_for_dashboard(
    lot: MedicationLot,
    policy: dict[str, Any] | None = None,
    tool_names: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": lot.lot_id,
        "medicationName": lot.medication_name,
        "lotNumber": lot.lot_id,
        "location": lot.location_name or lot.location_id,
        "unitsRemaining": lot.quantity,
        "expirationDate": lot.expiration_date.isoformat(),
        "demandLevel": demand_level_for_dashboard(lot),
        "status": lot_status_for_dashboard(lot, policy, tool_names or []),
        "unitValueUsd": lot.unit_value_usd,
    }


def humanize(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").title()


def audit_result_for_policy(policy_status: str) -> str:
    if policy_status == PolicyStatus.BLOCK.value:
        return "BLOCK"
    if policy_status == PolicyStatus.ESCALATE.value:
        return "APPROVAL REQUIRED"
    return "PASS"


def audit_log_for_detail(detail: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not detail:
        return []
    observations = {
        row["lot_id"]: row["data"]
        for row in detail.get("observations", [])
        if isinstance(row.get("data"), dict)
    }
    recommendations = {
        row["lot_id"]: row["data"]
        for row in detail.get("recommendations", [])
        if isinstance(row.get("data"), dict)
    }
    policies = latest_policy_by_lot(detail)
    tool_calls_by_lot: dict[str, list[dict[str, Any]]] = {}
    for tool_call in detail.get("tool_calls", []):
        tool_calls_by_lot.setdefault(tool_call["lot_id"], []).append(tool_call)

    entries: list[dict[str, Any]] = []
    for index, (lot_id, lot) in enumerate(observations.items()):
        recommendation = recommendations.get(lot_id, {})
        policy = policies.get(lot_id, {})
        tool_calls = tool_calls_by_lot.get(lot_id, [])
        tool_names = [tool_call["tool_name"] for tool_call in tool_calls]
        policy_status = str(policy.get("status", PolicyStatus.ALLOW.value))
        entries.append(
            {
                "id": f"{detail['run_id']}-{lot_id}-{index}",
                "timestamp": (
                    tool_calls[0]["created_at"] if tool_calls else detail["created_at"]
                ),
                "medicationName": lot.get("medication_name", "Medication"),
                "lotId": lot_id,
                "proposedAction": humanize(
                    str(recommendation.get("recommended_action", "review_lot"))
                ),
                "nemoClawResult": audit_result_for_policy(policy_status),
                "blockReason": (
                    policy.get("reason")
                    if policy_status
                    in {PolicyStatus.BLOCK.value, PolicyStatus.ESCALATE.value}
                    else None
                ),
                "toolCalled": ", ".join(tool_names) if tool_names else "no_tool",
                "humanApprovalRequired": (
                    policy_status == PolicyStatus.ESCALATE.value
                    or "request_human_approval" in tool_names
                ),
                "modelUsed": recommendation.get(
                    "model", service.model_roles.get("triage", settings.triage_model)
                ),
            }
        )
    return entries


def run_metrics(detail: dict[str, Any] | None) -> dict[str, float]:
    if not detail:
        return {"units": 0, "dollars": 0.0}
    observations = {
        row["lot_id"]: row["data"]
        for row in detail.get("observations", [])
        if isinstance(row.get("data"), dict)
    }
    action_lot_ids = {
        tool_call["lot_id"]
        for tool_call in detail.get("tool_calls", [])
        if tool_call.get("status") == "executed"
        and tool_call.get("tool_name") != RecommendedAction.HOLD.value
    }
    units = 0
    dollars = 0.0
    for lot_id in action_lot_ids:
        lot = observations.get(lot_id)
        if not lot:
            continue
        quantity = int(lot.get("quantity", 0) or 0)
        unit_value = float(lot.get("unit_value_usd", 0) or 0)
        units += quantity
        dollars += quantity * unit_value
    return {"units": units, "dollars": round(dollars, 2)}


def dashboard_run_metrics() -> list[tuple[dict[str, Any], dict[str, float]]]:
    return [(detail, run_metrics(detail)) for detail in dashboard_run_details()]


def roi_summary_for_dashboard() -> dict[str, Any]:
    run_metrics_pairs = dashboard_run_metrics()
    latest_metrics = run_metrics_pairs[0][1] if run_metrics_pairs else {"units": 0, "dollars": 0.0}
    all_metrics = [metrics for _, metrics in run_metrics_pairs]
    total_units = sum(int(metrics["units"]) for metrics in all_metrics)
    total_dollars = round(sum(float(metrics["dollars"]) for metrics in all_metrics), 2)
    history = [
        {
            "run": f"Run {len(run_metrics_pairs) - index:02d}",
            "dollarsSaved": float(metrics["dollars"]),
        }
        for index, (_, metrics) in enumerate(run_metrics_pairs[:10])
    ]
    history.reverse()
    return {
        "totalUnitsPreventedThisRun": int(latest_metrics["units"]),
        "totalUnitsPreventedAllTime": total_units,
        "dollarValueSavedThisRun": latest_metrics["dollars"],
        "dollarValueSavedAllTime": total_dollars,
        "savingsHistory": history,
    }


def memory_patterns_for_dashboard(limit: int = 50) -> dict[str, Any]:
    details = dashboard_run_details(limit)
    latest_inventory = lots_from_run_detail(details[0]) if details else []
    current_keys = {
        f"{lot.medication_name.lower()}:{lot.location_id}" for lot in latest_inventory
    }
    pattern_counts: dict[str, dict[str, Any]] = {}
    for detail in details:
        policies = latest_policy_by_lot(detail)
        for lot in lots_from_run_detail(detail):
            key = f"{lot.medication_name.lower()}:{lot.location_id}"
            if current_keys and key not in current_keys:
                continue
            policy_status = str(
                policies.get(lot.lot_id, {}).get("status", PolicyStatus.ALLOW.value)
            )
            signals: list[str] = []
            if lot.days_until_expiration <= 30 and (
                lot.projected_days_to_deplete is None
                or lot.projected_days_to_deplete > lot.days_until_expiration
            ):
                signals.append("near_expiration_low_demand")
            if policy_status == PolicyStatus.BLOCK.value:
                signals.append("blocked_safety_or_recall")
            if policy_status == PolicyStatus.ESCALATE.value:
                signals.append("approval_required_high_value_or_controlled")
            if not signals:
                continue
            entry = pattern_counts.setdefault(
                key,
                {
                    "id": key,
                    "medicationName": lot.medication_name,
                    "location": lot.location_name or lot.location_id,
                    "signals": set(),
                    "observedRuns": 0,
                    "estimatedMonthlySavings": 0,
                },
            )
            entry["observedRuns"] += 1
            entry["estimatedMonthlySavings"] += int(lot.lot_value_usd)
            entry["signals"].update(signals)

    patterns = []
    for entry in pattern_counts.values():
        signals = sorted(entry.pop("signals"))
        patterns.append(
            entry
            | {
                "description": (
                    f"Nemotron observed {humanize(', '.join(signals))} for "
                    f"{entry['medicationName']} at {entry['location']}."
                ),
                "reorderAdjustment": (
                    "Reduce reorder point and route surplus to higher-demand sites"
                    if "near_expiration_low_demand" in signals
                    else "Keep current reorder settings and require policy review before action"
                ),
                "estimatedMonthlySavings": max(0, int(entry["estimatedMonthlySavings"])),
            }
        )
    patterns.sort(key=lambda pattern: pattern["estimatedMonthlySavings"], reverse=True)

    timeline: list[dict[str, Any]] = []
    current_lot_ids = {lot.lot_id for lot in latest_inventory}
    for detail in details[:10]:
        observations = {
            row["lot_id"]: row["data"]
            for row in detail.get("observations", [])
            if isinstance(row.get("data"), dict)
        }
        for tool_call in detail.get("tool_calls", []):
            if current_lot_ids and tool_call["lot_id"] not in current_lot_ids:
                continue
            lot = observations.get(tool_call["lot_id"], {})
            timeline.append(
                {
                    "id": f"{detail['run_id']}-{tool_call['lot_id']}-{tool_call['tool_name']}",
                    "timestamp": tool_call["created_at"],
                    "medicationName": lot.get("medication_name", "Medication"),
                    "actionTaken": humanize(tool_call["tool_name"]),
                    "unitsSaved": int(lot.get("quantity", 0) or 0),
                }
            )
    return {"patterns": patterns, "timeline": timeline[:20]}


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


@app.post("/evidence/analyze", response_model=EvidenceAnalysisResponse)
async def analyze_evidence(
    request: EvidenceAnalysisRequest,
) -> EvidenceAnalysisResponse:
    return await service.analyze_evidence(request)


@app.post("/agent/run", response_model=AgentRunResponse)
async def run_agent(request: AgentRunRequest) -> AgentRunResponse:
    return await service.run(request)


@app.post("/agent/run/live", response_model=AgentRunResponse)
async def run_agent_live() -> AgentRunResponse:
    return await service.run(AgentRunRequest(source="live", use_live_source=True))


@app.post("/api/run-agent", response_model=AgentRunResponse)
async def api_run_agent(request: AgentRunRequest | None = None) -> AgentRunResponse:
    run_request = request or AgentRunRequest(source="frontend-dashboard")
    if run_request.lots is None and not settings.pharmacy_data_url:
        run_request = AgentRunRequest(
            source=run_request.source or "frontend-dashboard",
            lots=dashboard_demo_lots(next_dashboard_demo_run_index()),
            use_live_source=False,
        )
    return await service.run(run_request, trace_callback=trace_hub.broadcast)


@app.post("/api/reset-demo")
async def api_reset_demo() -> dict[str, Any]:
    service.memory.reset_demo()
    return {"status": "reset"}


@app.get("/api/inventory")
async def api_inventory() -> list[dict[str, Any]]:
    detail = latest_run_detail()
    policies = latest_policy_by_lot(detail)
    tool_names = latest_tool_names_by_lot(detail)
    lots = lots_from_run_detail(detail)
    if not lots:
        lots = (
            await current_inventory_lots()
            if settings.pharmacy_data_url
            else dashboard_demo_lots(next_dashboard_demo_run_index())
        )
    return [
        inventory_lot_for_dashboard(
            lot,
            policies.get(lot.lot_id),
            tool_names.get(lot.lot_id, []),
        )
        for lot in lots
    ]


@app.get("/api/audit-log")
async def api_audit_log() -> list[dict[str, Any]]:
    return audit_log_for_detail(latest_run_detail())


@app.get("/api/roi-summary")
async def api_roi_summary() -> dict[str, Any]:
    return roi_summary_for_dashboard()


@app.get("/api/memory/patterns")
async def api_memory_patterns(
    limit: int = Query(default=50, ge=1, le=200)
) -> dict[str, Any]:
    return memory_patterns_for_dashboard(limit)


@app.websocket("/ws/agent-trace")
async def agent_trace_websocket(websocket: WebSocket) -> None:
    await trace_hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        trace_hub.disconnect(websocket)


@app.get("/audit/runs")
async def audit_runs(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    return service.memory.recent_runs(limit)


@app.get("/audit/runs/{run_id}")
async def audit_run_detail(run_id: str) -> dict[str, Any]:
    detail = service.memory.run_detail(run_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


@app.get("/audit/evidence")
async def audit_evidence(
    limit: int = Query(default=50, ge=1, le=100)
) -> list[dict[str, Any]]:
    return service.memory.evidence_reports(limit)


@app.get("/memory/patterns")
async def memory_patterns(
    limit: int = Query(default=50, ge=1, le=200)
) -> list[dict[str, Any]]:
    return service.memory.patterns(limit)
