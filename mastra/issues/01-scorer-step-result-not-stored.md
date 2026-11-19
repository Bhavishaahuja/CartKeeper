# Scorer step results that aren't records are silently not stored in experiments

## Summary

A custom scorer whose `preprocess` (or `analyze`) step returns an array, `null` or a primitive works
with `scorer.run()`, and the experiment summary reports its score. But the score record is never
written to storage. The only sign is a `Failed to save score` log line with a `ZodError`
(`preprocessStepResult: expected record, received array`).

## Repro

`@mastra/core` 1.85.0, `@mastra/libsql` 1.31.1:

```ts
const scorer = createScorer({ id: 'array-step', description: 'preprocess returns an array' })
  .preprocess(() => [1, 2, 3])
  .generateScore(({ results }) => (results.preprocessStepResult as number[]).length / 3);

await scorer.run({ input: 'x', output: 'y' });             // score: 1

const dataset = await mastra.datasets.create({ name: 'repro' });
await dataset.addItems({ items: [{ input: 'x' }] });
const summary = await dataset.startExperiment({ task: async () => 'y', scorers: [scorer] });
summary.results[0].scores[0].score;                        // 1
(await scoresStore.listScoresByScorerId({ scorerId: 'array-step', ... })).scores.length;  // 0
```

Full script: `repros/scorer-array-step-result.mts`.

## Expected

One of these:
- The score is stored, because step results are serialized as-is.
- `createScorer` types and validates step results as records up front, so this fails at definition
  time or on the first `run()`.
- The experiment reports the item's score as an error, rather than reporting a score that was never
  stored.

## Actual

The summary and Studio's live view show the score, but the stored experiment has no score record
for those items. The only signal is a log line.

## Workaround

Wrap step results in an object: `.preprocess(() => ({ items: [1, 2, 3] }))`.
