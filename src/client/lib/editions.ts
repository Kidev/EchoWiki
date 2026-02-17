export type CropEdition = { type: "crop" };
export type SpriteEdition = { type: "sprite"; rows: number; cols: number; index: number };
export type PitchEdition = { type: "pitch"; value: number };
export type SpeedEdition = { type: "speed"; value: number };
export type Edition = CropEdition | SpriteEdition | PitchEdition | SpeedEdition;
export type ParsedEchoPath = { basePath: string; editions: Edition[] };

export function parseEditions(echoPath: string): ParsedEchoPath {
  const qIdx = echoPath.indexOf("?");
  if (qIdx === -1) {
    return { basePath: echoPath, editions: [] };
  }

  const basePath = echoPath.slice(0, qIdx);
  const query = echoPath.slice(qIdx + 1);
  const editions: Edition[] = [];

  for (const segment of query.split("&")) {
    const eqIdx = segment.indexOf("=");
    const key = (eqIdx === -1 ? segment : segment.slice(0, eqIdx)).toLowerCase();
    const val = eqIdx === -1 ? "" : segment.slice(eqIdx + 1);

    if (key === "crop") {
      editions.push({ type: "crop" });
    } else if (key === "sprite" && val) {
      const parts = val.split(",");
      if (parts.length >= 3) {
        const cols = parseInt(parts[0]!, 10);
        const rows = parseInt(parts[1]!, 10);
        const index = parseInt(parts[2]!, 10);
        if (!isNaN(rows) && !isNaN(cols) && !isNaN(index)) {
          editions.push({ type: "sprite", rows, cols, index });
        }
      }
    } else if (key === "pitch" && val) {
      const value = parseFloat(val);
      if (!isNaN(value)) {
        editions.push({ type: "pitch", value });
      }
    } else if (key === "speed" && val) {
      const value = parseFloat(val);
      if (!isNaN(value)) {
        editions.push({ type: "speed", value });
      }
    }
  }

  return { basePath, editions };
}

const EDITION_ORDER: Record<Edition["type"], number> = {
  crop: 0,
  sprite: 1,
  speed: 2,
  pitch: 3,
};

export function serializeEditions(basePath: string, editions: Edition[]): string {
  const sorted = [...editions].sort((a, b) => EDITION_ORDER[a.type] - EDITION_ORDER[b.type]);
  const params: string[] = [];
  for (const ed of sorted) {
    switch (ed.type) {
      case "crop":
        params.push("crop");
        break;
      case "sprite":
        params.push(`sprite=${ed.cols},${ed.rows},${ed.index}`);
        break;
      case "pitch":
        params.push(`pitch=${ed.value}`);
        break;
      case "speed":
        params.push(`speed=${ed.value}`);
        break;
    }
  }
  if (params.length === 0) return basePath;
  return `${basePath}?${params.join("&")}`;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Canvas toBlob failed"));
    }, "image/png");
  });
}

export async function applyCropEdition(blob: Blob): Promise<Blob> {
  const img = await loadImage(blob);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);

  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;

  let top = h;
  let bottom = 0;
  let left = w;
  let right = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3]!;
      if (alpha > 0) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (top > bottom || left > right) {
    return blob;
  }

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  const cctx = cropped.getContext("2d")!;
  cctx.drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);

  return canvasToBlob(cropped);
}

export async function applySpriteEdition(
  blob: Blob,
  rows: number,
  cols: number,
  index: number,
): Promise<Blob> {
  const img = await loadImage(blob);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rows);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const sx = col * cellW;
  const sy = row * cellH;

  const canvas = document.createElement("canvas");
  canvas.width = cellW;
  canvas.height = cellH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
  URL.revokeObjectURL(img.src);

  return canvasToBlob(canvas);
}

export async function applyImageEditions(blob: Blob, editions: Edition[]): Promise<Blob> {
  let current = blob;
  const crop = editions.find((e) => e.type === "crop");
  if (crop) {
    current = await applyCropEdition(current);
  }
  const sprite = editions.find((e) => e.type === "sprite");
  if (sprite && sprite.type === "sprite") {
    current = await applySpriteEdition(current, sprite.rows, sprite.cols, sprite.index);
  }
  return current;
}

export type AudioEditionParams = { playbackRate: number };

export function getAudioEditionParams(editions: Edition[]): AudioEditionParams {
  let speed = 1.0;
  let pitch = 0;
  for (const ed of editions) {
    if (ed.type === "speed") speed = ed.value;
    if (ed.type === "pitch") pitch = ed.value;
  }
  const playbackRate = speed * Math.pow(2, pitch / 12);
  return { playbackRate };
}

const editionBlobCache = new Map<string, string>();

export function getEditionBlobUrl(key: string): string | undefined {
  return editionBlobCache.get(key);
}

export function setEditionBlobUrl(key: string, url: string): void {
  editionBlobCache.set(key, url);
}

export function revokeAllEditionBlobUrls(): void {
  for (const url of editionBlobCache.values()) {
    URL.revokeObjectURL(url);
  }
  editionBlobCache.clear();
}
