// Minimal line-based git-style 3-way merge (diff3). Used when a moderator
// reverts or post-mortem-approves a past decision and the affected page has
// changed since: we merge the version being applied (`theirs`) into the live
// page (`ours`) relative to the snapshot at the time of the original action
// (`base`). Clean merges apply silently; conflicts are emitted with git-style
// markers and flagged so the caller can warn.

/** LCS match map: `match[i]` is the index in `other` that base line `i` maps to, or -1. */
function lcsMatch(base: string[], other: string[]): number[] {
  const n = base.length;
  const m = other.length;
  // dp[i][j] = LCS length of base[i:] and other[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        base[i] === other[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return match;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type MergeResult = { merged: string; conflict: boolean };

export function threeWayMerge(
  base: string,
  ours: string,
  theirs: string,
  labels: { ours: string; theirs: string } = {
    ours: "current page",
    theirs: "incoming",
  },
): MergeResult {
  // Fast paths.
  if (ours === theirs) return { merged: ours, conflict: false };
  if (base === ours) return { merged: theirs, conflict: false };
  if (base === theirs) return { merged: ours, conflict: false };

  const baseL = base.split("\n");
  const oursL = ours.split("\n");
  const theirsL = theirs.split("\n");

  // Guard against pathological sizes (the LCS table is O(n*m)).
  if (
    baseL.length * oursL.length > 4_000_000 ||
    baseL.length * theirsL.length > 4_000_000
  ) {
    return {
      merged: `<<<<<<< ${labels.ours}\n${ours}\n=======\n${theirs}\n>>>>>>> ${labels.theirs}`,
      conflict: true,
    };
  }

  const matchO = lcsMatch(baseL, oursL);
  const matchT = lcsMatch(baseL, theirsL);

  // Stable anchors: base lines present (unchanged) in BOTH ours and theirs.
  const anchors: { b: number; o: number; t: number }[] = [];
  for (let b = 0; b < baseL.length; b++) {
    if (matchO[b]! >= 0 && matchT[b]! >= 0) {
      anchors.push({ b, o: matchO[b]!, t: matchT[b]! });
    }
  }
  anchors.push({ b: baseL.length, o: oursL.length, t: theirsL.length });

  const out: string[] = [];
  let conflict = false;
  let prevB = -1;
  let prevO = -1;
  let prevT = -1;

  for (const a of anchors) {
    const baseSlice = baseL.slice(prevB + 1, a.b);
    const ourSlice = oursL.slice(prevO + 1, a.o);
    const theirSlice = theirsL.slice(prevT + 1, a.t);

    const oursChanged = !arraysEqual(ourSlice, baseSlice);
    const theirsChanged = !arraysEqual(theirSlice, baseSlice);

    if (!oursChanged && !theirsChanged) {
      // region unchanged on both sides
      out.push(...baseSlice);
    } else if (oursChanged && !theirsChanged) {
      out.push(...ourSlice);
    } else if (!oursChanged && theirsChanged) {
      out.push(...theirSlice);
    } else if (arraysEqual(ourSlice, theirSlice)) {
      out.push(...ourSlice);
    } else {
      conflict = true;
      out.push(`<<<<<<< ${labels.ours}`);
      out.push(...ourSlice);
      out.push("=======");
      out.push(...theirSlice);
      out.push(`>>>>>>> ${labels.theirs}`);
    }

    if (a.b < baseL.length) out.push(baseL[a.b]!); // emit the anchor line itself
    prevB = a.b;
    prevO = a.o;
    prevT = a.t;
  }

  return { merged: out.join("\n"), conflict };
}
