import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useEchoUrl } from "../../lib/echo";
import {
  serializeEditions,
  applyImageEditions,
  getAudioEditionParams as computeAudioEditionParams,
  type Edition,
} from "../../lib/editions";
import { getAsset } from "../../lib/idb";
import { getCategory, getFileName, isImagePath, toDisplayName } from "../assetUtils";

async function resolveOriginalBlob(path: string): Promise<Blob | null> {
  const asset = await getAsset(path.toLowerCase());
  return asset?.blob ?? null;
}

function AudioPreview({
  url,
  playbackRate = 1,
}: {
  url: string;
  playbackRate?: number | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const waveformRef = useRef<Float32Array | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        const offlineCtx = new OfflineAudioContext(1, 1, 44100);
        const decoded = await offlineCtx.decodeAudioData(arrayBuffer);
        if (cancelled) return;

        durationRef.current = decoded.duration;
        const raw = decoded.getChannelData(0);

        const buckets = canvas.width;
        const samples = new Float32Array(buckets);
        const bucketSize = Math.floor(raw.length / buckets);
        for (let i = 0; i < buckets; i++) {
          let sum = 0;
          const start = i * bucketSize;
          for (let j = start; j < start + bucketSize && j < raw.length; j++) {
            sum += Math.abs(raw[j]!);
          }
          samples[i] = sum / bucketSize;
        }
        waveformRef.current = samples;
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    const ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(0, 0, w, h);

      const samples = waveformRef.current;
      if (samples) {
        const barW = Math.max(1, w / samples.length);
        const playPos = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
        const playX = playPos * w;

        for (let i = 0; i < samples.length; i++) {
          const barH = samples[i]! * h * 0.9;
          const x = i * barW;
          const hue = (i / samples.length) * 30;
          ctx.fillStyle = x < playX ? `hsl(${hue}, 90%, 55%)` : `hsl(${hue}, 40%, 30%)`;
          ctx.fillRect(x, (h - barH) / 2, barW - 0.5, barH || 1);
        }

        if (audio.duration > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.fillRect(playX - 0.5, 0, 1, h);
        }
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [url]);

  const handleCanvasClick = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || !audio.duration) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    audio.currentTime = ratio * audio.duration;
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.preservesPitch = false;
    }
  }, [playbackRate]);

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-sm">
      <canvas
        ref={canvasRef}
        width={320}
        height={100}
        className="w-full rounded bg-gray-800 cursor-pointer"
        onClick={handleCanvasClick}
      />
      <audio ref={audioRef} controls src={url} className="w-full" />
    </div>
  );
}

