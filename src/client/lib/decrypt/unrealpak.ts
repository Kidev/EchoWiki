// Unreal Engine .pak media carver.
//
// A full UE pak/asset reader is not feasible in the browser: shipping titles
// almost always Oodle-compress their pak index and store textures in cooked,
// platform-specific GPU formats (and many encrypt the index). None of that can
// be decoded without proprietary libraries. What *is* reliable is carving the
// self-contained OGG/WAV/PNG/JPEG media that sits uncompressed inside the pak.
//
// The carving engine is shared with the IoStore / UE3 / Frostbite paths in
// `mediacarve`; this module is the thin, pak-flavoured entry point the generic
// scanner has always called.

import type { ProcessedAsset } from "./rmmv";
import { carveMediaFromFile } from "./mediacarve";

export function processUnrealPak(file: File): AsyncGenerator<ProcessedAsset> {
  return carveMediaFromFile(file);
}
