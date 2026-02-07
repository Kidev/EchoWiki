import type { EngineType } from '../../../shared/types/api';
import type { DetectionResult } from '../detect';
import { detectEngine, detectGameTitle, getFileByNormalizedPath } from '../detect';
import { storeAssetBatch, setMeta, getAssetCount } from '../idb';
import type { ProcessedAsset } from './rmmv';
import { processMvFiles } from './rmmv';
import { processMzFiles } from './rmmz';
import { processRm2k3Files } from './rm2k3';
import { processRgssadArchive } from './rgssad';
import { processRgss3aArchive } from './rgss3a';
import { processTcoaalFiles } from './tcoaal';

export type ImportProgress = {
  phase: 'detecting' | 'decrypting' | 'storing' | 'done' | 'error';
  processed: number;
  total: number;
  currentFile: string;
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

function getAssetGenerator(
  engine: EngineType,
  files: File[],
  detection: DetectionResult,
  keyOverride?: string
): AsyncGenerator<ProcessedAsset> | null {
  switch (engine) {
    case 'rmmv':
    case 'rmmv-encrypted':
      return processMvFiles(files, detection.dataRoot, keyOverride);

    case 'rmmz':
    case 'rmmz-encrypted':
      return processMzFiles(files, keyOverride);

    case 'rm2k3':
      return processRm2k3Files(files);

    case 'tcoaal':
      return processTcoaalFiles(files, detection.dataRoot);

    case 'rmxp':
    case 'rmvx': {
      const archiveName = engine === 'rmxp' ? 'Game.rgssad' : 'Game.rgss2a';
      const archiveFile = getFileByNormalizedPath(files, archiveName);
      if (!archiveFile) return null;
      return processRgssadArchive(archiveFile);
    }

    case 'rmvxace': {
      const archiveFile = getFileByNormalizedPath(files, 'Game.rgss3a');
      if (!archiveFile) return null;
      return processRgss3aArchive(archiveFile);
    }

    case 'auto':
      return null;
  }
}

export async function importGameFiles(options: ImportOptions): Promise<void> {
  const { files, engineOverride, keyOverride, onProgress, signal } = options;

  onProgress({
    phase: 'detecting',
    processed: 0,
    total: files.length,
    currentFile: '',
    engine: 'auto',
    gameTitle: '',
  });

  const detection = detectEngine(files);
  const engine = engineOverride && engineOverride !== 'auto' ? engineOverride : detection.engine;

  if (engine === 'auto') {
    onProgress({
      phase: 'error',
      processed: 0,
      total: 0,
      currentFile: '',
      engine: 'auto',
      gameTitle: '',
    });
    throw new Error(
      'Could not detect RPG Maker engine version. Please select the engine manually.'
    );
  }

  const gameTitle = await detectGameTitle(files, engine, detection.dataRoot);

  const generator = getAssetGenerator(
    engine,
    files,
    engineOverride && engineOverride !== 'auto'
      ? { ...detection, engine: engineOverride }
      : detection,
    keyOverride
  );

  if (!generator) {
    throw new Error(`No processor available for engine: ${engine}`);
  }

  const DATA_EXT = /\.(json|xml|txt|csv)$/i;

  let processed = 0;
  const BATCH_SIZE = 50;
  let batch: ProcessedAsset[] = [];

  for await (const asset of generator) {
    if (signal?.aborted) {
      throw new Error('Import cancelled');
    }

    if (DATA_EXT.test(asset.path)) continue;

    batch.push(asset);
    processed++;

    if (batch.length >= BATCH_SIZE) {
      onProgress({
        phase: 'storing',
        processed,
        total: files.length,
        currentFile: asset.path,
        engine,
        gameTitle,
      });

      await storeAssetBatch(batch);
      batch = [];
    } else {
      onProgress({
        phase: 'decrypting',
        processed,
        total: files.length,
        currentFile: asset.path,
        engine,
        gameTitle,
      });
    }
  }

  if (batch.length > 0) {
    await storeAssetBatch(batch);
  }

  const assetCount = await getAssetCount();
  await setMeta({
    engine,
    gameTitle,
    importedAt: Date.now(),
    assetCount,
  });

  onProgress({
    phase: 'done',
    processed,
    total: processed,
    currentFile: '',
    engine,
    gameTitle,
  });
}
