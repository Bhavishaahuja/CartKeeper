# Eval runs

All three runs used the 30-item dataset, run locally with an Anthropic key.

| File | What it is |
| --- | --- |
| `2026-11-19T00-01-51.json` | Smoke test: Haiku, 1 run, no judge. |
| `2026-11-19T00-10-15.json` | Run 1: Sonnet vs Haiku, 3 runs, Opus judge. The judge rubric was miscalibrated (every card failed one criterion), so ignore its `approver-explanation` column. The code scorers are valid. |
| `2026-11-19T00-50-43.json`, `latest.md` | **Run 3, the reported result**: rubric fixed, judge agrees with the hand labels on 9 of 10 calibration cards. |

Run 2 was only the `--calibrate-only` check (judge agreed on 8 of 10), so it has no file.

The card and prompt fixes made after run 3 (see `NOTES.md`, eval finding 6) haven't been
re-measured yet. To do that:

```bash
npm run evals
```
