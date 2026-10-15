export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13;

/** whether `value` could be one JSON object: `{` first and `}` last, ignoring JSON's own whitespace */
function looksLikeObject(value: string): boolean {
  let start = 0;
  let end = value.length - 1;
  while (start <= end && isJsonSpace(value.charCodeAt(start))) start += 1;
  while (end > start && isJsonSpace(value.charCodeAt(end))) end -= 1;
  return end > start && value.charCodeAt(start) === 123 && value.charCodeAt(end) === 125;
}

/**
 * a tool call's args or result as an object, whether it arrived as one or as its JSON text; `{}` otherwise.
 * A partial JSON prefix (args still streaming) is rejected by its shape before JSON.parse can throw on it.
 */
export function parseObject(value: unknown): Json {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !looksLikeObject(value)) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
