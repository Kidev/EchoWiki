// Isolated executor for UNTRUSTED moderator-supplied JavaScript.
//
// EchoWiki lets a subreddit's moderators provide JS that customises asset
// import (the "custom" engine transform, plus the advanced pre/post parse
// hooks). That code is authored by the moderators of a community but RUNS in
// the browser of any visitor who imports their own game files: a visitor who
// may not trust that community. Running it directly (e.g. `new Function(code)`)
// would give it the visitor's full webview realm: `fetch`, `document`, cookies,
// `localStorage`, the app's same-origin IndexedDB (decrypted assets), and the
// app's `/api/*` session. That is arbitrary code execution against the visitor.
//
// Instead we run it inside a doubly-isolated realm:
//
//   1. A hidden <iframe sandbox="allow-scripts"> WITHOUT `allow-same-origin`.
//      The sandbox attribute gives the frame a unique opaque origin, so the
//      code cannot read the real-origin DOM, cookies, localStorage, or the
//      app's IndexedDB partition: there are simply no app objects in reach.
//   2. A strict Content-Security-Policy (delivered via a <meta> tag in the
//      frame's srcdoc) of `connect-src 'none'` + `default-src 'none'`, which
//      blocks every network primitive (fetch / XHR / WebSocket / sendBeacon /
//      Image()), so the code cannot exfiltrate the visitor's files.
//   3. A Worker (inside the frame) so a runaway/infinite loop in the code runs
//      off the main thread and cannot freeze the visitor's tab; the parent's
//      per-job timeout can then tear the frame down and recover.
//
// The only thing the code can affect is the value it returns, which the parent
// validates before use. This satisfies the rule "reads are fine, but only the
// intended output object may be produced, nothing else may be touched."

export type SandboxAsset = {
  path: string;
  data: ArrayBuffer;
  mimeType: string;
};

// The payload shape sent for a file-oriented job (file-transform / pre-parse).
type FilePayload = {
  name: string;
  size: number;
  type: string;
  webkitRelativePath: string;
  lastModified: number;
  buffer: ArrayBuffer;
};

// The payload shape sent for a post-process job.
type AssetPayload = {
  path: string;
  mimeType: string;
  data: ArrayBuffer;
};

export type SandboxKind =
  | "compile-check"
  | "file-transform"
  | "pre-parse"
  | "post-process";

// Per-job wall-clock budget. A job exceeding this is rejected and the frame is
// rebuilt (killing any hung worker). Generous enough for genuine per-file work.
const DEFAULT_TIMEOUT_MS = 8000;

