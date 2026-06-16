import type { ProcessedAsset } from "./rmmv";
import {
  fileToPayload,
  sandboxCompileCheck,
  sandboxFileTransform,
} from "../sandbox";

export type CustomTransformResult =
  | {
      path: string;
      data: ArrayBuffer;
      mimeType: string;
    }
  | null
  | undefined;

// Run the moderator-supplied transform over every file. The code is UNTRUSTED:
// it is authored by a subreddit's moderators but executes in the importing
// visitor's browser. It therefore never runs in this realm: `sandbox.ts`
// executes it inside an opaque-origin, network-isolated iframe+worker so it can
// read the file it is given and return a transformed asset, but cannot touch
// the app's DOM, storage, session, or the network. See src/client/lib/sandbox.ts.
//
// The transform receives a `file` object exposing:
//   file.name, file.size, file.type
//   file.webkitRelativePath  (e.g. "GameFolder/images/characters/hero.png")
//   file.arrayBuffer()       -> Promise<ArrayBuffer>
//   file.text()              -> Promise<string>
// and must return { path, data, mimeType } to include the file, or null/
// undefined to skip it.
export async function* processCustomFiles(
  files: File[],
  transformCode: string,
): AsyncGenerator<ProcessedAsset> {
  // Validate the code compiles once up front so a syntax error fails the import
  // with a clear message instead of silently skipping every file.
  try {
    await sandboxCompileCheck(transformCode);
  } catch (err) {
    throw new Error(
      `Custom transform compile error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const file of files) {
    let result: CustomTransformResult;
    try {
      result = await sandboxFileTransform(
        await fileToPayload(file),
        transformCode,
      );
    } catch {
      continue; // Skip files where the transform throws
    }

    if (!result) continue;

    const { path, data, mimeType } = result;
    if (!path || !data) continue;

    yield {
      path: path.toLowerCase().replace(/\\/g, "/"),
      blob: new Blob([data], { type: mimeType }),
      mimeType,
    };
  }
}
