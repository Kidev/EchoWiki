// Parse a JSON-ish mapping block ("from": "to" pairs, with // and /* */ comments)
// into lowercased [from, to] tuples.
export function parseMappingText(text: string): Array<[string, string]> {
  const cleaned = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const pairRegex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  const results: Array<[string, string]> = [];
  let match;
  while ((match = pairRegex.exec(cleaned)) !== null) {
    results.push([match[1]!.toLowerCase(), match[2]!.toLowerCase()]);
  }
  return results;
}