// Source of the Worker that actually compiles and runs the untrusted code. Kept
// as a string so it can be turned into a blob: URL inside the opaque-origin
// frame. It has no access to the parent realm; it only computes and posts back.
const WORKER_SRC = String.raw`
// Defense in depth: the iframe's CSP (connect-src 'none') already blocks the
// network, but neutralize every network primitive in the worker realm too so
// exfiltration is impossible even if a browser fails to propagate that CSP to a
// blob worker. Removed before any untrusted code runs; the Function constructor
// cannot reconstruct them once gone. (Non-network APIs like TextDecoder /
// OffscreenCanvas / createImageBitmap are intentionally left available.)
(function () {
  var blocked = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "Request",
    "navigator",
  ];
  for (var i = 0; i < blocked.length; i++) {
    try {
      Object.defineProperty(self, blocked[i], {
        value: undefined,
        writable: false,
        configurable: false,
      });
    } catch (e) {
      try {
        self[blocked[i]] = undefined;
      } catch (e2) {}
    }
  }
})();
var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
var MAX_OUTPUT = 64 * 1024 * 1024; // 64 MB cap on any single returned buffer

function toArrayBuffer(d) {
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) {
    return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
  }
  return null;
}

function collect(v, out) {
  if (v instanceof ArrayBuffer) out.push(v);
  else if (Array.isArray(v)) {
    for (var i = 0; i < v.length; i++) collect(v[i], out);
  } else if (v && typeof v === "object") {
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) collect(v[k], out);
    }
  }
}

function normAsset(r) {
  if (!r) return null;
  var data = toArrayBuffer(r.data);
  if (!data) return null;
  if (typeof r.path !== "string" || !r.path) return null;
  if (data.byteLength > MAX_OUTPUT) throw new Error("sandbox output too large");
  return {
    path: r.path,
    data: data,
    mimeType: typeof r.mimeType === "string" ? r.mimeType : "application/octet-stream",
  };
}

function makeFile(p) {
  var buf = p.buffer;
  return {
    name: p.name,
    size: p.size,
    type: p.type,
    webkitRelativePath: p.webkitRelativePath,
    lastModified: p.lastModified || 0,
    arrayBuffer: function () {
      return Promise.resolve(buf.slice(0));
    },
    text: function () {
      return Promise.resolve(new TextDecoder().decode(buf));
    },
  };
}

async function handleJob(m) {
  if (m.kind === "compile-check") {
    // Throws on a syntax error; the catch below reports it to the parent.
    new AsyncFunction("file", m.code);
    return true;
  }
  if (m.kind === "post-process") {
    var fn = new AsyncFunction("asset", m.code);
    var asset = { path: m.payload.path, mimeType: m.payload.mimeType, data: m.payload.data };
    return normAsset(await fn(asset));
  }
  // file-transform | pre-parse
  var f = new AsyncFunction("file", m.code);
  var result = await f(makeFile(m.payload));
  if (m.kind === "pre-parse") {
    if (!result) return null;
    var arr = Array.isArray(result) ? result : [result];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var a = normAsset(arr[i]);
      if (a) out.push(a);
    }
    return out;
  }
  return normAsset(result); // file-transform
}

self.onmessage = function (e) {
  var m = e.data;
  handleJob(m).then(
    function (res) {
      var t = [];
      collect(res, t);
      self.postMessage({ id: m.id, ok: true, result: res }, t);
    },
    function (err) {
      self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
    },
  );
};
`;

// Tiny bootstrap that runs inside the opaque-origin frame: it spins up the
// worker and relays messages between the parent window and the worker,
// transferring any ArrayBuffers on each hop to avoid extra copies.
const FRAME_BOOTSTRAP = String.raw`
function collect(v, out) {
  if (v instanceof ArrayBuffer) out.push(v);
  else if (Array.isArray(v)) {
    for (var i = 0; i < v.length; i++) collect(v[i], out);
  } else if (v && typeof v === "object") {
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) collect(v[k], out);
    }
  }
}
var w;
try {
  var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
  w = new Worker(url);
} catch (err) {
  parent.postMessage({ __sandboxError: String((err && err.message) || err) }, "*");
}
if (w) {
  w.onmessage = function (e) {
    var t = [];
    collect(e.data, t);
    parent.postMessage(e.data, "*", t);
  };
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var t = [];
    collect(e.data, t);
    w.postMessage(e.data, t);
  });
  parent.postMessage({ __sandboxReady: true }, "*");
}
`;

