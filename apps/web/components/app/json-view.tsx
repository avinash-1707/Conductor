import { Fragment, type ReactNode } from "react";

/**
 * Pretty-printed, lightly syntax-tinted JSON for the payload inspector
 * (ui-context: payloads render in mono, syntax-tinted, on `--bg-inset`). The
 * tokenizer builds React spans directly — no `dangerouslySetInnerHTML`, so an
 * adversarial payload string can never inject markup. Colors are drawn from the
 * status tokens for a cohesive technical-console feel.
 */

// Matches a JSON string (optionally a key, when followed by `:`), a keyword, or a number.
const TOKEN_RE =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function classFor(token: string): string {
  if (token.startsWith('"')) {
    return token.trimEnd().endsWith(":") ? "text-accent" : "text-completed";
  }
  if (token === "true" || token === "false" || token === "null") {
    return "text-suspended";
  }
  return "text-running";
}

function tint(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN_RE.exec(json)) !== null) {
    if (match.index > last) {
      out.push(<span key={key++} className="text-faint">{json.slice(last, match.index)}</span>);
    }
    const token = match[0];
    out.push(<span key={key++} className={classFor(token)}>{token}</span>);
    last = match.index + token.length;
  }
  if (last < json.length) {
    out.push(<span key={key++} className="text-faint">{json.slice(last)}</span>);
  }
  return out;
}

export function JsonView({ value }: { value: unknown }) {
  let json: string;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    json = String(value);
  }
  if (json === undefined) json = "undefined";
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
      <Fragment>{tint(json)}</Fragment>
    </pre>
  );
}