export function AssetPreview({
  path,
  mappedPath,
  onClose,
  onCopied,
  initialEditions,
}: {
  path: string;
  mappedPath: string | undefined;
  onClose: () => void;
  onCopied: (path: string) => void;
  initialEditions?: Edition[] | undefined;
}) {
  const category = getCategory(path);
  const { url, loading } = useEchoUrl(path);
  const displayName = toDisplayName(mappedPath ?? path);
  const echoPath = mappedPath ?? path;

  const [editions, setEditions] = useState<Edition[]>(() => initialEditions ?? []);
  const [editedUrl, setEditedUrl] = useState<string | null>(null);
  const initSprite = (initialEditions ?? []).find((e) => e.type === "sprite");
  const [spriteRows, setSpriteRows] = useState(() =>
    initSprite?.type === "sprite" ? initSprite.rows : 0,
  );
  const [spriteCols, setSpriteCols] = useState(() =>
    initSprite?.type === "sprite" ? initSprite.cols : 0,
  );
  const [spriteOpen, setSpriteOpen] = useState(() =>
    (initialEditions ?? []).some((e) => e.type === "sprite"),
  );
  const [spriteHover, setSpriteHover] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const hasCrop = editions.some((e) => e.type === "crop");
  const spriteEd = editions.find((e) => e.type === "sprite");
  const selectedSpriteIndex = spriteEd?.type === "sprite" ? spriteEd.index : null;

  useEffect(() => {
    if (category !== "images" || !url) {
      setEditedUrl(null);
      return;
    }
    if (editions.length === 0) {
      setEditedUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const blob = await resolveOriginalBlob(path);
      if (!blob || cancelled) return;
      const result = await applyImageEditions(blob, editions);
      if (cancelled) return;
      const blobUrl = URL.createObjectURL(result);
      setEditedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return blobUrl;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [editions, category, url, path]);

  useEffect(() => {
    return () => {
      if (editedUrl) URL.revokeObjectURL(editedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const audioEditionParams = useMemo(() => {
    if (category !== "audio") return null;
    return computeAudioEditionParams(editions);
  }, [editions, category]);

  const fullEchoPath = useMemo(() => {
    if (editions.length === 0) return echoPath;
    return serializeEditions(echoPath, editions);
  }, [echoPath, editions]);

  const editedDisplayName = useMemo(() => {
    if (editions.length === 0) return displayName;
    const parts: string[] = [];
    const crop = editions.find((e) => e.type === "crop");
    const sprite = editions.find((e) => e.type === "sprite");
    const speedEd = editions.find((e) => e.type === "speed");
    const pitchEd = editions.find((e) => e.type === "pitch");
    if (crop) parts.push("cropped");
    if (sprite && sprite.type === "sprite") {
      parts.push(`${sprite.cols}x${sprite.rows}, sprite ${sprite.index}`);
    }
    const audioParts: string[] = [];
    if (pitchEd && pitchEd.type === "pitch") {
      const v = pitchEd.value;
      audioParts.push(`pitch ${v >= 0 ? `+${v}` : String(v)}`);
    }
    if (speedEd && speedEd.type === "speed") {
      audioParts.push(`${Math.round(speedEd.value * 100)}% speed`);
    }
    if (audioParts.length > 0) {
      parts.push(audioParts.join(" at "));
    }
    return parts.length > 0 ? `${displayName} ${parts.join(", ")}` : displayName;
  }, [displayName, editions]);

  const echoMarkdown = isImagePath(path)
    ? `![${editedDisplayName}](echo://${fullEchoPath})`
    : `[${editedDisplayName}](echo://${fullEchoPath})`;

  const originalMarkdown = isImagePath(path)
    ? `![${toDisplayName(path)}](echo://${path})`
    : `[${toDisplayName(path)}](echo://${path})`;

  const handleCopy = useCallback(
    (e?: ReactMouseEvent) => {
      const text = e && (e.ctrlKey || e.metaKey) ? originalMarkdown : echoMarkdown;
      void navigator.clipboard.writeText(text).then(() => onCopied(path));
    },
    [echoMarkdown, originalMarkdown, onCopied, path],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggleCrop = useCallback(() => {
    setEditions((prev) => {
      if (prev.some((e) => e.type === "crop")) {
        return prev.filter((e) => e.type !== "crop");
      }

      const without = prev.filter((e) => e.type !== "sprite");
      return [{ type: "crop" as const }, ...without];
    });
    setSpriteOpen(false);
    setSpriteRows(0);
    setSpriteCols(0);
  }, []);

  const handleSpriteClick = useCallback(
    (index: number) => {
      if (spriteRows <= 0 || spriteCols <= 0) return;
      setEditions((prev) => {
        const without = prev.filter((e) => e.type !== "sprite");
        return [...without, { type: "sprite" as const, rows: spriteRows, cols: spriteCols, index }];
      });
    },
    [spriteRows, spriteCols],
  );

  const clearSprite = useCallback(() => {
    setEditions((prev) => prev.filter((e) => e.type !== "sprite"));
    setSpriteRows(0);
    setSpriteCols(0);
    setSpriteOpen(false);
  }, []);

  const toggleSprite = useCallback(() => {
    setSpriteOpen((prev) => {
      if (prev) {
        setEditions((eds) => eds.filter((e) => e.type !== "sprite"));
        setSpriteRows(0);
        setSpriteCols(0);
        return false;
      }

      setEditions((eds) => eds.filter((e) => e.type !== "crop"));
      const fileName = getFileName(mappedPath ?? path);
      const m = /(\d+)x(\d+)/i.exec(fileName);
      if (m) {
        const c = parseInt(m[1]!, 10);
        const r = parseInt(m[2]!, 10);
        if (c > 0 && r > 0) {
          setSpriteCols(c);
          setSpriteRows(r);
        }
      }
      return true;
    });
  }, [path, mappedPath]);

  const handleSpeedChange = useCallback((v: number) => {
    setSpeed(v);
    setEditions((prev) => {
      const without = prev.filter((e) => e.type !== "speed");
      if (v === 1.0) return without;
      return [...without, { type: "speed" as const, value: v }];
    });
  }, []);

  const handlePitchChange = useCallback((v: number) => {
    setPitch(v);
    setEditions((prev) => {
      const without = prev.filter((e) => e.type !== "pitch");
      if (v === 0) return without;
      return [...without, { type: "pitch" as const, value: v }];
    });
  }, []);

  const handleImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  const showUrl = editedUrl ?? url;

  const showSpriteGrid =
    category === "images" &&
    spriteOpen &&
    spriteRows > 0 &&
    spriteCols > 0 &&
    imgSize &&
    !hasCrop &&
    selectedSpriteIndex === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div className="relative">
        <button
          className="absolute -top-10 -right-1 w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors cursor-pointer z-10 backdrop-blur-sm"
          onClick={onClose}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div
          className="flex flex-col items-center max-w-[90vw] max-h-[90vh] rounded-lg overflow-hidden"
          style={{ backgroundColor: "var(--accent)" }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            handleCopy();
          }}
        >
          {loading ? (
            <div
              className="flex items-center justify-center m-1 mb-0 rounded"
              style={{ backgroundColor: "var(--thumb-bg)", minWidth: 120, minHeight: 120 }}
            >
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : category === "images" && showUrl ? (
            <div
              className="relative m-1 mb-0 overflow-hidden rounded"
              style={{ backgroundColor: "var(--thumb-bg)" }}
            >
              <img
                ref={imgRef}
                src={showUrl}
                alt={displayName}
                className="max-w-full max-h-[60vh] object-contain block"
                onLoad={handleImgLoad}
              />
              {showSpriteGrid && imgRef.current && (
                <div
                  className="absolute pointer-events-auto"
                  style={{
                    top: imgRef.current.offsetTop,
                    left: imgRef.current.offsetLeft,
                    width: imgRef.current.clientWidth,
                    height: imgRef.current.clientHeight,
                    display: "grid",
                    gridTemplateRows: `repeat(${spriteRows}, 1fr)`,
                    gridTemplateColumns: `repeat(${spriteCols}, 1fr)`,
                  }}
                >
                  {Array.from({ length: spriteRows * spriteCols }, (_, i) => (
                    <div
                      key={i}
                      className="border border-white/30 cursor-pointer transition-colors"
                      style={{
                        backgroundColor:
                          spriteHover === i ? "rgba(255,255,255,0.25)" : "transparent",
                      }}
                      onMouseEnter={() => setSpriteHover(i)}
                      onMouseLeave={() => setSpriteHover(null)}
                      onClick={() => handleSpriteClick(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : category === "audio" && showUrl ? (
            <div
              className="m-1 mb-0 p-3 overflow-hidden rounded"
              style={{ backgroundColor: "var(--thumb-bg)" }}
            >
              <AudioPreview url={showUrl} playbackRate={audioEditionParams?.playbackRate} />
            </div>
          ) : (
            <div className="flex items-center justify-center w-32 h-32 m-1 rounded bg-gray-800 text-gray-400 text-sm">
              No preview
            </div>
          )}

          <div className="flex flex-col w-full px-3 py-1.5 gap-1">
            <div className="text-white text-xs truncate w-full text-left">
              {displayName}
              {editions.length > 0 && (
                <span className="text-white/70 ml-1">{serializeEditions("", editions)}</span>
              )}
            </div>

            <div className="flex items-center gap-2 w-full">
              {category === "images" && url && (
                <>
                  <button
                    onClick={toggleCrop}
                    className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors flex-shrink-0 ${
                      hasCrop
                        ? "bg-white text-[var(--accent)] font-medium"
                        : "bg-white/20 text-white hover:bg-white/30"
                    }`}
                  >
                    Crop
                  </button>
                  <div className="w-px h-4 bg-white/30 flex-shrink-0" />
                  {selectedSpriteIndex !== null ? (
                    <button
                      onClick={clearSprite}
                      className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer bg-white text-[var(--accent)] font-medium flex-shrink-0"
                    >
                      Sprite #{selectedSpriteIndex} &times;
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={toggleSprite}
                        className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                          spriteOpen
                            ? "bg-white text-[var(--accent)] font-medium"
                            : "bg-white/20 text-white hover:bg-white/30"
                        }`}
                      >
                        Sprite
                      </button>
                      {spriteOpen && (
                        <>
                          <input
                            type="number"
                            min={0}
                            max={64}
                            placeholder="C"
                            value={spriteCols || ""}
                            onChange={(e) =>
                              setSpriteCols(Math.max(0, parseInt(e.target.value) || 0))
                            }
                            className="w-8 text-[10px] text-center px-0.5 py-0.5 rounded bg-white/20 text-white border border-white/30 focus:outline-none"
                          />
                          <span className="text-white/50 text-[10px]">&times;</span>
                          <input
                            type="number"
                            min={0}
                            max={64}
                            placeholder="R"
                            value={spriteRows || ""}
                            onChange={(e) =>
                              setSpriteRows(Math.max(0, parseInt(e.target.value) || 0))
                            }
                            className="w-8 text-[10px] text-center px-0.5 py-0.5 rounded bg-white/20 text-white border border-white/30 focus:outline-none"
                          />
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {category === "audio" && url && (
                <>
                  <label className="flex items-center gap-1 text-white/80 text-[10px] flex-1 min-w-0">
                    <span className="flex-shrink-0">Spd</span>
                    <input
                      type="range"
                      min={0.25}
                      max={4}
                      step={0.05}
                      value={speed}
                      onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                      className="flex-1 min-w-0"
                    />
                    <span className="w-7 text-right font-mono flex-shrink-0">
                      {speed.toFixed(1)}
                    </span>
                  </label>
                  <div className="w-px h-4 bg-white/30 flex-shrink-0" />
                  <label className="flex items-center gap-1 text-white/80 text-[10px] flex-1 min-w-0">
                    <span className="flex-shrink-0">Pit</span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={pitch}
                      onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                      className="flex-1 min-w-0"
                    />
                    <span className="w-7 text-right font-mono flex-shrink-0">
                      {pitch >= 0 ? `+${pitch.toFixed(0)}` : pitch.toFixed(0)}
                    </span>
                  </label>
                </>
              )}

              <div className="flex-1" />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-white text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0 bg-white/20 px-2 py-0.5 rounded-full"
                title="Copy echo link (Ctrl+click for original name)"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy ECHO
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
