import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { getFileName, isImagePath, isAudioPath } from "../assetUtils";
import { useEchoUrl, preloadPaths } from "../../lib/echo";
import { listAssetPaths } from "../../lib/idb";

function MiniAssetPickerItem({ path, onClick }: { path: string; onClick: () => void }) {
  const isImg = isImagePath(path);
  const { url } = useEchoUrl(isImg ? path : null);
  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center p-1 rounded cursor-pointer hover:bg-[var(--thumb-bg)] shrink-0"
      title={path}
      style={{ width: "56px" }}
    >
      <div className="w-10 h-10 flex items-center justify-center rounded overflow-hidden bg-[var(--thumb-bg)]">
        {isImg ? (
          url ? (
            <img src={url} alt="" className="w-full h-full object-contain" />
          ) : (
            <div className="w-4 h-4 border border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          )
        ) : (
          <svg
            className="w-5 h-5 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"
            />
          </svg>
        )}
      </div>
      <span className="text-[8px] text-[var(--text-muted)] truncate w-full text-center mt-0.5 leading-tight">
        {getFileName(path)}
      </span>
    </div>
  );
}

function MiniAssetPicker({
  type = "images",
  onSelect,
}: {
  type?: "images" | "audio";
  onSelect: (path: string) => void;
}) {
  const [allPaths, setAllPaths] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loadingPaths, setLoadingPaths] = useState(true);

  useEffect(() => {
    void listAssetPaths().then(async (all) => {
      const filtered = type === "images" ? all.filter(isImagePath) : all.filter(isAudioPath);
      setAllPaths(filtered);
      setLoadingPaths(false);
      if (type === "images") await preloadPaths(filtered.slice(0, 60));
    });
  }, [type]);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return allPaths
      .filter((p) => !q || p.toLowerCase().includes(q) || getFileName(p).toLowerCase().includes(q))
      .slice(0, 60);
  }, [allPaths, search]);

  if (loadingPaths) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-[var(--text-muted)]">
        Loading assets…
      </div>
    );
  }
  if (allPaths.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)] py-4 text-center">
        No assets imported yet. Import game files first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search assets…"
        className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
      />
      <div className="flex flex-wrap gap-1 max-h-44 overflow-auto">
        {visible.map((p) => (
          <MiniAssetPickerItem key={p} path={p} onClick={() => onSelect(p)} />
        ))}
      </div>
      {allPaths.length > 60 && !search && (
        <p className="text-[10px] text-[var(--text-muted)] text-center">
          Showing first 60. Use search to find more.
        </p>
      )}
    </div>
  );
}

