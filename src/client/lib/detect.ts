import type { EngineType } from "../../shared/types/api";

export type DetectionResult = {
  engine: EngineType;
  dataRoot: string;
  hasEncryption: boolean;
};

type FileIndex = {
  paths: Set<string>;
  byName: Map<string, File>;
  byExt: Map<string, File[]>;
};

function buildIndex(files: File[]): FileIndex {
  const paths = new Set<string>();
  const byName = new Map<string, File>();
  const byExt = new Map<string, File[]>();

  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf("/");
    const normalized = slashIdx >= 0 ? rel.slice(slashIdx + 1).toLowerCase() : rel.toLowerCase();
    paths.add(normalized);
    byName.set(normalized, file);

    const dotIdx = normalized.lastIndexOf(".");
    if (dotIdx >= 0) {
      const ext = normalized.slice(dotIdx);
      const list = byExt.get(ext);
      if (list) {
        list.push(file);
      } else {
        byExt.set(ext, [file]);
      }
    }
  }

  return { paths, byName, byExt };
}

function hasPath(idx: FileIndex, path: string): boolean {
  return idx.paths.has(path.toLowerCase());
}

function hasExt(idx: FileIndex, ext: string): boolean {
  const list = idx.byExt.get(ext.toLowerCase());
  return list !== undefined && list.length > 0;
}

function hasPathPrefix(idx: FileIndex, prefix: string): boolean {
  const lower = prefix.toLowerCase();
  for (const p of idx.paths) {
    if (p.startsWith(lower)) return true;
  }
  return false;
}

export function detectEngine(files: File[]): DetectionResult {
  const idx = buildIndex(files);

  if (hasExt(idx, ".k9a")) {
    return { engine: "tcoaal", dataRoot: "www/", hasEncryption: true };
  }

  if (hasPath(idx, "www/img/system/e5230bf37c4fabb0")) {
    return { engine: "tcoaal", dataRoot: "www/", hasEncryption: true };
  }

  if (hasPath(idx, "Game.rgssad")) {
    return { engine: "rmxp", dataRoot: "", hasEncryption: true };
  }

  if (hasPath(idx, "Game.rgss2a")) {
    return { engine: "rmvx", dataRoot: "", hasEncryption: true };
  }

  if (hasPath(idx, "Game.rgss3a")) {
    return { engine: "rmvxace", dataRoot: "", hasEncryption: true };
  }

  if (hasPathPrefix(idx, "www/") && (hasExt(idx, ".rpgmvp") || hasExt(idx, ".rpgmvo"))) {
    return { engine: "rmmv-encrypted", dataRoot: "www/", hasEncryption: true };
  }

  if (hasPathPrefix(idx, "www/") && hasPath(idx, "www/data/system.json")) {
    return { engine: "rmmv", dataRoot: "www/", hasEncryption: false };
  }

  if (hasExt(idx, ".png_") || hasExt(idx, ".ogg_")) {
    return { engine: "rmmz-encrypted", dataRoot: "", hasEncryption: true };
  }

  if (hasPath(idx, "data/system.json") && hasPath(idx, "js/rmmz_core.js")) {
    return { engine: "rmmz", dataRoot: "", hasEncryption: false };
  }

  if (hasPath(idx, "rpg_rt.ldb") && hasPath(idx, "rpg_rt.lmt")) {
    return { engine: "rm2k3", dataRoot: "", hasEncryption: false };
  }

  if (hasPath(idx, "www/data/system.json")) {
    return { engine: "rmmv", dataRoot: "www/", hasEncryption: false };
  }
  if (hasPath(idx, "data/system.json")) {
    return { engine: "rmmz", dataRoot: "", hasEncryption: false };
  }

  return { engine: "auto", dataRoot: "", hasEncryption: false };
}

export async function detectGameTitle(
  files: File[],
  engine: EngineType,
  dataRoot: string,
): Promise<string> {
  const idx = buildIndex(files);

  switch (engine) {
    case "rmmv":
    case "rmmv-encrypted": {
      const systemFile = idx.byName.get(`${dataRoot}data/system.json`.toLowerCase());
      if (systemFile) {
        try {
          const text = await systemFile.text();
          const json = JSON.parse(text) as { gameTitle?: string };
          if (json.gameTitle) return json.gameTitle;
        } catch {}
      }
      break;
    }
    case "rmmz":
    case "rmmz-encrypted": {
      const systemFile = idx.byName.get("data/system.json");
      if (systemFile) {
        try {
          const text = await systemFile.text();
          const json = JSON.parse(text) as { gameTitle?: string };
          if (json.gameTitle) return json.gameTitle;
        } catch {}
      }
      break;
    }
    case "rmxp":
    case "rmvx":
    case "rmvxace": {
      const iniFile = idx.byName.get("game.ini");
      if (iniFile) {
        try {
          const text = await iniFile.text();
          const match = /^Title=(.+)$/m.exec(text);
          if (match?.[1]) return match[1].trim();
        } catch {}
      }
      break;
    }
    case "tcoaal":
      return "The Coffin of Andy and Leyley";
    case "rm2k3":
    case "auto":
      break;
  }

  return "";
}

export function getFileByNormalizedPath(files: File[], path: string): File | undefined {
  const lower = path.toLowerCase();
  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf("/");
    const normalized = slashIdx >= 0 ? rel.slice(slashIdx + 1).toLowerCase() : rel.toLowerCase();
    if (normalized === lower) return file;
  }
  return undefined;
}

export function getFilesByExtension(files: File[], ext: string): File[] {
  const lower = ext.toLowerCase();
  return files.filter((f) => f.name.toLowerCase().endsWith(lower));
}
