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
    const normalized =
      slashIdx >= 0 ? rel.slice(slashIdx + 1).toLowerCase() : rel.toLowerCase();
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

  if (hasExt(idx, ".rpa")) {
    return { engine: "generic", dataRoot: "", hasEncryption: false };
  }

  if (hasExt(idx, ".pck")) {
    return { engine: "godot", dataRoot: "", hasEncryption: false };
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

  if (
    hasPathPrefix(idx, "www/") &&
    (hasExt(idx, ".rpgmvp") || hasExt(idx, ".rpgmvo"))
  ) {
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

  if (
    hasPath(idx, "data.win") ||
    hasPath(idx, "game.ios") ||
    hasPath(idx, "game.unx")
  ) {
    return { engine: "generic", dataRoot: "", hasEncryption: false };
  }

  if (hasPath(idx, "www/data/system.json")) {
    return { engine: "rmmv", dataRoot: "www/", hasEncryption: false };
  }
  if (hasPath(idx, "data/system.json")) {
    return { engine: "rmmz", dataRoot: "", hasEncryption: false };
  }

  // Generic archive heuristics: checked only after all specific engine
  // fingerprints, since these extensions also appear in unrelated runtimes
  // (e.g. NW.js/Chromium ships resources.pak, so TCOAAL and RPG Maker MV/MZ
  // games must be matched above before this catches their runtime files).

  // Bethesda Creation/Gamebryo archives (Skyrim, Fallout, Oblivion).
  if (hasExt(idx, ".bsa") || hasExt(idx, ".ba2")) {
    return { engine: "bethesda", dataRoot: "", hasEncryption: false };
  }

  // Source / Source 2 (Valve): VPK package sets.
  if (hasExt(idx, ".vpk")) {
    return { engine: "source", dataRoot: "", hasEncryption: false };
  }

  // Call of Duty (IW engine): .iwd ZIP archives.
  if (hasExt(idx, ".iwd")) {
    return { engine: "cod", dataRoot: "", hasEncryption: false };
  }

  // id Tech 3/4 lineage: Quake III / RtCW .pk3, Doom 3 .pk4.
  if (hasExt(idx, ".pk3") || hasExt(idx, ".pk4")) {
    return { engine: "idtech3", dataRoot: "", hasEncryption: false };
  }

  // Rockstar RAGE (GTA IV/V, RDR) and id Tech 5 (RAGE) megatexture containers.
  if (hasExt(idx, ".rpf") || hasExt(idx, ".resources")) {
    return { engine: "rage", dataRoot: "", hasEncryption: false };
  }

  // Doom (id Tech 1): IWAD/PWAD. Distinguished from GoldSrc/Quake .wad by the
  // absence of BSP/SPR siblings and presence of the classic IWAD names.
  if (
    hasExt(idx, ".wad") &&
    !hasExt(idx, ".bsp") &&
    (hasPath(idx, "doom.wad") ||
      hasPath(idx, "doom2.wad") ||
      hasPath(idx, "doom1.wad") ||
      hasPath(idx, "heretic.wad") ||
      hasPath(idx, "hexen.wad") ||
      hasPath(idx, "tnt.wad") ||
      hasPath(idx, "plutonia.wad"))
  ) {
    return { engine: "doom", dataRoot: "", hasEncryption: false };
  }

  // GoldSrc (Quake-derived): WAD3 texture archives, optionally with .bsp maps.
  if (hasExt(idx, ".wad") || (hasExt(idx, ".bsp") && hasExt(idx, ".spr"))) {
    return { engine: "goldsrc", dataRoot: "", hasEncryption: false };
  }

  // Quake / Quake II: PAK archives ("PACK") sit alongside .bsp maps.
  if (hasExt(idx, ".pak") && hasExt(idx, ".bsp")) {
    return { engine: "quake", dataRoot: "", hasEncryption: false };
  }

  // RenderWare-era GTA: IMG archives or loose TXD texture dictionaries.
  if (hasExt(idx, ".img") || hasExt(idx, ".txd")) {
    return { engine: "gta", dataRoot: "", hasEncryption: false };
  }

  // Frostbite: cas/sb bundles addressed by a .toc table of contents.
  if (hasExt(idx, ".cas") || (hasExt(idx, ".sb") && hasExt(idx, ".toc"))) {
    return { engine: "frostbite", dataRoot: "", hasEncryption: false };
  }

  // Unreal Engine: classic .pak archives or the UE4.25+/UE5 IoStore (.ucas)
  // and legacy UE3 packages (.upk). All routed through the media carver.
  if (hasExt(idx, ".pak") || hasExt(idx, ".ucas") || hasExt(idx, ".upk")) {
    return { engine: "unreal", dataRoot: "", hasEncryption: false };
  }

  // Unity builds: asset bundles or serialized files (Texture2D extraction)
  if (
    hasExt(idx, ".assets") ||
    hasExt(idx, ".bundle") ||
    hasExt(idx, ".unity3d") ||
    hasExt(idx, ".assetbundle") ||
    hasPath(idx, "globalgamemanagers")
  ) {
    return { engine: "unity", dataRoot: "", hasEncryption: false };
  }

  // Fallback: if there are any image/audio files anywhere in the tree, use generic scan
  const MEDIA_EXTS = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp",
    ".ogg",
    ".mp3",
    ".m4a",
    ".wav",
    ".mid",
    ".opus",
    ".flac",
    ".mp4",
    ".webm",
  ];
  for (const ext of MEDIA_EXTS) {
    if (hasExt(idx, ext)) {
      return { engine: "generic", dataRoot: "", hasEncryption: false };
    }
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
      const systemFile = idx.byName.get(
        `${dataRoot}data/system.json`.toLowerCase(),
      );
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
    case "goldsrc": {
      // liblist.gam: game "Half-Life"
      const gam = idx.byName.get("liblist.gam");
      if (gam) {
        try {
          const match = /^\s*game\s+"([^"]+)"/m.exec(await gam.text());
          if (match?.[1]) return match[1].trim();
        } catch {}
      }
      break;
    }
    case "source": {
      // gameinfo.txt: game "Half-Life 2" (inside the GameInfo block)
      const info = idx.byName.get("gameinfo.txt");
      if (info) {
        try {
          const match = /^\s*game\s+"([^"]+)"/m.exec(await info.text());
          if (match?.[1]) return match[1].trim();
        } catch {}
      }
      break;
    }
    case "rm2k3":
    case "gta":
    case "frostbite":
    case "auto":
      break;
  }

  return "";
}

export function getFileByNormalizedPath(
  files: File[],
  path: string,
): File | undefined {
  const lower = path.toLowerCase();
  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf("/");
    const normalized =
      slashIdx >= 0 ? rel.slice(slashIdx + 1).toLowerCase() : rel.toLowerCase();
    if (normalized === lower) return file;
  }
  return undefined;
}

export function getFilesByExtension(files: File[], ext: string): File[] {
  const lower = ext.toLowerCase();
  return files.filter((f) => f.name.toLowerCase().endsWith(lower));
}
