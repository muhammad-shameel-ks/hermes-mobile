export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** a tool call's args or result as an object, whether it arrived as one or as its JSON text; `{}` otherwise */
export function parseObject(value: unknown): Json {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
