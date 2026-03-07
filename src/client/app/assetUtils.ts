export function isImagePath(p: string): boolean {
  return /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(p);
}

export function isAudioPath(p: string): boolean {
  return /\.(ogg|mp3|m4a|wav|mid|midi)$/i.test(p);
}

export function getFileName(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

export function getStem(p: string): string {
  const fileName = getFileName(p);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function getExt(p: string): string {
  const fileName = getFileName(p);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot) : "";
}

export function getCategory(p: string): "images" | "audio" | "data" {
  if (isImagePath(p)) return "images";
  if (isAudioPath(p)) return "audio";
  return "data";
}

export function getPrefixes(stem: string): string[] {
  const lower = stem.toLowerCase();
  const positions: number[] = [];
  for (let i = 1; i < lower.length - 1; i++) {
    if (lower[i] === "_" || lower[i] === "-") positions.push(i);
  }
  return positions.map((pos) => lower.slice(0, pos));
}

export function getAssignedGroup(stem: string, groups: readonly string[]): string | null {
  if (groups.length === 0) return null;
  const valid = new Set(groups);
  let longest: string | null = null;
  for (const prefix of getPrefixes(stem.toLowerCase())) {
    if (valid.has(prefix)) longest = prefix;
  }
  return longest;
}

export function groupLabel(g: string): string {
  const s = g.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function detectGroupsForFolder(
  folderPaths: readonly string[],
  effectiveStem?: (p: string) => string,
): string[] {
  const stems = folderPaths.map((p) =>
    (effectiveStem ? effectiveStem(p) : getStem(p)).toLowerCase(),
  );

  const supersetCounts = new Map<string, number>();
  for (const stem of stems) {
    for (const prefix of getPrefixes(stem)) {
      supersetCounts.set(prefix, (supersetCounts.get(prefix) ?? 0) + 1);
    }
  }

  const validPrefixes = new Set(
    [...supersetCounts.entries()].filter(([, c]) => c >= 3).map(([p]) => p),
  );
  if (validPrefixes.size < 2) return [];

  const assignedCounts = new Map<string, number>();
  for (const stem of stems) {
    let longest: string | null = null;
    for (const prefix of getPrefixes(stem)) {
      if (validPrefixes.has(prefix)) longest = prefix;
    }
    if (longest !== null) assignedCounts.set(longest, (assignedCounts.get(longest) ?? 0) + 1);
  }

  const groups = [...assignedCounts.entries()].filter(([, c]) => c >= 3).map(([p]) => p);

  return groups.length >= 2
    ? groups.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    : [];
}

export function getSubfolder(p: string): string | null {
  const parts = p.split("/");
  if (parts.length < 2) return null;
  const folder = parts[parts.length - 2];
  return folder && folder.length > 0 ? folder : null;
}

export function naturalSortKey(p: string, pathToMapped: Map<string, string>): string {
  const mapped = pathToMapped.get(p);
  return getFileName(mapped ?? p).toLowerCase();
}

export function toDisplayName(path: string): string {
  const stem = getStem(path);
  const ext = getExt(path);
  return stem.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + ext;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
