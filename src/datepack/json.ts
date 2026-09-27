/**
 * Pull the first JSON object out of arbitrary text, tolerating the markdown
 * fences and one-line preambles chat assistants often wrap their replies in.
 * Returns undefined when no parseable object is found.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through: try slicing from the first "{" to the last "}".
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