function InsertDialogShell({
  title,
  onDismiss,
  children,
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--bg)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(90vw, 560px)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <span className="text-sm font-semibold text-[var(--text)]">{title}</span>
          <button
            onClick={onDismiss}
            className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function ImageInsertDialog({
  onInsert,
  onDismiss,
}: {
  onInsert: (text: string) => void;
  onDismiss: () => void;
}) {
  const [path, setPath] = useState("");
  const [alt, setAlt] = useState("");
  const [mode, setMode] = useState<"block" | "emoji">("block");

  const preview = path
    ? mode === "emoji"
      ? `![${alt || getFileName(path)}](echo://${path}?emoji)`
      : `![${alt || getFileName(path)}](echo://${path})`
    : "";

  return (
    <InsertDialogShell title="Insert Image" onDismiss={onDismiss}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-1">Select asset</p>
          <MiniAssetPicker
            type="images"
            onSelect={(p) => {
              setPath(p);
              if (!alt) setAlt(getFileName(p));
            }}
          />
        </div>
        {path && (
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
                Alt text
              </label>
              <input
                type="text"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
                placeholder="Image description"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
                Render mode
              </label>
              <div className="flex gap-2">
                {(["block", "emoji"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`text-xs px-3 py-1 rounded cursor-pointer border transition-colors ${mode === m ? "bg-[var(--accent)] text-white border-transparent" : "border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)]"}`}
                  >
                    {m === "block" ? "Block (normal)" : "Inline emoji-size"}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[var(--thumb-bg)] rounded p-2">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Preview markdown</p>
              <code className="text-xs break-all text-[var(--text)]">{preview}</code>
            </div>
            <button
              onClick={() => {
                onInsert(preview);
                onDismiss();
              }}
              className="self-end text-sm px-4 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer"
            >
              Insert
            </button>
          </div>
        )}
      </div>
    </InsertDialogShell>
  );
}

type InfoboxRow = { key: string; value: string };

function InfoboxInsertDialog({
  onInsert,
  onDismiss,
}: {
  onInsert: (text: string) => void;
  onDismiss: () => void;
}) {
  const [title, setTitle] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [align, setAlign] = useState<"right" | "left">("right");
  const [rows, setRows] = useState<InfoboxRow[]>([{ key: "", value: "" }]);
  const [showPicker, setShowPicker] = useState(false);

  const addRow = () => setRows((r) => [...r, { key: "", value: "" }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof InfoboxRow, val: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  const generate = () => {
    const paramParts = [`title="${title}"`];
    if (imagePath) paramParts.push(`image=echo://${imagePath}`);
    if (align !== "right") paramParts.push(`align=${align}`);
    const bodyLines = rows.filter((r) => r.key || r.value).map((r) => `${r.key} | ${r.value}`);
    return `:::infobox ${paramParts.join(" ")}\n${bodyLines.join("\n")}\n:::`;
  };

  return (
    <InsertDialogShell title="Insert Infobox" onDismiss={onDismiss}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
              placeholder="e.g. Ashley Graves"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
              Float side
            </label>
            <div className="flex gap-2">
              {(["right", "left"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAlign(a)}
                  className={`text-xs px-3 py-1 rounded cursor-pointer border transition-colors ${align === a ? "bg-[var(--accent)] text-white border-transparent" : "border-gray-300 text-[var(--text-muted)]"}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
            Portrait image (optional)
          </label>
          {imagePath ? (
            <div className="flex items-center gap-2">
              <code className="text-[10px] bg-[var(--thumb-bg)] px-2 py-1 rounded flex-1 break-all">
                {imagePath}
              </code>
              <button
                onClick={() => setImagePath("")}
                className="text-xs text-red-500 cursor-pointer hover:underline shrink-0"
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="text-xs px-3 py-1 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] cursor-pointer"
            >
              {showPicker ? "Hide picker" : "Pick image…"}
            </button>
          )}
          {showPicker && !imagePath && (
            <div className="mt-2">
              <MiniAssetPicker
                type="images"
                onSelect={(p) => {
                  setImagePath(p);
                  setShowPicker(false);
                }}
              />
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Key — Value rows</label>
            <button
              onClick={addRow}
              className="text-xs text-[var(--accent)] cursor-pointer hover:underline"
            >
              + Add row
            </button>
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-auto">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateRow(i, "key", e.target.value)}
                  placeholder="Key"
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none w-28 shrink-0"
                />
                <span className="text-[var(--text-muted)] text-xs">|</span>
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateRow(i, "value", e.target.value)}
                  placeholder="Value (supports [links](url) and <br>)"
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none flex-1 min-w-0"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="text-red-400 cursor-pointer hover:text-red-600 shrink-0 text-xs px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            onInsert(generate());
            onDismiss();
          }}
          disabled={!title}
          className="self-end text-sm px-4 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Insert Infobox
        </button>
      </div>
    </InsertDialogShell>
  );
}

type SceneLayer = { prefix: "bg" | "layer" | "fg"; path: string; extra: string };

function SceneInsertDialog({
  onInsert,
  onDismiss,
}: {
  onInsert: (text: string) => void;
  onDismiss: () => void;
}) {
  const [width, setWidth] = useState("100%");
  const [height, setHeight] = useState("200px");
  const [layers, setLayers] = useState<SceneLayer[]>([{ prefix: "bg", path: "", extra: "" }]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const addLayer = (prefix: SceneLayer["prefix"]) =>
    setLayers((l) => [...l, { prefix, path: "", extra: "" }]);
  const removeLayer = (i: number) => setLayers((l) => l.filter((_, idx) => idx !== i));
  const updateLayer = (i: number, field: keyof SceneLayer, val: string) =>
    setLayers((l) => l.map((layer, idx) => (idx === i ? { ...layer, [field]: val } : layer)));

  const generate = () => {
    const lines = layers
      .filter((l) => l.path)
      .map((l) => `${l.prefix}: echo://${l.path}${l.extra ? " " + l.extra.trim() : ""}`);
    return `:::scene width=${width} height=${height}\n${lines.join("\n")}\n:::`;
  };

  return (
    <InsertDialogShell title="Insert Scene" onDismiss={onDismiss}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">Width</label>
            <input
              type="text"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
              placeholder="100%"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
              Height
            </label>
            <input
              type="text"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
              placeholder="200px"
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">Layers</label>
            <div className="flex gap-1">
              {(["bg", "layer", "fg"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => addLayer(p)}
                  className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] cursor-pointer"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 max-h-64 overflow-auto">
            {layers.map((layer, i) => (
              <div key={i} className="border border-gray-200 rounded p-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${layer.prefix === "bg" ? "bg-blue-100 text-blue-600" : layer.prefix === "fg" ? "bg-purple-100 text-purple-600" : "bg-green-100 text-green-600"}`}
                  >
                    {layer.prefix}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] flex-1 truncate">
                    {layer.path || "no image"}
                  </span>
                  <button
                    onClick={() => setPickerFor(pickerFor === i ? null : i)}
                    className="text-[10px] text-[var(--accent)] cursor-pointer hover:underline shrink-0"
                  >
                    {pickerFor === i ? "Close" : "Pick…"}
                  </button>
                  <button
                    onClick={() => removeLayer(i)}
                    className="text-red-400 cursor-pointer hover:text-red-600 text-xs"
                  >
                    ✕
                  </button>
                </div>
                {pickerFor === i && (
                  <MiniAssetPicker
                    type="images"
                    onSelect={(p) => {
                      updateLayer(i, "path", p);
                      setPickerFor(null);
                    }}
                  />
                )}
                {layer.prefix === "layer" && (
                  <input
                    type="text"
                    value={layer.extra}
                    onChange={(e) => updateLayer(i, "extra", e.target.value)}
                    placeholder="bottom=5% left=48% height=25%"
                    className="text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none font-mono"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            onInsert(generate());
            onDismiss();
          }}
          className="self-end text-sm px-4 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer"
        >
          Insert Scene
        </button>
      </div>
    </InsertDialogShell>
  );
}

function FbfInsertDialog({
  onInsert,
  onDismiss,
}: {
  onInsert: (text: string) => void;
  onDismiss: () => void;
}) {
  const [fps, setFps] = useState("7.5");
  const [size, setSize] = useState("64");
  const [alias, setAlias] = useState("");
  const [frames, setFrames] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [cols, setCols] = useState("12");
  const [rows, setRows] = useState("8");
  const [indexRange, setIndexRange] = useState("0-2");
  const [showPicker, setShowPicker] = useState(false);
  const [mode, setMode] = useState<"spritesheet" | "individual">("spritesheet");

  const addFromSheet = () => {
    if (!sheet) return;
    const parts = indexRange.split("-").map((s) => parseInt(s.trim(), 10));
    const start = parts[0] ?? 0;
    const end = parts[1] ?? start;
    const newFrames: string[] = [];
    for (let i = start; i <= end; i++) {
      newFrames.push(`echo://${sheet}?sprite=${cols},${rows},${i}`);
    }
    setFrames((f) => [...f, ...newFrames]);
  };

  const generate = () => {
    const paramParts = [`fps=${fps}`, `size=${size}`];
    if (alias) paramParts.push(`alias=${alias}`);
    return `:::fbf ${paramParts.join(" ")}\n${frames.join("\n")}\n:::`;
  };

  return (
    <InsertDialogShell title="Insert Frame-by-Frame Animation" onDismiss={onDismiss}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">FPS</label>
            <input
              type="text"
              value={fps}
              onChange={(e) => setFps(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
              placeholder="7.5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
              Size (px)
            </label>
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
              placeholder="64"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
              Alias (optional)
            </label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
              placeholder="hero"
            />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">Add frames via</label>
            <div className="flex gap-1">
              {(["spritesheet", "individual"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-2 py-0.5 rounded cursor-pointer border transition-colors ${mode === m ? "bg-[var(--accent)] text-white border-transparent" : "border-gray-300 text-[var(--text-muted)]"}`}
                >
                  {m === "spritesheet" ? "Spritesheet" : "Individual images"}
                </button>
              ))}
            </div>
          </div>
          {mode === "spritesheet" && (
            <div className="border border-gray-200 rounded p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">Sheet:</span>
                <code className="text-xs bg-[var(--thumb-bg)] px-1.5 py-0.5 rounded flex-1 truncate">
                  {sheet || "none"}
                </code>
                <button
                  onClick={() => setShowPicker((v) => !v)}
                  className="text-xs text-[var(--accent)] cursor-pointer hover:underline shrink-0"
                >
                  Pick…
                </button>
              </div>
              {showPicker && (
                <MiniAssetPicker
                  type="images"
                  onSelect={(p) => {
                    setSheet(p);
                    setShowPicker(false);
                  }}
                />
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]">Cols</label>
                  <input
                    type="text"
                    value={cols}
                    onChange={(e) => setCols(e.target.value)}
                    className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]">Rows</label>
                  <input
                    type="text"
                    value={rows}
                    onChange={(e) => setRows(e.target.value)}
                    className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]">Index range</label>
                  <input
                    type="text"
                    value={indexRange}
                    onChange={(e) => setIndexRange(e.target.value)}
                    className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
                    placeholder="0-3"
                  />
                </div>
              </div>
              <button
                onClick={addFromSheet}
                disabled={!sheet}
                className="text-xs px-3 py-1 rounded bg-[var(--accent)] text-white cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed self-end"
              >
                Add frames {indexRange}
              </button>
            </div>
          )}
          {mode === "individual" && (
            <div className="border border-gray-200 rounded p-2">
              <MiniAssetPicker
                type="images"
                onSelect={(p) => setFrames((f) => [...f, `echo://${p}`])}
              />
            </div>
          )}
        </div>
        {frames.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-muted)]">
                {frames.length} frame{frames.length !== 1 ? "s" : ""}
              </label>
              <button
                onClick={() => setFrames([])}
                className="text-[10px] text-red-400 cursor-pointer hover:underline"
              >
                Clear all
              </button>
            </div>
            <div className="bg-[var(--thumb-bg)] rounded p-2 max-h-28 overflow-auto">
              {frames.map((f, i) => (
                <div key={i} className="flex items-center gap-1 mb-0.5">
                  <code className="text-[9px] flex-1 break-all text-[var(--text)]">{f}</code>
                  <button
                    onClick={() => setFrames((fr) => fr.filter((_, idx) => idx !== i))}
                    className="text-red-400 cursor-pointer text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => {
            onInsert(generate());
            onDismiss();
          }}
          disabled={frames.length === 0}
          className="self-end text-sm px-4 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Insert FBF
        </button>
      </div>
    </InsertDialogShell>
  );
}

function AnimInsertDialog({
  onInsert,
  onDismiss,
}: {
  onInsert: (text: string) => void;
  onDismiss: () => void;
}) {
  const [refMode, setRefMode] = useState(true);
  const [refAlias, setRefAlias] = useState("");
  const [fps, setFps] = useState("7.5");
  const [spriteSize, setSpriteSize] = useState("48");
  const [duration, setDuration] = useState("3s");
  const [width, setWidth] = useState("50%");
  const [height, setHeight] = useState("120px");
  const [pingpong, setPingpong] = useState(false);
  const [bgPath, setBgPath] = useState("");
  const [bgOpacity, setBgOpacity] = useState("1");
  const [keyframes, setKeyframes] = useState(
    '0% left=8px bottom=24px\n100% left="calc(100% - 56px)" bottom=24px',
  );
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [inlineFrames, setInlineFrames] = useState<string[]>([]);
  const [showFramePicker, setShowFramePicker] = useState(false);

  const generate = () => {
    const parts = [
      refMode ? `ref=${refAlias}` : `fps=${fps} spritesize=${spriteSize}`,
      `duration=${duration}`,
      `width=${width}`,
      `height=${height}`,
      pingpong ? "pingpong=true" : "",
      bgPath ? `bg=echo://${bgPath}` : "",
      bgPath && bgOpacity !== "1" ? `bgopacity=${bgOpacity}` : "",
    ].filter(Boolean);
    const header = `:::anim ${parts.join(" ")}`;
    const frameLines = refMode
      ? ""
      : inlineFrames.join("\n") + (inlineFrames.length > 0 ? "\n" : "");
    return `${header}\n${frameLines}${keyframes.trim()}\n:::`;
  };

  return (
    <InsertDialogShell title="Insert Moving Animation" onDismiss={onDismiss}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
            Sprite source
          </label>
          <div className="flex gap-2 mb-2">
            {([true, false] as const).map((rm) => (
              <button
                key={String(rm)}
                onClick={() => setRefMode(rm)}
                className={`text-xs px-3 py-1 rounded cursor-pointer border transition-colors ${refMode === rm ? "bg-[var(--accent)] text-white border-transparent" : "border-gray-300 text-[var(--text-muted)]"}`}
              >
                {rm ? "Reference FBF alias" : "Inline frames"}
              </button>
            ))}
          </div>
          {refMode ? (
            <input
              type="text"
              value={refAlias}
              onChange={(e) => setRefAlias(e.target.value)}
              placeholder="Alias name from :::fbf alias=..."
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none"
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]">FPS</label>
                  <input
                    type="text"
                    value={fps}
                    onChange={(e) => setFps(e.target.value)}
                    className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]">Sprite size (px)</label>
                  <input
                    type="text"
                    value={spriteSize}
                    onChange={(e) => setSpriteSize(e.target.value)}
                    className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
                  />
                </div>
              </div>
              <button
                onClick={() => setShowFramePicker((v) => !v)}
                className="text-xs text-[var(--accent)] cursor-pointer hover:underline self-start"
              >
                {showFramePicker ? "Hide" : "Add frames…"}
              </button>
              {showFramePicker && (
                <MiniAssetPicker
                  type="images"
                  onSelect={(p) => {
                    setInlineFrames((f) => [...f, `echo://${p}`]);
                  }}
                />
              )}
              {inlineFrames.length > 0 && (
                <p className="text-[10px] text-[var(--text-muted)]">
                  {inlineFrames.length} frame{inlineFrames.length !== 1 ? "s" : ""} added
                </p>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--text-muted)]">Duration</label>
            <input
              type="text"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
              placeholder="3s"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-muted)]">Width</label>
            <input
              type="text"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
              placeholder="50%"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-muted)]">Height</label>
            <input
              type="text"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none mt-0.5"
              placeholder="120px"
            />
          </div>
          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pingpong}
                onChange={(e) => setPingpong(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-xs text-[var(--text-muted)]">Pingpong</span>
            </label>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">
              Background (optional)
            </label>
            {bgPath ? (
              <button
                onClick={() => setBgPath("")}
                className="text-[10px] text-red-400 cursor-pointer hover:underline"
              >
                Clear
              </button>
            ) : (
              <button
                onClick={() => setShowBgPicker((v) => !v)}
                className="text-[10px] text-[var(--accent)] cursor-pointer hover:underline"
              >
                Pick…
              </button>
            )}
          </div>
          {bgPath && (
            <div className="flex items-center gap-2">
              <code className="text-[10px] bg-[var(--thumb-bg)] px-2 py-1 rounded flex-1 break-all">
                {bgPath}
              </code>
              <input
                type="text"
                value={bgOpacity}
                onChange={(e) => setBgOpacity(e.target.value)}
                className="w-14 text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none shrink-0"
                placeholder="opacity"
              />
            </div>
          )}
          {showBgPicker && !bgPath && (
            <MiniAssetPicker
              type="images"
              onSelect={(p) => {
                setBgPath(p);
                setShowBgPicker(false);
              }}
            />
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] block mb-1">
            Movement keyframes
          </label>
          <textarea
            value={keyframes}
            onChange={(e) => setKeyframes(e.target.value)}
            rows={3}
            className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none font-mono resize-none"
            placeholder={'0% left=8px bottom=24px\n100% left="calc(100% - 56px)" bottom=24px'}
          />
        </div>
        <button
          onClick={() => {
            onInsert(generate());
            onDismiss();
          }}
          className="self-end text-sm px-4 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer"
        >
          Insert Anim
        </button>
      </div>
    </InsertDialogShell>
  );
}

function DefInsertDialog({
  onInsert,
  onDismiss,
}: {
  onInsert: (text: string) => void;
  onDismiss: () => void;
}) {
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([
    { name: "", path: "" },
  ]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const addEntry = () => setEntries((e) => [...e, { name: "", path: "" }]);
  const removeEntry = (i: number) => setEntries((e) => e.filter((_, idx) => idx !== i));
  const updateEntry = (i: number, field: "name" | "path", val: string) =>
    setEntries((e) => e.map((ent, idx) => (idx === i ? { ...ent, [field]: val } : ent)));

  const generate = () => {
    const lines = entries
      .filter((e) => e.name && e.path)
      .map((e) => `${e.name} = echo://${e.path}`);
    return `:::def\n${lines.join("\n")}\n:::`;
  };

  return (
    <InsertDialogShell title="Define Path Aliases (:::def)" onDismiss={onDismiss}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--text-muted)]">
          Define short aliases for echo:// paths. Reference them anywhere as{" "}
          <code className="bg-[var(--thumb-bg)] px-1 rounded">echo://~aliasname</code>.
        </p>
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <div key={i} className="border border-gray-200 rounded p-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={entry.name}
                  onChange={(e) => updateEntry(i, "name", e.target.value)}
                  placeholder="alias name (e.g. hero)"
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] outline-none w-32 shrink-0"
                />
                <span className="text-xs text-[var(--text-muted)]">=</span>
                <code className="text-[10px] bg-[var(--thumb-bg)] px-1.5 py-1 rounded flex-1 truncate">
                  {entry.path || "—"}
                </code>
                <button
                  onClick={() => setPickerFor(pickerFor === i ? null : i)}
                  className="text-[10px] text-[var(--accent)] cursor-pointer hover:underline shrink-0"
                >
                  Pick…
                </button>
                <button
                  onClick={() => removeEntry(i)}
                  className="text-red-400 cursor-pointer text-xs shrink-0"
                >
                  ✕
                </button>
              </div>
              {pickerFor === i && (
                <MiniAssetPicker
                  type="images"
                  onSelect={(p) => {
                    updateEntry(i, "path", p);
                    setPickerFor(null);
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addEntry}
          className="text-xs text-[var(--accent)] cursor-pointer hover:underline self-start"
        >
          + Add alias
        </button>
        <button
          onClick={() => {
            onInsert(generate());
            onDismiss();
          }}
          disabled={entries.every((e) => !e.name || !e.path)}
          className="self-end text-sm px-4 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Insert Def Block
        </button>
      </div>
    </InsertDialogShell>
  );
}

export type ToolbarDialog = "image" | "infobox" | "scene" | "fbf" | "anim" | "def" | null;

function ToolbarBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-[var(--text-muted)] hover:bg-[var(--control-bg)] hover:text-[var(--text)] transition-colors cursor-pointer shrink-0 font-medium"
    >
      {label}
    </button>
  );
}

function WikiToolbar({
  onInsert,
  textareaRef,
}: {
  onInsert: (text: string) => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [dialog, setDialog] = useState<ToolbarDialog>(null);
  const [open, setOpen] = useState(false);

  const insertAtCursor = useCallback(
    (toInsert: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        onInsert(toInsert);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const current = ta.value;

      const needsNewlineBefore =
        start > 0 && current[start - 1] !== "\n" && toInsert.startsWith(":::");
      const prefix = needsNewlineBefore ? "\n" : "";
      const newValue = current.slice(0, start) + prefix + toInsert + current.slice(end);
      onInsert(newValue);
      const newCursor = start + prefix.length + toInsert.length;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = newCursor;
        ta.focus();
      });
    },
    [onInsert, textareaRef],
  );

  const quickInsert = (snippet: string) => insertAtCursor(snippet);

  return (
    <>
      <div
        className="shrink-0 border-b"
        style={{ backgroundColor: "var(--thumb-bg)", borderColor: "var(--thumb-bg)" }}
      >
        {}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 px-2 py-1 w-full text-left cursor-pointer hover:bg-black/5 transition-colors"
        >
          <span className="text-[9px] text-[var(--text-muted)] font-semibold uppercase tracking-wide">
            Insert
          </span>
          <svg
            className="w-2.5 h-2.5 text-[var(--text-muted)] transition-transform"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
          </svg>
        </button>

        {}
        {open && (
          <div className="flex items-center gap-1 px-2 pb-1.5 flex-wrap">
            <ToolbarBtn
              label="Image"
              title="Insert echo:// image or audio"
              onClick={() => setDialog("image")}
            />
            <ToolbarBtn
              label="Infobox"
              title="Insert Wikipedia-style infobox"
              onClick={() => setDialog("infobox")}
            />
            <ToolbarBtn
              label="Scene"
              title="Insert layered scene"
              onClick={() => setDialog("scene")}
            />
            <ToolbarBtn
              label="FBF"
              title="Insert frame-by-frame animation"
              onClick={() => setDialog("fbf")}
            />
            <ToolbarBtn
              label="Anim"
              title="Insert moving animation"
              onClick={() => setDialog("anim")}
            />
            <ToolbarBtn
              label="Alias"
              title="Define echo:// path aliases (:::def)"
              onClick={() => setDialog("def")}
            />
            <div className="w-px h-3 bg-gray-200 mx-0.5 shrink-0" />
            <ToolbarBtn
              label="Center"
              title="Wrap selection in >>>…<<<"
              onClick={() => quickInsert(">>>content<<<")}
            />
            <ToolbarBtn label="Bold" title="Bold" onClick={() => quickInsert("**text**")} />
            <ToolbarBtn label="Italic" title="Italic" onClick={() => quickInsert("*text*")} />
            <ToolbarBtn label="Code" title="Inline code" onClick={() => quickInsert("`code`")} />
            <ToolbarBtn
              label="Table"
              title="Insert table template"
              onClick={() => quickInsert("| Col A | Col B |\n|---|---|\n| val | val |")}
            />
          </div>
        )}
      </div>

      {dialog === "image" && (
        <ImageInsertDialog onInsert={insertAtCursor} onDismiss={() => setDialog(null)} />
      )}
      {dialog === "infobox" && (
        <InfoboxInsertDialog onInsert={insertAtCursor} onDismiss={() => setDialog(null)} />
      )}
      {dialog === "scene" && (
        <SceneInsertDialog onInsert={insertAtCursor} onDismiss={() => setDialog(null)} />
      )}
      {dialog === "fbf" && (
        <FbfInsertDialog onInsert={insertAtCursor} onDismiss={() => setDialog(null)} />
      )}
      {dialog === "anim" && (
        <AnimInsertDialog onInsert={insertAtCursor} onDismiss={() => setDialog(null)} />
      )}
      {dialog === "def" && (
        <DefInsertDialog onInsert={insertAtCursor} onDismiss={() => setDialog(null)} />
      )}
    </>
  );
}

export default WikiToolbar;
