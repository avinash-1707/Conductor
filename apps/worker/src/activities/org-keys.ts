import { ApplicationFailure } from "@temporalio/activity";
import { repos } from "../db";
import { decryptApiKey } from "../secrets";

/**
 * Resolves the org's OpenRouter API key for an agent activity: ciphertext from
 * `org_api_keys` (org-scoped repo), decrypted at call time with the worker's
 * platform key (invariant 12). Agents always run on the customer's key —
 * Conductor's own credentials are never used for customer runs.
 *
 * Classification: a missing or undecryptable key is a configuration problem —
 * non-retryable, so Temporal never burns retries on it. A database error
 * throws normally and stays retryable. Error messages never contain key
 * material (plaintext or ciphertext).
 */
export async function resolveOrgApiKey(orgId: string): Promise<string> {
  const row = await repos.apiKeys.findOrgApiKey({ orgId });
  if (!row) {
    throw ApplicationFailure.nonRetryable(
      "No OpenRouter API key is configured for this organization. An owner must add one in Settings before runs can execute.",
      "MissingOrgApiKey",
    );
  }
  try {
    return decryptApiKey(row.ciphertext);
  } catch {
    throw ApplicationFailure.nonRetryable(
      "The organization's OpenRouter API key could not be decrypted. Re-save the key in Settings.",
      "OrgApiKeyDecryptFailed",
    );
  }
}
