import { LangfuseExporter } from '@mastra/langfuse';
import type { ObservabilityExporter } from '@mastra/core/observability';
import { MastraStorageExporter, Observability } from '@mastra/observability';

/**
 * Tracing: one trace per purchase request, covering every step, both agent
 * calls, and the pause and resume for approval.
 *
 * Traces always go to Mastra storage (Studio's Observability tab). With
 * LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY set they also go to Langfuse
 * (LANGFUSE_BASE_URL for a self-hosted or EU instance).
 */
export function langfuseFromEnv(env = process.env): LangfuseExporter | undefined {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return undefined;
  return new LangfuseExporter({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    environment: env.CARTKEEPER_ENV ?? 'development',
  });
}

export function makeObservability(extra: ObservabilityExporter[] = [], env = process.env) {
  const langfuse = langfuseFromEnv(env);
  return new Observability({
    configs: {
      default: {
        serviceName: 'cartkeeper',
        exporters: [new MastraStorageExporter(), ...(langfuse ? [langfuse] : []), ...extra],
      },
    },
  });
}
