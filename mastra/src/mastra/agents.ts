import { Agent } from '@mastra/core/agent';

/**
 * The two places the model is used. Neither agent has tools: each call is one
 * structured-output generation, with per-call instructions built from the pack
 * (see src/purchase/steps.ts). The model reads and picks; code decides.
 */

export const MODEL_ID = 'anthropic/claude-opus-5-5' as const;
export const API_URL = 'https://api.anthropic.com/v1';

// CARTKEEPER_ANTHROPIC_API_KEY wins so the app's key can't collide with a host
// that sets ANTHROPIC_* for its own use (Claude Code cloud sessions do).
const KEY_VARS = ['CARTKEEPER_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] as const;

export function apiKey(): string | undefined {
  for (const v of KEY_VARS) if (process.env[v]) return process.env[v];
  return undefined;
}

/** Resolved per call, so Studio boots without a key and the error says which variable to set. */
function model() {
  const key = apiKey();
  if (!key) {
    throw new Error('No Anthropic API key. Set CARTKEEPER_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in .env.');
  }
  return {
    id: MODEL_ID,
    apiKey: key,
    // Pinned so an inherited ANTHROPIC_BASE_URL can't reroute the app's calls.
    url: process.env.CARTKEEPER_ANTHROPIC_BASE_URL ?? API_URL,
  };
}

export const intakeAgent = new Agent({
  id: 'intake-agent',
  name: 'Intake',
  description: 'Reads a free-text purchase request from the floor into a structured need.',
  instructions: 'You turn purchase requests from a factory floor into a structured need.',
  model,
});

export const proposeAgent = new Agent({
  id: 'propose-agent',
  name: 'Propose',
  description: 'Picks one option id from the quoted, scored options. It cannot set prices or decisions.',
  instructions: 'You are the purchasing agent for a manufacturer. Pick the single best option for the need.',
  model,
});
