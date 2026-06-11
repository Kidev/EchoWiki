import type { ProcessedAsset } from "./rmmv";

export type CustomTransformResult =
  | {
      path: string;
      data: ArrayBuffer;
      mimeType: string;
    }
  | null
  | undefined;

// Compile the user-provided transform code into an async function.
// The code receives a File object and must return:
//   { path: string, data: ArrayBuffer, mimeType: string }: to include the file
//   null or undefined: to skip the file
//
// Available on `file`:
//   file.name, file.size, file.type
//   file.webkitRelativePath  (e.g. "GameFolder/images/characters/hero.png")
//   file.arrayBuffer()       -> Promise<ArrayBuffer>
//   file.text()              -> Promise<string>
function compileTransform(
  code: string,
): (file: File) => Promise<CustomTransformResult> {
  // Using the AsyncFunction constructor avoids needing eval.
  // The code runs in the browser's JS sandbox: no Node or server access.

  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
    ...args: string[]
  ) => (file: File) => Promise<CustomTransformResult>;
  return new AsyncFunction("file", code);
}

export async function* processCustomFiles(
  files: File[],
  transformCode: string,
): AsyncGenerator<ProcessedAsset> {
  let transform: (file: File) => Promise<CustomTransformResult>;
  try {
    transform = compileTransform(transformCode);
  } catch (err) {
    throw new Error(
      `Custom transform compile error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const file of files) {
    let result: CustomTransformResult;
    try {
      result = await transform(file);
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
