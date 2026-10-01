# Cartkeeper

Agentic purchasing for small and mid-size manufacturers. See [PRD.md](PRD.md).

## Run it locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env          # then add your ANTHROPIC_API_KEY

python -m backend.core.graph "Loom L-07 heald wires snapped, need 500 today"
python -m backend.core.graph "Need 2 x 6205 bearings for spinning frame S-04"   # storeroom hit

pytest                 # offline tests (fake LLM)
pytest -m live         # T1 + T3 against the real model (needs ANTHROPIC_API_KEY)

# SQL view tests run when a Postgres URL is set:
CARTKEEPER_TEST_DATABASE_URL=postgresql://localhost/cartkeeper_test pytest
```
