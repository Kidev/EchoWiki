// Advanced, moderator-supplied import hooks. These let an advanced moderator
// fix a parsing bug for their game (e.g. the GTA / RenderWare TXD channel and
// palette colour ordering) WITHOUT an app code change, in two stages:
//
//   - pre-parse: sees each raw file BEFORE the built-in decoders and may emit
//                 its own assets (or fall through by returning null).
//   - post-process: sees each asset the built-in decoders produced and may
//                 tweak its bytes (e.g. swap R/B channels) or drop it.
//
// Both are UNTRUSTED and run through the same opaque-origin, network-isolated
// sandbox as the custom transform (src/client/lib/sandbox.ts): they can read
// what they are given and return a result, nothing more.

import type { ProcessedAsset } from "./rmmv";
import { fileToPayload, sandboxPostProcess, sandboxPreParse } from "../sandbox";

// Raw pre-parse over every file: the hook may fully re-parse a format the
// built-in decoders mishandle and return assets, or return null to defer.
export async function* processPreParse(
  files: File[],
  code: string,
): AsyncGenerator<ProcessedAsset> {
  for (const file of files) {
    let result: Awaited<ReturnType<typeof sandboxPreParse>>;
    try {
      result = await sandboxPreParse(await fileToPayload(file), code);
    } catch {
      continue; // A throwing hook defers this file to the built-in decoders.
    }
    if (!result) continue;
    for (const a of result) {
      if (!a || typeof a.path !== "string" || !a.path || !a.data) continue;
      yield {
        path: a.path.toLowerCase().replace(/\\/g, "/"),
        blob: new Blob([a.data], { type: a.mimeType }),
        mimeType: a.mimeType,
      };
    }
  }
}

// Post-process a single produced asset. Returns the (possibly modified) asset,
// or null to drop it. On any hook error the ORIGINAL asset is kept unchanged so
// a buggy hook degrades gracefully rather than corrupting the import.
export async function applyPostProcess(
  asset: ProcessedAsset,
  code: string,
): Promise<ProcessedAsset | null> {
  const data = await asset.blob.arrayBuffer();
  let result: Awaited<ReturnType<typeof sandboxPostProcess>>;
  try {
    result = await sandboxPostProcess(
      { path: asset.path, mimeType: asset.mimeType, data },
      code,
    );
  } catch {
    return asset;
  }
  if (!result) return null; // The hook chose to drop this asset.
  if (!result.data) return asset;
  const path =
    typeof result.path === "string" && result.path ? result.path : asset.path;
  return {
    path: path.toLowerCase().replace(/\\/g, "/"),
    blob: new Blob([result.data], { type: result.mimeType }),
    mimeType: result.mimeType,
  };
}
