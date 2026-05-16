from __future__ import annotations

import asyncio
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from backend.app import (
    AgentRunRequest,
    AgentSettings,
    MedicationLot,
    NemoClawPolicyLayer,
    NemotronReasoningAgent,
    OpenClawToolExecutionLayer,
    PharmacyAgentService,
    PolicyStatus,
    RecallStatus,
    RecommendedAction,
    RiskLevel,
    TemperatureReading,
)


def lot(**overrides):
    base = {
        "lot_id": "LOT-1",
        "medication_name": "Test Medication",
        "ndc": "00000-0000-00",
        "location_id": "store-1",
        "location_name": "Store 1",
        "quantity": 100,
        "expiration_date": date.today() + timedelta(days=15),
        "demand_7d": 1,
        "demand_30d": 4,
        "recall_status": RecallStatus.NONE,
        "temperature_logs": [
            TemperatureReading(
                timestamp=datetime.now(timezone.utc),
                celsius=5.0,
            )
        ],
        "unit_value_usd": 1.0,
        "controlled_substance": False,
    }
    base.update(overrides)
    return MedicationLot(**base)


def settings(path: Path) -> AgentSettings:
    return AgentSettings(
        nvidia_api_key=None,
        nvidia_base_url="https://integrate.api.nvidia.com/v1",
        triage_model="triage-model",
        compliance_model="compliance-model",
        pattern_model="pattern-model",
        pharmacy_data_url=None,
        database_path=path,
        high_value_threshold_usd=5000,
        mock_nemotron=True,
        request_timeout_s=3,
    )


class PharmacyAgentTests(unittest.TestCase):
    def test_temperature_excursion_blocks_and_quarantines(self):
        med_lot = lot(
            temperature_logs=[
                TemperatureReading(
                    timestamp=datetime.now(timezone.utc),
                    celsius=12.0,
                )
            ]
        )
        agent = NemotronReasoningAgent(settings(Path(":memory:")))
        recommendation = asyncio.run(agent.evaluate_lot(med_lot))
        decision = NemoClawPolicyLayer(5000).evaluate(med_lot, recommendation)
        tool_calls = asyncio.run(
            OpenClawToolExecutionLayer().execute(med_lot, recommendation, decision)
        )

        self.assertEqual(recommendation.risk_level, RiskLevel.CRITICAL)
        self.assertEqual(decision.status, PolicyStatus.BLOCK)
        self.assertEqual(
            [call.tool_name for call in tool_calls],
            [
                RecommendedAction.QUARANTINE_LOT,
                RecommendedAction.NOTIFY_PHARMACIST,
            ],
        )

    def test_controlled_medication_requires_human_approval(self):
        med_lot = lot(controlled_substance=True)
        agent = NemotronReasoningAgent(settings(Path(":memory:")))
        recommendation = asyncio.run(agent.evaluate_lot(med_lot))
        decision = NemoClawPolicyLayer(5000).evaluate(med_lot, recommendation)

        self.assertEqual(decision.status, PolicyStatus.ESCALATE)
        self.assertEqual(
            decision.required_tools,
            [RecommendedAction.REQUEST_HUMAN_APPROVAL],
        )

    def test_safe_near_expiration_lot_transfers_and_audits(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "agent.sqlite3"
            service = PharmacyAgentService(settings(db_path))
            response = asyncio.run(
                service.run(AgentRunRequest(source="test", lots=[lot()]))
            )
            detail = service.memory.run_detail(response.run_id)

            self.assertEqual(len(response.evaluations), 1)
            self.assertEqual(
                response.evaluations[0].policy.status,
                PolicyStatus.ALLOW,
            )
            self.assertEqual(
                response.evaluations[0].tool_calls[0].tool_name,
                RecommendedAction.TRANSFER_INVENTORY,
            )
            self.assertIsNotNone(detail)
            self.assertEqual(len(detail["observations"]), 1)
            self.assertEqual(len(detail["recommendations"]), 1)
            self.assertGreaterEqual(len(service.memory.patterns()), 1)


if __name__ == "__main__":
    unittest.main()
