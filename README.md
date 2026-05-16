# MedFlow

Autonomous pharmacy waste-prevention backend for the NVIDIA hackathon. The service
uses NVIDIA Nemotron model roles for medication-lot reasoning, a NemoClaw-style
policy gate, OpenClaw-style tool execution, and persistent SQLite memory/audit
storage.

## What the agent does

1. **Data ingestion layer** pulls medication lot data containing inventory,
   expiration date, demand, recall status, temperature logs, and medication value.
2. **Nemotron reasoning agent** evaluates each lot with separate triage and
   compliance model roles.
3. **NemoClaw policy layer** allows low-risk actions, blocks recall/temperature
   issues, and escalates controlled or high-value medications for human approval.
4. **OpenClaw tool execution layer** executes approved actions:
   `transfer_inventory`, `quarantine_lot`, `notify_pharmacist`,
   `request_human_approval`, and `update_reorder_rules`.
5. **Memory + audit layer** stores observations, Nemotron recommendations,
   policy decisions, tool calls, and recurring waste patterns.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
MOCK_NEMOTRON=true uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000/docs> for the generated API docs.

## NVIDIA / Nemotron configuration

Set `NVIDIA_API_KEY` to call NVIDIA's OpenAI-compatible API. Without a key, or
with `MOCK_NEMOTRON=true`, the backend uses deterministic local reasoning so the
agent remains runnable in demos and tests.

Environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `NVIDIA_API_KEY` | NVIDIA API key for Nemotron chat completions | unset |
| `NVIDIA_BASE_URL` | NVIDIA OpenAI-compatible base URL | `https://integrate.api.nvidia.com/v1` |
| `NEMOTRON_TRIAGE_MODEL` | Main lot risk/action model | `nvidia/llama-3.1-nemotron-70b-instruct` |
| `NEMOTRON_COMPLIANCE_MODEL` | Safety/compliance model | `nvidia/llama-3.1-nemotron-nano-8b-v1` |
| `NEMOTRON_PATTERN_MODEL` | Reserved model role for pattern summarization | `nvidia/llama-3.1-nemotron-nano-8b-v1` |
| `PHARMACY_DATA_URL` | Optional live inventory JSON endpoint | unset; sample data is used |
| `AGENT_DB_PATH` | Persistent memory/audit SQLite path | `/tmp/medflow_pharmacy_agent.sqlite3` |
| `HIGH_VALUE_THRESHOLD_USD` | Escalation threshold for high-value lots | `5000` |

## API quick start

Run the autonomous agent against built-in sample data:

```bash
curl -X POST http://localhost:8000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"source":"sample-demo","use_live_source":true}'
```

Run against a configured live source:

```bash
PHARMACY_DATA_URL=https://example.com/pharmacy-lots.json \
NVIDIA_API_KEY=... \
uvicorn backend.app:app --host 0.0.0.0 --port 8000

curl -X POST http://localhost:8000/agent/run/live
```

Useful endpoints:

- `GET /health` - service status and active model roles.
- `GET /sample-data` - example medication lots.
- `POST /ingest/lots` - store observations without taking action.
- `POST /agent/run` - run the full autonomous workflow.
- `POST /agent/run/live` - pull `PHARMACY_DATA_URL` and run the workflow.
- `GET /audit/runs` and `GET /audit/runs/{run_id}` - audit trail.
- `GET /memory/patterns` - recurring waste patterns.

## Test

```bash
pip install -r backend/requirements.txt
MOCK_NEMOTRON=true python -m unittest discover -s backend/tests
```
