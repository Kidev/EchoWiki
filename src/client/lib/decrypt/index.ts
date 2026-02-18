import type { EngineType } from "../../../shared/types/api";
import type { DetectionResult } from "../detect";
import { detectEngine, detectGameTitle, getFileByNormalizedPath } from "../detect";
import { storeAssetBatch, setMeta, getAssetCount } from "../idb";
import type { ProcessedAsset } from "./rmmv";
import { processMvFiles } from "./rmmv";
import { processMzFiles } from "./rmmz";
import { processRm2k3Files } from "./rm2k3";
import { processRgssadArchive } from "./rgssad";
import { processRgss3aArchive } from "./rgss3a";
import { processTcoaalFiles } from "./tcoaal";
import { processZipArchive } from "./zip";

export type ImportProgress = {
  phase: "detecting" | "decrypting" | "storing" | "done" | "error";
  processed: number;
  total: number;
  engine: EngineType;
  gameTitle: string;
};

export type ImportOptions = {
  files: File[];
  engineOverride?: EngineType | undefined;
  keyOverride?: string | undefined;
  onProgress: (progress: ImportProgress) => void;
  signal?: AbortSignal | undefined;
};

async function getRtpDatNames(files: File[]): Promise<string[]> {
  const confFile = getFileByNormalizedPath(files, "mkxp.conf");
  if (!confFile) return [];
  try {
    const text = await confFile.text();
    const names: string[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      const match = /^RTP\s*=\s*(.+)$/i.exec(trimmed);
      if (match?.[1]) {
        const name = match[1].trim();
        if (name) names.push(name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

async function sniffDatFormat(file: File): Promise<"rgssad" | "zip" | "unknown"> {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (
    header.length >= 7 &&
    header[0] === 0x52 &&
    header[1] === 0x47 &&
    header[2] === 0x53 &&
    header[3] === 0x53 &&
    header[4] === 0x41 &&
    header[5] === 0x44 &&
    header[6] === 0x00
  ) {
    return "rgssad";
  }
  if (
    header.length >= 4 &&
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04
  ) {
    return "zip";
  }
  return "unknown";
}

async function* chainGenerators(
  generators: AsyncGenerator<ProcessedAsset>[],
): AsyncGenerator<ProcessedAsset> {
  for (const gen of generators) {
    yield* gen;
  }
}

function getAssetGenerator(
  engine: EngineType,
  files: File[],
  detection: DetectionResult,
  keyOverride?: string,
): AsyncGenerator<ProcessedAsset> | null {
  switch (engine) {
    case "rmmv":
    case "rmmv-encrypted":
      return processMvFiles(files, detection.dataRoot, keyOverride);

    case "rmmz":
    case "rmmz-encrypted":
      return processMzFiles(files, keyOverride);

    case "rm2k3":
      return processRm2k3Files(files);

    case "tcoaal":
      return processTcoaalFiles(files, detection.dataRoot);

    case "rmxp":
    case "rmvx": {
      const archiveName = engine === "rmxp" ? "Game.rgssad" : "Game.rgss2a";
      const archiveFile = getFileByNormalizedPath(files, archiveName);
      if (!archiveFile) return null;
      return processRgssadArchive(archiveFile);
    }

    case "rmvxace": {
      const archiveFile = getFileByNormalizedPath(files, "Game.rgss3a");
      if (!archiveFile) return null;
      return processRgss3aArchive(archiveFile);
    }

    case "auto":
      return null;
  }
}

export async function importGameFiles(options: ImportOptions): Promise<void> {
  const { files, engineOverride, keyOverride, onProgress, signal } = options;

  onProgress({
    phase: "detecting",
    processed: 0,
    total: 0,
    engine: "auto",
    gameTitle: "",
  });

  const detection = detectEngine(files);
  let engine = engineOverride && engineOverride !== "auto" ? engineOverride : detection.engine;

  if (engine === "auto") {
    onProgress({
      phase: "error",
      processed: 0,
      total: 0,
      engine: "auto",
      gameTitle: "",
    });
    throw new Error("Could not import: select a valid RPG Maker game root folder");
  }

  let gameTitle = await detectGameTitle(files, engine, detection.dataRoot);

  const DATA_EXT = /\.(json|xml|txt|csv)$/i;

  const extractAssets = async (eng: EngineType): Promise<ProcessedAsset[]> => {
    let gen = getAssetGenerator(
      eng,
      files,
      engineOverride && engineOverride !== "auto"
        ? { ...detection, engine: engineOverride }
        : detection,
      keyOverride,
    );

    if (eng === "rmxp" || eng === "rmvx" || eng === "rmvxace") {
      const rtpNames = await getRtpDatNames(files);
      if (rtpNames.length > 0) {
        const rtpGenerators: AsyncGenerator<ProcessedAsset>[] = [];
        if (gen) rtpGenerators.push(gen);

        for (const name of rtpNames) {
          const datFile = getFileByNormalizedPath(files, name);
          if (!datFile) continue;
          const format = await sniffDatFormat(datFile);
          if (format === "zip") {
            rtpGenerators.push(processZipArchive(datFile));
          } else if (format === "rgssad") {
            if (eng === "rmvxace") {
              rtpGenerators.push(processRgss3aArchive(datFile));
            } else {
              rtpGenerators.push(processRgssadArchive(datFile));
            }
          }
        }

        if (rtpGenerators.length > 0) {
          gen = chainGenerators(rtpGenerators);
        }
      }
    }

    if (!gen) return [];

    const assets: ProcessedAsset[] = [];
    let count = 0;
    for await (const asset of gen) {
      if (signal?.aborted) throw new Error("Import cancelled");
      if (DATA_EXT.test(asset.path)) continue;
      assets.push(asset);
      count++;
      if (count % 20 === 0) {
        onProgress({ phase: "decrypting", processed: count, total: 0, engine: eng, gameTitle });
      }
    }
    return assets;
  };

  let allAssets = await extractAssets(engine);

  if (
    allAssets.length === 0 &&
    engineOverride &&
    engineOverride !== "auto" &&
    detection.engine !== "auto" &&
    detection.engine !== engineOverride
  ) {
    engine = detection.engine;
    gameTitle = await detectGameTitle(files, engine, detection.dataRoot);
    allAssets = await extractAssets(engine);
  }

  const total = allAssets.length;
  const BATCH_SIZE = 50;
  let stored = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    if (signal?.aborted) {
      throw new Error("Import cancelled");
    }

    const batch = allAssets.slice(i, i + BATCH_SIZE);
    await storeAssetBatch(batch);
    stored += batch.length;

    onProgress({
      phase: "storing",
      processed: stored,
      total,
      engine,
      gameTitle,
    });
  }

  const assetCount = await getAssetCount();
  await setMeta({
    engine,
    gameTitle,
    importedAt: Date.now(),
    assetCount,
  });

  onProgress({
    phase: "done",
    processed: total,
    total,
    engine,
    gameTitle,
  });
}
