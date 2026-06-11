/**
 * Sanitizes a `?next=` redirect target (Unit 27): only same-app paths survive
 * — anything not starting with a single `/` (external URLs, protocol-relative
 * `//host`) falls back to null so auth pages use their default destination.
 */
export function safeNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}
