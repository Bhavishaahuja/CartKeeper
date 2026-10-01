# Cartkeeper

Agentic purchasing for small and mid-size manufacturers. See [PRD.md](PRD.md).

## Run it locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env          # then add your ANTHROPIC_API_KEY

python -m backend.core.graph "Loom L-07 heald wires snapped, need 500 today"
pytest
```
