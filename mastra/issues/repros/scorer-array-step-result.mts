/**
 * Repro: a scorer whose preprocess step returns an array works with scorer.run(), but in a dataset
 * experiment its score is never stored. The error is only logged; the experiment summary still
 * reports the score. Run: npx tsx issues/repros/scorer-array-step-result.mts
 */
import { createScorer } from '@mastra/core/evals';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';

const scorer = createScorer({ id: 'array-step', description: 'preprocess returns an array' })
  .preprocess(() => [1, 2, 3])
  .generateScore(({ results }) => (results.preprocessStepResult as number[]).length / 3);

console.log('scorer.run():', (await scorer.run({ input: 'x', output: 'y' })).score);

const mastra = new Mastra({ storage: new LibSQLStore({ id: 'repro', url: ':memory:' }), logger: false });
const dataset = await mastra.datasets.create({ name: 'repro' });
await dataset.addItems({ items: [{ input: 'x' }] });
const summary = await dataset.startExperiment({ task: async () => 'y', scorers: [scorer] });
console.log('experiment summary score:', summary.results[0].scores[0]?.score);
const stored = await (await mastra.getStorage()!.getStore('scores'))!.listScoresByScorerId({ scorerId: 'array-step', pagination: { page: 0, perPage: 10 } });
console.log('stored scores:', stored.scores.length);
