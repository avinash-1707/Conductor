import { NoObjectGeneratedError } from "ai";
import type { LlmCallObservation, ModelTier } from "@conductor/shared";

type Usage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

type ObjectResult<T> = {
  object: T;
  usage: Usage;
  providerMetadata?: unknown;
};

export interface LlmCallConfig {
  model: string;
  tier: ModelTier;
  operation: string;
  promptVersion: string;
  onObservation?: (observation: LlmCallObservation) => Promise<void>;
}

const REPAIR_INSTRUCTION =
  "The previous response did not match the required structured output. Return only a complete response that conforms to the requested schema.";

function costUsd(providerMetadata: unknown): number | null {
  if (
    typeof providerMetadata !== "object" ||
    providerMetadata === null ||
    !("openrouter" in providerMetadata)
  ) {
    return null;
  }
  const openrouter = providerMetadata.openrouter;
  if (typeof openrouter !== "object" || openrouter === null || !("usage" in openrouter)) {
    return null;
  }
  const usage = openrouter.usage;
  if (typeof usage !== "object" || usage === null || !("cost" in usage)) return null;
  return typeof usage.cost === "number" && usage.cost >= 0 ? usage.cost : null;
}

async function record(
  config: LlmCallConfig,
  result: { usage?: Usage; providerMetadata?: unknown },
  latencyMs: number,
  repaired: boolean,
): Promise<void> {
  await config.onObservation?.({
    operation: config.operation,
    model: config.model,
    tier: config.tier,
    promptVersion: config.promptVersion,
    latencyMs,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    totalTokens: result.usage?.totalTokens ?? null,
    costUsd: costUsd(result.providerMetadata),
    repaired,
  });
}

/** Runs one structured-output call and makes a single explicit repair retry. */
export async function runLlmCall<T>(
  config: LlmCallConfig,
  call: (repairInstruction?: string) => Promise<ObjectResult<T>>,
): Promise<T> {
  const execute = async (repaired: boolean): Promise<T> => {
    const startedAt = Date.now();
    try {
      const result = await call(repaired ? REPAIR_INSTRUCTION : undefined);
      await record(config, result, Date.now() - startedAt, repaired);
      return result.object;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        await record(config, error, Date.now() - startedAt, repaired);
      }
      throw error;
    }
  };

  try {
    return await execute(false);
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    return execute(true);
  }
}