function buildSrcdoc(): string {
  const csp =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; " +
    "worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'";
  // WORKER_SRC is embedded as a JS string literal so the bootstrap can blob it.
  const script =
    "var WORKER_SRC = " + JSON.stringify(WORKER_SRC) + ";\n" + FRAME_BOOTSTRAP;
  return (
    "<!doctype html><html><head>" +
    '<meta http-equiv="Content-Security-Policy" content="' +
    csp +
    '"></head><body><script>' +
    script +
    // Split so the literal closing tag never appears verbatim in source.
    "</scr" +
    "ipt></body></html>"
  );
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let messageHandler: ((e: MessageEvent) => void) | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function teardownFrame(reason: string): void {
  if (messageHandler) {
    window.removeEventListener("message", messageHandler);
    messageHandler = null;
  }
  if (frame) {
    frame.remove();
    frame = null;
  }
  ready = null;
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  pending.clear();
}

function ensureFrame(): Promise<void> {
  if (ready && frame) return ready;

  const el = document.createElement("iframe");
  // Opaque origin: scripts allowed, but no same-origin access to the parent.
  el.setAttribute("sandbox", "allow-scripts");
  el.setAttribute("aria-hidden", "true");
  el.style.display = "none";
  el.srcdoc = buildSrcdoc();
  frame = el;

  ready = new Promise<void>((resolve, reject) => {
    const onReady = (e: MessageEvent): void => {
      if (e.source !== el.contentWindow) return;
      const data = e.data as
        | { __sandboxReady?: boolean; __sandboxError?: string }
        | undefined;
      if (!data || typeof data !== "object") return;
      if (data.__sandboxError) {
        teardownFrame("sandbox unavailable: " + data.__sandboxError);
        reject(new Error("sandbox unavailable: " + data.__sandboxError));
      } else if (data.__sandboxReady) {
        resolve();
      }
    };
    messageHandler = (e: MessageEvent): void => {
      if (e.source !== el.contentWindow) return;
      const data = e.data as
        | {
            __sandboxReady?: boolean;
            __sandboxError?: string;
            id?: number;
            ok?: boolean;
            result?: unknown;
            error?: string;
          }
        | undefined;
      if (!data || typeof data !== "object") return;
      onReady(e);
      if (typeof data.id !== "number") return;
      const p = pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error || "sandbox error"));
    };
    window.addEventListener("message", messageHandler);
    document.body.appendChild(el);
  });
  return ready;
}

async function postJob(
  kind: SandboxKind,
  code: string,
  payload: FilePayload | AssetPayload | Record<string, never>,
  timeoutMs: number,
): Promise<unknown> {
  await ensureFrame();
  const win = frame?.contentWindow;
  if (!win) throw new Error("sandbox frame not available");
  const id = ++seq;
  const transfer: Transferable[] = [];
  if ("buffer" in payload && payload.buffer instanceof ArrayBuffer) {
    transfer.push(payload.buffer);
  }
  if ("data" in payload && payload.data instanceof ArrayBuffer) {
    transfer.push(payload.data);
  }
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A timeout means the worker is hung (e.g. an infinite loop in the
      // untrusted code). Rebuild the whole frame to terminate it.
      teardownFrame("sandbox timed out");
      reject(new Error("sandbox timed out"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    win.postMessage({ id, kind, code, payload }, "*", transfer);
  });
}

// Read a File into the transferable payload the sandbox expects. Reading the
// bytes happens in the trusted parent; the untrusted code only ever sees them.
export async function fileToPayload(file: File): Promise<FilePayload> {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    webkitRelativePath: file.webkitRelativePath,
    lastModified: file.lastModified,
    buffer,
  };
}

// Validate that the untrusted code at least compiles, surfacing a clear error.
export async function sandboxCompileCheck(code: string): Promise<void> {
  await postJob("compile-check", code, {}, DEFAULT_TIMEOUT_MS);
}

// Run a file-oriented transform. Returns the produced asset, or null to skip.
export async function sandboxFileTransform(
  payload: FilePayload,
  code: string,
): Promise<SandboxAsset | null> {
  return (await postJob(
    "file-transform",
    code,
    payload,
    DEFAULT_TIMEOUT_MS,
  )) as SandboxAsset | null;
}

// Run a raw pre-parse over a file. Returns an array of assets, or null to fall
// through to the built-in decoders.
export async function sandboxPreParse(
  payload: FilePayload,
  code: string,
): Promise<SandboxAsset[] | null> {
  return (await postJob("pre-parse", code, payload, DEFAULT_TIMEOUT_MS)) as
    | SandboxAsset[]
    | null;
}

// Run a post-process over a single produced asset. Returns the (possibly
// modified) asset, or null to drop it.
export async function sandboxPostProcess(
  payload: AssetPayload,
  code: string,
): Promise<SandboxAsset | null> {
  return (await postJob(
    "post-process",
    code,
    payload,
    DEFAULT_TIMEOUT_MS,
  )) as SandboxAsset | null;
}
