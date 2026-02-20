import {
  Fragment,
  memo,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import {
  getWebViewMode,
  requestExpandedMode,
  exitExpandedMode,
  navigateTo,
  showToast,
} from "@devvit/web/client";
import type {
  CardSize,
  ColorTheme,
  EngineType,
  ErrorResponse,
  FontFamily,
  HomeBackground,
  HomeLogo,
  InitResponse,
  GameConfig,
  MappingResponse,
  StyleConfig,
  StyleResponse,
  SubredditAppearance,
  WikiFontSize,
  WikiResponse,
  WikiPagesResponse,
  WikiUpdateRequest,
} from "../../shared/types/api";
import { hasAssets, getMeta, wipeAll, listAssetPaths, applyMapping } from "../lib/idb";
import { importGameFiles } from "../lib/decrypt/index";
import type { ImportProgress } from "../lib/decrypt/index";
import {
  revokeAllBlobUrls,
  useEchoUrl,
  setReverseMapping,
  getAudioEditionParamsForPath,
} from "../lib/echo";
import {
  parseEditions,
  serializeEditions,
  applyImageEditions,
  getAudioEditionParams as computeAudioEditionParams,
  type Edition,
} from "../lib/editions";
import { getAsset } from "../lib/idb";
import type { EchoMeta } from "../lib/idb";

type AppState = "loading" | "no-assets" | "importing" | "ready";

type ActiveTab = "wiki" | "assets" | "settings";

type FilterType = "images" | "audio";

type EchoLinkTarget = { type: "wiki"; page: string; anchor: string | null } | { type: "assets" };

const PAGE_SIZE = 60;

const DEFAULT_STYLE: StyleConfig = {
  cardSize: "normal",
  wikiFontSize: "normal",
  fontFamily: "system",
  light: {
    accentColor: "#d93900",
    linkColor: "#d93900",
    bgColor: "#ffffff",
    textColor: "#111827",
    textMuted: "#6b7280",
    thumbBgColor: "#e5e7eb",
    controlBgColor: "#ffffff",
    controlTextColor: "#111827",
  },
  dark: {
    accentColor: "#ff6b3d",
    linkColor: "#ff6b3d",
    bgColor: "#1a1a1b",
    textColor: "#d7dadc",
    textMuted: "#818384",
    thumbBgColor: "#343536",
    controlBgColor: "#343536",
    controlTextColor: "#d7dadc",
  },
};

const DEFAULT_APPEARANCE: SubredditAppearance = {
  bannerUrl: null,
  iconUrl: null,
  keyColor: null,
  primaryColor: null,
  bgColor: null,
  highlightColor: null,
  font: null,
};

const FONT_MAP: Record<Exclude<FontFamily, "subreddit">, string> = {
  system: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

function getFontFamily(fontFamily: FontFamily, subredditFont: string | null): string {
  if (fontFamily === "subreddit") {
    return subredditFont ?? FONT_MAP.system;
  }
  return FONT_MAP[fontFamily];
}

const ECHOWIKI_PRE_IMPORT: CSSProperties = {
  "--accent": "#6a5cff",
  "--accent-hover": "#5a4ee6",
  "--accent-ring": "rgba(106, 92, 255, 0.2)",
  "--bg": "transparent",
  "--text": "#ffffff",
  "--text-muted": "#677db7",
  "--thumb-bg": "#16213e",
  "--control-bg": "#16213e",
  "--control-text": "#ffffff",
} as CSSProperties;

function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isImagePath(p: string): boolean {
  return /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(p);
}

function isAudioPath(p: string): boolean {
  return /\.(ogg|mp3|m4a|wav|mid|midi)$/i.test(p);
}

function getFileName(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

function getStem(p: string): string {
  const fileName = getFileName(p);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function getExt(p: string): string {
  const fileName = getFileName(p);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot) : "";
}

function getCategory(p: string): "images" | "audio" | "data" {
  if (isImagePath(p)) return "images";
  if (isAudioPath(p)) return "audio";
  return "data";
}

function getSubfolder(p: string): string | null {
  const parts = p.split("/");
  if (parts.length < 2) return null;
  const folder = parts[parts.length - 2];
  return folder && folder.length > 0 ? folder : null;
}

function naturalSortKey(p: string, pathToMapped: Map<string, string>): string {
  const mapped = pathToMapped.get(p);
  return getFileName(mapped ?? p).toLowerCase();
}

function toDisplayName(path: string): string {
  const stem = getStem(path);
  const ext = getExt(path);
  return stem.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + ext;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const ALERT_META: Record<string, { color: string; icon: string }> = {
  note: {
    color: "var(--link-color)",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
  },
  tip: {
    color: "#22c55e",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"></path></svg>',
  },
  important: {
    color: "#a855f7",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
  },
  warning: {
    color: "#eab308",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
  },
  caution: {
    color: "#ef4444",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
  },
};

function preprocessAlerts(md: string): string {
  return md.replace(
    /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\S\n]*\n((?:> [^\n]*\n?)*)/gm,
    (_, type: string, body: string) => {
      const t = type.toLowerCase();
      const label = type.charAt(0) + type.slice(1).toLowerCase();
      const meta = ALERT_META[t];
      const color = meta?.color ?? "var(--text-muted)";
      const icon = meta?.icon ?? "";
      const content = body.replace(/^> ?/gm, "");
      return `<div class="wiki-alert" style="border-color: ${color};"><div class="wiki-alert-title" style="color: ${color};">${icon}<span>${label}</span></div>\n\n${content}\n</div>\n`;
    },
  );
}

function extractWikiPage(href: string, subredditName: string): string | null {
  const sub = subredditName.toLowerCase();

  try {
    const url = new URL(href, "https://www.reddit.com");
    if (
      url.hostname === "www.reddit.com" ||
      url.hostname === "reddit.com" ||
      url.hostname === "old.reddit.com" ||
      url.hostname === "new.reddit.com"
    ) {
      const match = /^\/r\/([^/]+)\/wiki\/(.+?)(?:\/?#.*)?$/.exec(url.pathname);
      if (match && match[1]!.toLowerCase() === sub) {
        return match[2]!;
      }
    }
  } catch {}

  const pathMatch = /^\/r\/([^/]+)\/wiki\/(.+?)(?:\/?#.*)?$/.exec(href);
  if (pathMatch && pathMatch[1]!.toLowerCase() === sub) {
    return pathMatch[2]!;
  }

  return null;
}

function parseEchoLink(
  text: string,
  subredditName: string,
  wikiPages: string[],
): EchoLinkTarget | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("echolink://r/")) return null;
  const withoutScheme = trimmed.slice("echolink://r/".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) return null;
  const sub = withoutScheme.slice(0, slashIdx);
  if (sub.toLowerCase() !== subredditName.toLowerCase()) return null;
  const path = withoutScheme.slice(slashIdx + 1);
  if (path === "assets") return { type: "assets" };
  if (path.startsWith("wiki/")) {
    const pagePart = path.slice("wiki/".length);
    const hashIdx = pagePart.indexOf("#");
    const pageWithoutAnchor = hashIdx === -1 ? pagePart : pagePart.slice(0, hashIdx);
    const anchor = hashIdx === -1 ? null : pagePart.slice(hashIdx + 1) || null;
    if (wikiPages.includes(pageWithoutAnchor)) {
      return { type: "wiki", page: pageWithoutAnchor, anchor };
    }
  }
  return null;
}

function EchoLinkDialog({
  subredditName,
  input,
  error,
  onInputChange,
  onGo,
  onDismiss,
}: {
  subredditName: string;
  input: string;
  error: string | null;
  onInputChange: (v: string) => void;
  onGo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-1">Open EchoLink</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Paste an <span className="font-mono text-xs">echolink://r/{subredditName}/…</span> to jump
          to a wiki page or tab, or an <span className="font-mono text-xs">echo://…</span> to open
          an asset.
        </p>
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={`echolink://r/${subredditName}/wiki/page`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") onGo();
            if (e.key === "Escape") onDismiss();
          }}
          className="w-full text-sm px-3 py-2 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] mb-3 font-mono"
        />
        {error !== null && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onGo}
            className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

function EchoInlineImage({
  url,
  alt,
  style,
  className: extraClass,
}: {
  url: string;
  alt: string;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}) {
  return (
    <img
      src={url}
      alt={alt}
      style={style}
      className={`echo-inline inline-block max-w-full rounded${extraClass ? ` ${extraClass}` : ""}`}
    />
  );
}

function EchoInlineAsset({
  path,
  children,
  style,
  className,
}: {
  path: string;
  children: ReactNode;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}) {
  const { url, loading } = useEchoUrl(path);
  const { basePath } = parseEditions(path);
  const name = getFileName(basePath);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioParams = getAudioEditionParamsForPath(path);

  useEffect(() => {
    if (audioRef.current && audioParams && audioParams.playbackRate !== 1) {
      audioRef.current.playbackRate = audioParams.playbackRate;
      audioRef.current.preservesPitch = false;
    }
  }, [url, audioParams]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-[var(--text-muted)] text-xs">
        <span className="w-3 h-3 border border-gray-300 border-t-gray-600 rounded-full animate-spin inline-block" />
        {children}
      </span>
    );
  }

  if (isImagePath(basePath) && url) {
    return <EchoInlineImage url={url} alt={name} style={style} className={className} />;
  }

  if (isAudioPath(basePath) && url) {
    return (
      <span className="inline-flex flex-col gap-1 my-1">
        <span className="text-xs text-[var(--text-muted)]">{children}</span>
        <audio ref={audioRef} controls src={url} className="max-w-xs h-8" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-[var(--text-muted)] text-xs">
      {children}
    </span>
  );
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

function AssetPreview({
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
              <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
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

async function resolveOriginalBlob(path: string): Promise<Blob | null> {
  const asset = await getAsset(path.toLowerCase());
  return asset?.blob ?? null;
}

function HeadingLinkButton({
  id,
  subredditName,
  currentPage,
  onCopyEchoLink,
}: {
  id: string;
  subredditName: string;
  currentPage: string;
  onCopyEchoLink: (link: string) => void;
}) {
  return (
    <span
      role="button"
      className="inline-flex items-center ml-2 opacity-0 group-hover/heading:opacity-100 transition-opacity cursor-pointer align-middle text-[var(--text-muted)] hover:text-[var(--link-color)]"
      title="Copy link to section"
      onClick={() => {
        onCopyEchoLink(`echolink://r/${subredditName}/wiki/${currentPage}#${id}`);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z" />
      </svg>
    </span>
  );
}

function WikiMarkdownContent({
  content,
  subredditName,
  currentPage,
  wikiFontSize,
  onPageChange,
  onCopyEchoLink,
  targetAnchor,
  onAnchorConsumed,
}: {
  content: string;
  subredditName: string;
  currentPage: string;
  wikiFontSize: WikiFontSize;
  onPageChange: (page: string) => void;
  onCopyEchoLink: (link: string) => void;
  targetAnchor?: string | null | undefined;
  onAnchorConsumed?: (() => void) | undefined;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!targetAnchor) return;
    const el =
      containerRef.current?.querySelector(`[id="${CSS.escape(targetAnchor)}"]`) ??
      containerRef.current?.querySelector(`[id="${CSS.escape(targetAnchor.toLowerCase())}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
    }
    onAnchorConsumed?.();
  }, [targetAnchor, content, onAnchorConsumed]);
  const proseSize =
    wikiFontSize === "small" ? "prose-sm" : wikiFontSize === "large" ? "prose-lg" : "";

  return (
    <div ref={containerRef} className="px-4 py-4">
      <div
        className={`prose ${proseSize} max-w-none`}
        style={
          {
            "--tw-prose-body": "var(--text)",
            "--tw-prose-headings": "var(--text)",
            "--tw-prose-bold": "var(--text)",
            "--tw-prose-links": "var(--link-color)",
            "--tw-prose-quotes": "var(--text-muted)",
            "--tw-prose-quote-borders": "var(--accent)",
            "--tw-prose-code": "var(--text)",
            "--tw-prose-counters": "var(--text-muted)",
            "--tw-prose-bullets": "var(--text-muted)",
            "--tw-prose-hr": "var(--text-muted)",
            "--tw-prose-th-borders": "var(--text-muted)",
            "--tw-prose-td-borders": "var(--text-muted)",
          } as CSSProperties
        }
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          urlTransform={(url) => (url.startsWith("echo://") ? url : defaultUrlTransform(url))}
          components={{
            h1: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h1 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h1>
              );
            },
            h2: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h2 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h2>
              );
            },
            h3: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h3 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h3>
              );
            },
            h4: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h4 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h4>
              );
            },
            h5: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h5 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h5>
              );
            },
            h6: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === "string" ? c : "";
              const id = slugify(text);
              return (
                <h6 id={id} className="group/heading relative">
                  {c}
                  {id && (
                    <HeadingLinkButton
                      id={id}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  )}
                </h6>
              );
            },
            p: ({ children, node }: { children?: ReactNode; node?: unknown }) => {
              const n = node as
                | {
                    children?: {
                      type: string;
                      tagName?: string;
                      properties?: Record<string, unknown>;
                      value?: string;
                    }[];
                  }
                | undefined;
              const kids = n?.children ?? [];
              const echoOnly =
                kids.length > 0 &&
                kids.every(
                  (c) =>
                    (c.type === "element" &&
                      c.tagName === "img" &&
                      typeof c.properties?.src === "string" &&
                      (c.properties.src as string).startsWith("echo://")) ||
                    (c.type === "element" &&
                      c.tagName === "a" &&
                      typeof c.properties?.href === "string" &&
                      (c.properties.href as string).startsWith("echo://")) ||
                    (c.type === "text" && !(c.value ?? "").trim()),
                );
              if (echoOnly) return <>{children}</>;
              return <p>{children}</p>;
            },
            img: ({
              src,
              alt,
              style,
              className: imgClass,
            }: {
              src?: string | undefined;
              alt?: string | undefined;
              style?: CSSProperties | undefined;
              className?: string | undefined;
            }) => {
              if (src?.startsWith("echo://")) {
                const echoPath = src.slice("echo://".length).toLowerCase();
                return (
                  <EchoInlineAsset path={echoPath} style={style} className={imgClass}>
                    {alt ?? getFileName(echoPath)}
                  </EchoInlineAsset>
                );
              }
              return <img src={src} alt={alt} style={style} className={imgClass} />;
            },
            a: ({
              href,
              children: linkChildren,
            }: {
              href?: string | undefined;
              children?: ReactNode | undefined;
            }) => {
              if (!href) {
                return <span>{linkChildren}</span>;
              }

              if (href.startsWith("echo://")) {
                const echoPath = href.slice("echo://".length).toLowerCase();
                return <EchoInlineAsset path={echoPath}>{linkChildren}</EchoInlineAsset>;
              }

              const wikiPage = extractWikiPage(href, subredditName);
              if (wikiPage !== null) {
                return (
                  <span
                    role="link"
                    className="text-[var(--link-color)] hover:underline cursor-pointer"
                    onClick={() => onPageChange(wikiPage)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onCopyEchoLink(`echolink://r/${subredditName}/wiki/${wikiPage}`);
                    }}
                  >
                    {linkChildren}
                  </span>
                );
              }

              if (href.startsWith("#")) {
                return (
                  <span
                    role="link"
                    className="text-[var(--link-color)] hover:underline cursor-pointer"
                    onClick={() => {
                      const id = href.slice(1);
                      const target =
                        containerRef.current?.querySelector(`[id="${CSS.escape(id)}"]`) ??
                        containerRef.current?.querySelector(
                          `[id="${CSS.escape(id.toLowerCase())}"]`,
                        );
                      if (target) {
                        target.scrollIntoView({ behavior: "instant", block: "start" });
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onCopyEchoLink(`echolink://r/${subredditName}/wiki/${currentPage}${href}`);
                    }}
                  >
                    {linkChildren}
                  </span>
                );
              }

              const externalUrl =
                href.startsWith("http://") || href.startsWith("https://")
                  ? href
                  : `https://www.reddit.com${href.startsWith("/") ? href : `/${href}`}`;
              return (
                <a
                  href={externalUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    try {
                      navigateTo({ url: externalUrl });
                    } catch {
                      window.open(externalUrl, "_blank");
                    }
                  }}
                  className="text-[var(--link-color)] hover:underline cursor-pointer"
                >
                  {linkChildren}
                </a>
              );
            },
            style: ({ children }: { children?: ReactNode }) => {
              const css =
                typeof children === "string"
                  ? children
                  : Array.isArray(children)
                    ? (children as ReactNode[])
                        .filter((c): c is string => typeof c === "string")
                        .join("")
                    : "";
              if (!css.trim()) return null;
              return <style dangerouslySetInnerHTML={{ __html: css }} />;
            },
          }}
        >
          {preprocessAlerts(content)}
        </Markdown>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  isDanger,
  onConfirm,
  onDismiss,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  isDanger?: boolean | undefined;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-2">{title}</h3>
        <p className="text-sm text-[var(--text-muted)] mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
          >
            Keep editing
          </button>
          <button
            onClick={onConfirm}
            className={`text-sm px-3 py-1.5 rounded text-white transition-opacity cursor-pointer ${
              isDanger === true
                ? "bg-red-500 hover:opacity-90"
                : "bg-[var(--accent)] hover:opacity-90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function WikiSaveDialog({
  reason,
  onReasonChange,
  onConfirm,
  onDismiss,
  isSaving,
  error,
}: {
  reason: string;
  onReasonChange: (r: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  isSaving: boolean;
  error: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-1">Save changes</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Summarize your edit for the revision history.
        </p>
        <input
          type="text"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Reason for edit…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isSaving && reason.trim()) onConfirm();
          }}
          className="w-full text-sm px-3 py-2 rounded border border-gray-300 bg-[var(--control-bg)] text-[var(--control-text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] mb-3"
        />
        {error !== null && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            disabled={isSaving}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving || !reason.trim()}
            className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const WikiView = memo(function WikiView({
  subredditName,
  wikiFontSize,
  currentPage,
  onPageChange,
  isMod,
  isExpanded,
  username,
  onCopyEchoLink,
  targetAnchor,
  onAnchorConsumed,
}: {
  subredditName: string;
  wikiFontSize: WikiFontSize;
  currentPage: string;
  onPageChange: (page: string) => void;
  isMod: boolean;
  isExpanded: boolean;
  username: string;
  onCopyEchoLink: (link: string) => void;
  targetAnchor?: string | null | undefined;
  onAnchorConsumed?: (() => void) | undefined;
}) {
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const readScrollRef = useRef<HTMLDivElement>(null);
  const lastPageRef = useRef(currentPage);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/wiki?page=${encodeURIComponent(currentPage)}`);
        if (res.ok) {
          const data: WikiResponse = await res.json();
          setContent(data.content);
        } else {
          setContent(null);
        }
      } catch {
        setContent(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [currentPage]);

  useLayoutEffect(() => {
    if (currentPage !== lastPageRef.current) {
      lastPageRef.current = currentPage;
      readScrollRef.current?.scrollTo(0, 0);
    }
  }, [currentPage]);

  useEffect(() => {
    setIsEditing(false);
    setEditContent("");
    setSaveReason("");
    setSaveError(null);
    setShowSaveDialog(false);
    setShowCancelDialog(false);
  }, [currentPage]);

  const handlePageChange = useCallback(
    (page: string) => {
      onPageChange(page);
    },
    [onPageChange],
  );

  const handleEditClick = useCallback(() => {
    setEditContent(content ?? "");
    setIsEditing(true);
  }, [content]);

  const handleCancelConfirm = useCallback(() => {
    setIsEditing(false);
    setEditContent("");
    setShowCancelDialog(false);
    setSaveError(null);
  }, []);

  const handleSaveConfirm = useCallback(async () => {
    if (!saveReason.trim()) {
      setSaveError("Please enter a reason for the edit.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const body: WikiUpdateRequest = {
        page: currentPage,
        content: editContent,
        reason: username ? `${username}: ${saveReason.trim()}` : saveReason.trim(),
      };
      const res = await fetch("/api/wiki/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as ErrorResponse;
        setSaveError(err.message ?? "Failed to save changes.");
        return;
      }
      setContent(editContent);
      setIsEditing(false);
      setShowSaveDialog(false);
      setSaveReason("");
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [currentPage, editContent, saveReason, username]);

  const canEdit = isMod && isExpanded && !loading;

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {canEdit && !isEditing && (
        <button
          onClick={handleEditClick}
          title="Edit page"
          className="absolute top-2 right-6 z-10 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--accent)] text-white hover:opacity-90 shadow-sm transition-opacity cursor-pointer"
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
          </svg>
          Edit page
        </button>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-16">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        </div>
      ) : isEditing ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left pane: live preview */}
          <div
            className="flex-1 overflow-auto border-r border-gray-100"
            style={{ scrollbarGutter: "stable both-edges" }}
          >
            <WikiMarkdownContent
              content={editContent}
              subredditName={subredditName}
              currentPage={currentPage}
              wikiFontSize={wikiFontSize}
              onPageChange={handlePageChange}
              onCopyEchoLink={onCopyEchoLink}
            />
          </div>
          {/* Right pane: markdown source editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 text-xs bg-[var(--thumb-bg)] border-b border-gray-100 shrink-0 select-none flex items-center justify-between sticky top-0 z-10">
              <span className="font-mono text-[var(--text-muted)]">Source</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowCancelDialog(true)}
                  className="px-2 py-0.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setSaveError(null);
                    setShowSaveDialog(true);
                  }}
                  className="px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
            <textarea
              className="flex-1 resize-none p-4 font-mono text-sm bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
              value={editContent}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditContent(e.target.value)}
              spellCheck={false}
              placeholder="Write wiki markdown here…"
            />
          </div>
        </div>
      ) : content === null || content === undefined ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <p className="text-[var(--text-muted)] text-sm">No wiki page yet</p>
          <a
            href={`https://www.reddit.com/r/${subredditName}/wiki/index`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Create the wiki index page
          </a>
        </div>
      ) : (
        <div
          ref={readScrollRef}
          data-wiki-scroll=""
          className="flex-1 overflow-auto"
          style={{ scrollbarGutter: "stable both-edges" }}
        >
          <WikiMarkdownContent
            content={content}
            subredditName={subredditName}
            currentPage={currentPage}
            wikiFontSize={wikiFontSize}
            onPageChange={handlePageChange}
            onCopyEchoLink={onCopyEchoLink}
            targetAnchor={targetAnchor}
            onAnchorConsumed={onAnchorConsumed}
          />
        </div>
      )}

      {showCancelDialog && (
        <ConfirmDialog
          title="Discard changes?"
          message="Your unsaved changes will be lost."
          confirmLabel="Discard"
          isDanger
          onConfirm={handleCancelConfirm}
          onDismiss={() => setShowCancelDialog(false)}
        />
      )}

      {showSaveDialog && (
        <WikiSaveDialog
          reason={saveReason}
          onReasonChange={setSaveReason}
          onConfirm={() => void handleSaveConfirm()}
          onDismiss={() => {
            setShowSaveDialog(false);
            setSaveError(null);
          }}
          isSaving={isSaving}
          error={saveError}
        />
      )}
    </div>
  );
});

function AssetNameLabel({ displayName, hovered }: { displayName: string; hovered: boolean }) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (el) {
      setOverflows(el.scrollWidth > el.clientWidth);
    }
  }, [displayName]);

  if (hovered && overflows) {
    const charCount = displayName.length;
    const duration = Math.max(3, charCount * 0.18);
    return (
      <span className="asset-name-scroll-container text-[var(--text-muted)] leading-tight">
        <span
          className="asset-name-scroll-inner"
          style={{ "--scroll-duration": `${duration}s` } as CSSProperties}
        >
          {displayName} &mdash; {displayName} &mdash;&nbsp;
        </span>
      </span>
    );
  }

  return (
    <span ref={measureRef} className="asset-name-static text-[var(--text-muted)] leading-tight">
      {displayName}
    </span>
  );
}

function AssetCard({
  path,
  mappedPath,
  cardSize,
  onPreview,
  onCopied,
}: {
  path: string;
  mappedPath: string | undefined;
  cardSize: CardSize;
  onPreview: (path: string) => void;
  onCopied: (path: string) => void;
}) {
  const category = getCategory(path);
  const { url, loading } = useEchoUrl(category === "images" ? path : null);
  const displayName = toDisplayName(mappedPath ?? path);
  const echoPath = mappedPath ?? path;
  const name = getFileName(path);

  const echoMarkdown = isImagePath(path)
    ? `![${displayName}](echo://${echoPath})`
    : `[${displayName}](echo://${echoPath})`;

  const originalMarkdown = isImagePath(path)
    ? `![${toDisplayName(path)}](echo://${path})`
    : `[${toDisplayName(path)}](echo://${path})`;

  const handleClick = useCallback(() => {
    onPreview(path);
  }, [onPreview, path]);

  const handleCopy = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      const text = e.ctrlKey || e.metaKey ? originalMarkdown : echoMarkdown;
      void navigator.clipboard.writeText(text).then(() => onCopied(path));
    },
    [echoMarkdown, originalMarkdown, onCopied, path],
  );

  const [cardHovered, setCardHovered] = useState(false);

  const thumbClass =
    cardSize === "compact" ? "w-12 h-12" : cardSize === "large" ? "w-24 h-24" : "w-16 h-16";
  const labelClass =
    cardSize === "compact" ? "text-[9px]" : cardSize === "large" ? "text-[11px]" : "text-[10px]";
  const copyIconClass =
    cardSize === "compact" ? "w-2.5 h-2.5" : cardSize === "large" ? "w-3.5 h-3.5" : "w-3 h-3";

  return (
    <div
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg transition-colors cursor-pointer overflow-hidden"
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
        setCardHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        setCardHovered(false);
      }}
      onClick={handleClick}
    >
      <div
        className={`${thumbClass} rounded border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0`}
        style={{
          backgroundColor: category === "data" ? "#f9fafb" : "var(--thumb-bg)",
        }}
      >
        {category === "images" ? (
          loading ? (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          ) : url ? (
            <img src={url} alt={name} className="w-full h-full object-contain" />
          ) : (
            <svg
              className="w-6 h-6 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )
        ) : category === "audio" ? (
          <svg
            className="w-6 h-6 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
            />
          </svg>
        ) : (
          <svg
            className="w-6 h-6 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        )}
      </div>
      <div className={`${labelClass} flex items-center gap-0.5 w-full min-w-0`}>
        <AssetNameLabel displayName={displayName} hovered={cardHovered} />
        <button
          className="flex-shrink-0 text-gray-300 hover:text-[var(--accent)] transition-colors cursor-pointer p-0.5"
          onClick={handleCopy}
          title="Copy echo link (Ctrl+click for original name)"
        >
          <svg className={copyIconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

const FILTERS: readonly FilterType[] = ["images", "audio"] as const;

function FilterTabs({
  active,
  counts,
  onChange,
}: {
  active: FilterType;
  counts: Record<FilterType, number>;
  onChange: (f: FilterType) => void;
}) {
  return (
    <div className="flex gap-1">
      {FILTERS.map((f) => (
        <button
          key={f}
          className={`text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
            active === f ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)]"
          }`}
          style={active !== f ? { backgroundColor: "transparent" } : undefined}
          onMouseEnter={(e) => {
            if (active !== f) e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
          }}
          onMouseLeave={(e) => {
            if (active !== f) e.currentTarget.style.backgroundColor = "transparent";
          }}
          onClick={() => onChange(f)}
        >
          {f.charAt(0).toUpperCase() + f.slice(1)}
          <span className="ml-1 opacity-70">{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}

function SubFilterTabs({
  active,
  subcategories,
  onChange,
}: {
  active: string | null;
  subcategories: readonly { name: string; count: number }[];
  onChange: (name: string) => void;
}) {
  if (subcategories.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {subcategories.map((s) => (
        <button
          key={s.name}
          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
            active === s.name ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)]"
          }`}
          style={active !== s.name ? { backgroundColor: "transparent" } : undefined}
          onMouseEnter={(e) => {
            if (active !== s.name) e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
          }}
          onMouseLeave={(e) => {
            if (active !== s.name) e.currentTarget.style.backgroundColor = "transparent";
          }}
          onClick={() => onChange(s.name)}
        >
          {s.name.charAt(0).toUpperCase() + s.name.slice(1)}
          <span className="ml-0.5 opacity-70">{s.count}</span>
        </button>
      ))}
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-fit rounded-lg border border-gray-200 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`text-xs px-3 py-1.5 transition-colors cursor-pointer ${
            value === opt.value ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)]"
          }`}
          style={value !== opt.value ? { backgroundColor: "var(--control-bg)" } : undefined}
          onMouseEnter={(e) => {
            if (value !== opt.value) e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
          }}
          onMouseLeave={(e) => {
            if (value !== opt.value) e.currentTarget.style.backgroundColor = "var(--control-bg)";
          }}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ColorPickerRow({
  label,
  value,
  defaultValue,
  onSelect,
}: {
  label: string;
  value: string;
  defaultValue?: string | undefined;
  onSelect: (color: string) => void;
}) {
  const handleHexChange = useCallback(
    (hex: string) => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        onSelect(hex);
      }
    },
    [onSelect],
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {defaultValue && (
          <button
            onClick={() => onSelect(defaultValue)}
            disabled={value.toLowerCase() === defaultValue.toLowerCase()}
            className="text-sm leading-none cursor-pointer transition-colors disabled:opacity-20 disabled:cursor-default text-[var(--text-muted)] hover:text-[var(--text)] disabled:hover:text-[var(--text-muted)]"
            title={`Reset to default (${defaultValue})`}
          >
            &#x21ba;
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onSelect(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer border border-gray-200 p-0.5 flex-shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => handleHexChange(e.target.value)}
          maxLength={7}
          className="w-20 text-xs font-mono px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
          style={{
            backgroundColor: "var(--control-bg)",
            color: "var(--control-text)",
          }}
        />
      </div>
    </div>
  );
}

function parseMappingText(text: string): Array<[string, string]> {
  const cleaned = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const pairRegex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  const results: Array<[string, string]> = [];
  let match;
  while ((match = pairRegex.exec(cleaned)) !== null) {
    results.push([match[1]!.toLowerCase(), match[2]!.toLowerCase()]);
  }
  return results;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightMappingSyntax(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*\/\//.test(line)) {
        return `<span style="color:#6a9955">${escapeHtml(line)}</span>`;
      }
      return line.replace(
        /("(?:[^"\\]|\\.)*")|(:)|(\/\/[^\n]*)/g,
        (m, str?: string, colon?: string, comment?: string) => {
          if (comment) return `<span style="color:#6a9955">${escapeHtml(comment)}</span>`;
          if (str) return `<span style="color:#ce9178">${escapeHtml(str)}</span>`;
          if (colon) return `<span style="color:#d4d4d4">:</span>`;
          return escapeHtml(m);
        },
      );
    })
    .join("\n");
}

function MappingPanel({
  text,
  setText,
  parsedEntries,
  status,
}: {
  text: string;
  setText: (v: string) => void;
  parsedEntries: Array<[string, string]>;
  status: { ok: boolean; message: string } | null;
}) {
  const [splitRatio, setSplitRatio] = useState(0.6);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const handlePointerDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.min(0.85, Math.max(0.15, (e.clientY - rect.top) / rect.height));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (codeRef.current && preRef.current) {
      preRef.current.scrollTop = codeRef.current.scrollTop;
      preRef.current.scrollLeft = codeRef.current.scrollLeft;
    }
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col min-h-0" style={{ flex: `${splitRatio} 1 0%` }}>
        <div style={{ backgroundColor: "var(--thumb-bg)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-[var(--text-muted)]">
                  Original
                </th>
                <th className="text-left px-3 py-1.5 font-medium text-[var(--text-muted)]">
                  Mapped To
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <div className="flex-1 overflow-auto" style={{ scrollbarGutter: "stable both-edges" }}>
          {parsedEntries.length > 0 ? (
            <table className="w-full text-xs">
              <tbody>
                {parsedEntries.map(([key, val], i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-1 font-mono text-[var(--text)]">{key}</td>
                    <td className="px-3 py-1 font-mono text-[var(--text)]">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">No valid mappings found</p>
          )}
        </div>
        {status && (
          <div className="px-3 py-1.5 border-t border-gray-100">
            <span className={`text-xs ${status.ok ? "text-green-600" : "text-red-600"}`}>
              {status.message}
            </span>
          </div>
        )}
      </div>
      <div
        className="h-1.5 cursor-row-resize flex-shrink-0 flex items-center justify-center hover:bg-[var(--thumb-bg)] transition-colors"
        style={{
          backgroundColor: "var(--control-bg)",
          borderTop: "1px solid var(--thumb-bg)",
          borderBottom: "1px solid var(--thumb-bg)",
        }}
        onPointerDown={handlePointerDown}
      >
        <div className="w-8 h-0.5 rounded-full bg-[var(--text-muted)] opacity-40" />
      </div>
      <div
        className="relative min-h-0"
        style={{ flex: `${1 - splitRatio} 1 0%`, backgroundColor: "var(--control-bg)" }}
      >
        <pre
          ref={preRef}
          className="absolute inset-0 text-sm font-mono px-3 py-2 overflow-hidden pointer-events-none whitespace-pre-wrap break-words m-0"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlightMappingSyntax(text) + "\n" }}
        />
        <textarea
          ref={codeRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          placeholder={`// Map original filenames to custom names\n"actor1": "hero_sprite"\n"dungeon_a1": "cave_tileset"`}
          className="relative w-full h-full text-sm font-mono px-3 py-2 focus:outline-none resize-none bg-transparent"
          style={{ color: "transparent", caretColor: "var(--text)" }}
        />
      </div>
    </div>
  );
}

type SettingsTab = "general" | "game" | "style" | "theme" | "mapping";

function SettingsView({
  mappingText,
  style,
  config,
  appearance,
  subredditName,
  onMappingSaved,
  onStyleChanged,
  onConfigChanged,
}: {
  mappingText: string;
  style: StyleConfig;
  config: GameConfig;
  appearance: SubredditAppearance;
  subredditName: string;
  onMappingSaved: (text: string, mapping: Record<string, string> | null) => void;
  onStyleChanged: (style: StyleConfig) => void;
  onConfigChanged: (config: GameConfig) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [text, setText] = useState(mappingText);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [editingMode, setEditingMode] = useState<"light" | "dark">("light");
  const [gameTitle, setGameTitle] = useState(config.gameName);
  const [wikiTitleField, setWikiTitleField] = useState(config.wikiTitle);
  const [wikiDescriptionField, setWikiDescriptionField] = useState(config.wikiDescription);
  const [homeBackground, setHomeBackground] = useState<HomeBackground>(config.homeBackground);
  const [homeLogo, setHomeLogo] = useState<HomeLogo>(config.homeLogo);
  const [engineField, setEngineField] = useState<EngineType>(config.engine);
  const [encryptionKeyField, setEncryptionKeyField] = useState(config.encryptionKey);
  const [savingConfig, setSavingConfig] = useState(false);

  const isTcoaalDetected = useMemo(() => {
    const t = gameTitle.toLowerCase();
    return t.includes("coffin") && t.includes("andy") && t.includes("leyley");
  }, [gameTitle]);

  useEffect(() => {
    if (isTcoaalDetected) {
      setEngineField("tcoaal");
      setEncryptionKeyField("");
    }
  }, [isTcoaalDetected]);

  const editingColors = editingMode === "light" ? style.light : style.dark;

  const parsedEntries = useMemo(() => parseMappingText(text), [text]);

  const configDirty =
    gameTitle !== config.gameName ||
    wikiTitleField !== config.wikiTitle ||
    wikiDescriptionField !== config.wikiDescription ||
    homeBackground !== config.homeBackground ||
    homeLogo !== config.homeLogo ||
    engineField !== config.engine ||
    encryptionKeyField !== config.encryptionKey;

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameName: gameTitle,
          wikiTitle: wikiTitleField,
          wikiDescription: wikiDescriptionField,
          homeBackground,
          homeLogo,
          engine: engineField,
          encryptionKey: encryptionKeyField,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { config: GameConfig };
        onConfigChanged(data.config);
      }
    } catch {
    } finally {
      setSavingConfig(false);
    }
  }, [
    gameTitle,
    wikiTitleField,
    wikiDescriptionField,
    homeBackground,
    homeLogo,
    engineField,
    encryptionKeyField,
    onConfigChanged,
  ]);

  const handleSaveMapping = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const entries = parseMappingText(text);
      const res = await fetch("/api/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          entries: entries.length > 0 ? entries : undefined,
        }),
      });
      if (res.ok) {
        const data: MappingResponse = await res.json();
        onMappingSaved(data.text, data.mapping);
        setStatus({ ok: true, message: "Mapping saved" });
      } else {
        const err = await res.json();
        setStatus({
          ok: false,
          message: (err as { message?: string }).message ?? "Save failed",
        });
      }
    } catch {
      setStatus({ ok: false, message: "Network error" });
    } finally {
      setSaving(false);
    }
  }, [text, onMappingSaved]);

  const saveStyle = useCallback(
    async (update: Record<string, string>) => {
      try {
        const res = await fetch("/api/style", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        if (res.ok) {
          const data: StyleResponse = await res.json();
          onStyleChanged(data.style);
        }
      } catch {}
    },
    [onStyleChanged],
  );

  const saveColor = useCallback(
    (field: string, value: string) => {
      void saveStyle({ mode: editingMode, [field]: value });
    },
    [saveStyle, editingMode],
  );

  const mappingDirty = text !== mappingText;
  const anyDirty = configDirty || mappingDirty;

  const handleSaveAll = useCallback(async () => {
    if (configDirty) void handleSaveConfig();
    if (mappingDirty) void handleSaveMapping();
  }, [configDirty, mappingDirty, handleSaveConfig, handleSaveMapping]);

  const defaultColors = useMemo(() => {
    const accent = appearance.keyColor ?? "#d93900";
    const bg = appearance.bgColor ?? "#ffffff";
    const highlight = appearance.highlightColor ?? darkenHex(bg, 0.05);
    const light: ColorTheme = {
      accentColor: accent,
      linkColor: accent,
      bgColor: bg,
      textColor: "#f3f3f3",
      textMuted: "#919191",
      thumbBgColor: highlight,
      controlBgColor: highlight,
      controlTextColor: "#f3f3f3",
    };
    const darkAccent = appearance.keyColor ?? "#ff6b3d";
    const dark: ColorTheme = {
      accentColor: darkAccent,
      linkColor: darkAccent,
      bgColor: appearance.bgColor ?? "#1a1a1b",
      textColor: "#f3f3f3",
      textMuted: "#919191",
      thumbBgColor: appearance.highlightColor ?? "#343536",
      controlBgColor: appearance.highlightColor ?? "#343536",
      controlTextColor: "#f3f3f3",
    };
    return { light, dark };
  }, [appearance]);

  const editingDefaults = editingMode === "light" ? defaultColors.light : defaultColors.dark;

  const SETTINGS_TABS: readonly { value: SettingsTab; label: string }[] = [
    { value: "general", label: "General" },
    { value: "game", label: "Game" },
    { value: "style", label: "Style" },
    { value: "theme", label: "Theme" },
    { value: "mapping", label: "Mapping" },
  ] as const;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex gap-1">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.value}
              className={`text-xs px-[10px] py-[4px] rounded-full transition-colors cursor-pointer ${
                settingsTab === tab.value
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)]"
              }`}
              style={settingsTab !== tab.value ? { backgroundColor: "transparent" } : undefined}
              onMouseEnter={(e) => {
                if (settingsTab !== tab.value)
                  e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
              }}
              onMouseLeave={(e) => {
                if (settingsTab !== tab.value)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
              onClick={() => setSettingsTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void handleSaveAll()}
          disabled={!anyDirty || savingConfig || saving}
          className="text-xs px-[10px] py-[4px] rounded-full bg-[var(--accent)] text-white transition-colors cursor-pointer disabled:opacity-30"
        >
          {savingConfig || saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div
        className={`flex-1 ${settingsTab === "mapping" ? "overflow-hidden flex flex-col" : "overflow-auto px-4 py-4"}`}
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        {settingsTab === "general" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Title</span>
              <input
                type="text"
                value={wikiTitleField}
                onChange={(e) => setWikiTitleField(e.target.value)}
                placeholder={`WIKI r/${subredditName}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{
                  backgroundColor: "var(--control-bg)",
                  color: "var(--control-text)",
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Displayed on the home screen below the logo. Leave empty for default.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Description</span>
              <input
                type="text"
                value={wikiDescriptionField}
                onChange={(e) => setWikiDescriptionField(e.target.value)}
                placeholder="A short description shown on the home screen"
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{
                  backgroundColor: "var(--control-bg)",
                  color: "var(--control-text)",
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Displayed on the home screen below the title.
              </span>
            </div>
          </div>
        )}

        {settingsTab === "game" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Game Title</span>
              <input
                type="text"
                value={gameTitle}
                onChange={(e) => setGameTitle(e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{
                  backgroundColor: "var(--control-bg)",
                  color: "var(--control-text)",
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Shown to users on import. Warns if imported game doesn't match.
              </span>
            </div>

            {gameTitle.length > 0 && (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium">Engine</span>
                  <select
                    value={engineField}
                    onChange={(e) => setEngineField(e.target.value as EngineType)}
                    disabled={isTcoaalDetected}
                    className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--control-bg)",
                      color: "var(--control-text)",
                    }}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="rm2k3">RPG Maker 2003</option>
                    <option value="rmxp">RPG Maker XP</option>
                    <option value="rmvx">RPG Maker VX</option>
                    <option value="rmvxace">RPG Maker VX Ace</option>
                    <option value="rmmv">RPG Maker MV</option>
                    <option value="rmmv-encrypted">RPG Maker MV (Encrypted)</option>
                    <option value="rmmz">RPG Maker MZ</option>
                    <option value="rmmz-encrypted">RPG Maker MZ (Encrypted)</option>
                    <option value="tcoaal">TCOAAL</option>
                  </select>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {isTcoaalDetected
                      ? "Auto-detected from game title."
                      : "Override the engine auto-detection. Leave on Auto-detect if unsure."}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium">Encryption Key</span>
                  <input
                    type="text"
                    value={encryptionKeyField}
                    onChange={(e) => setEncryptionKeyField(e.target.value)}
                    disabled={isTcoaalDetected}
                    placeholder="Leave empty for auto-detection"
                    className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--control-bg)",
                      color: "var(--control-text)",
                    }}
                  />
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {isTcoaalDetected
                      ? "TCOAAL does not use a user-provided key."
                      : "Override the encryption key used for decryption. Leave empty if unsure."}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {settingsTab === "style" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Home Background</span>
              <SegmentedControl
                value={homeBackground}
                options={[
                  { value: "ripple" as HomeBackground, label: "Ripple" },
                  ...(appearance.bannerUrl
                    ? [
                        { value: "banner" as HomeBackground, label: "Banner" },
                        { value: "both" as HomeBackground, label: "Both" },
                      ]
                    : []),
                  { value: "none" as HomeBackground, label: "None" },
                ]}
                onChange={setHomeBackground}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Background effect on the home/import screen.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Home Logo</span>
              <SegmentedControl
                value={homeLogo}
                options={[
                  { value: "echowiki" as HomeLogo, label: "EchoWiki" },
                  ...(appearance.iconUrl
                    ? [{ value: "subreddit" as HomeLogo, label: "Subreddit" }]
                    : []),
                ]}
                onChange={setHomeLogo}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Logo displayed on the home/import screen.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Font</span>
              <SegmentedControl
                value={style.fontFamily}
                options={[
                  { value: "system" as FontFamily, label: "System" },
                  { value: "serif" as FontFamily, label: "Serif" },
                  { value: "mono" as FontFamily, label: "Mono" },
                  { value: "subreddit" as FontFamily, label: "Subreddit" },
                ]}
                onChange={(v) => void saveStyle({ fontFamily: v })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Card Size</span>
              <SegmentedControl
                value={style.cardSize}
                options={[
                  { value: "compact" as CardSize, label: "Compact" },
                  { value: "normal" as CardSize, label: "Normal" },
                  { value: "large" as CardSize, label: "Large" },
                ]}
                onChange={(v) => void saveStyle({ cardSize: v })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Font Size</span>
              <SegmentedControl
                value={style.wikiFontSize}
                options={[
                  { value: "small" as WikiFontSize, label: "Small" },
                  { value: "normal" as WikiFontSize, label: "Normal" },
                  { value: "large" as WikiFontSize, label: "Large" },
                ]}
                onChange={(v) => void saveStyle({ wikiFontSize: v })}
              />
            </div>
          </div>
        )}

        {settingsTab === "theme" && (
          <div className="flex flex-col gap-4">
            <SegmentedControl
              value={editingMode}
              options={[
                { value: "light" as const, label: "Light" },
                { value: "dark" as const, label: "Dark" },
              ]}
              onChange={setEditingMode}
            />

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div className="flex flex-col gap-4">
                <ColorPickerRow
                  key={`accent-${editingMode}`}
                  label="Accent"
                  value={editingColors.accentColor}
                  defaultValue={editingDefaults.accentColor}
                  onSelect={(c) => saveColor("accentColor", c)}
                />
                <ColorPickerRow
                  key={`link-${editingMode}`}
                  label="Links"
                  value={editingColors.linkColor}
                  defaultValue={editingDefaults.linkColor}
                  onSelect={(c) => saveColor("linkColor", c)}
                />
                <ColorPickerRow
                  key={`text-${editingMode}`}
                  label="Text"
                  value={editingColors.textColor}
                  defaultValue={editingDefaults.textColor}
                  onSelect={(c) => saveColor("textColor", c)}
                />
                <ColorPickerRow
                  key={`muted-${editingMode}`}
                  label="Muted Text"
                  value={editingColors.textMuted}
                  defaultValue={editingDefaults.textMuted}
                  onSelect={(c) => saveColor("textMuted", c)}
                />
              </div>
              <div className="flex flex-col gap-4">
                <ColorPickerRow
                  key={`bg-${editingMode}`}
                  label="Background"
                  value={editingColors.bgColor}
                  defaultValue={editingDefaults.bgColor}
                  onSelect={(c) => saveColor("bgColor", c)}
                />
                <ColorPickerRow
                  key={`thumb-${editingMode}`}
                  label="Thumbnail Bg"
                  value={editingColors.thumbBgColor}
                  defaultValue={editingDefaults.thumbBgColor}
                  onSelect={(c) => saveColor("thumbBgColor", c)}
                />
                <ColorPickerRow
                  key={`control-bg-${editingMode}`}
                  label="Control Bg"
                  value={editingColors.controlBgColor}
                  defaultValue={editingDefaults.controlBgColor}
                  onSelect={(c) => saveColor("controlBgColor", c)}
                />
                <ColorPickerRow
                  key={`control-text-${editingMode}`}
                  label="Control Text"
                  value={editingColors.controlTextColor}
                  defaultValue={editingDefaults.controlTextColor}
                  onSelect={(c) => saveColor("controlTextColor", c)}
                />
              </div>
            </div>
          </div>
        )}

        {settingsTab === "mapping" && (
          <MappingPanel
            text={text}
            setText={setText}
            parsedEntries={parsedEntries}
            status={status}
          />
        )}
      </div>
    </>
  );
}

export const App = () => {
  const [appState, setAppState] = useState<AppState>("loading");
  const [activeTab, setActiveTab] = useState<ActiveTab>("wiki");
  const [subredditName, setSubredditName] = useState("");
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [isMod, setIsMod] = useState(false);
  const [username, setUsername] = useState("");
  const [meta, setMeta] = useState<EchoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [paths, setPaths] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterType>("images");
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [mappingText, setMappingText] = useState('"original_filename": "mapped_filename"');
  const [pathToMapped, setPathToMapped] = useState<Map<string, string>>(new Map());

  const [gameMismatch, setGameMismatch] = useState<{
    expected: string;
    detected: string;
  } | null>(null);
  const [mappingUpdateInfo, setMappingUpdateInfo] = useState<string | null>(null);
  const mappingRef = useRef<Record<string, string> | null>(null);
  const [style, setStyle] = useState<StyleConfig>({ ...DEFAULT_STYLE });
  const [appearance, setAppearance] = useState<SubredditAppearance>({ ...DEFAULT_APPEARANCE });
  const [initResolved, setInitResolved] = useState(false);
  const [isDark, setIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    mappingRef.current = mapping;
  }, [mapping]);

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewInitialEditions, setPreviewInitialEditions] = useState<Edition[] | null>(null);

  const [wikiCurrentPage, setWikiCurrentPage] = useState("index");
  const [wikiPages, setWikiPages] = useState<string[]>([]);
  const [wikiTargetAnchor, setWikiTargetAnchor] = useState<string | null>(null);
  const [showEchoLinkDialog, setShowEchoLinkDialog] = useState(false);
  const [echoLinkInput, setEchoLinkInput] = useState("");
  const [echoLinkError, setEchoLinkError] = useState<string | null>(null);
  const [showBreadcrumb, setShowBreadcrumb] = useState(false);
  const [openBreadcrumbDropdown, setOpenBreadcrumbDropdown] = useState<number | null>(null);
  const breadcrumbBarRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const breadcrumbHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelBreadcrumbHide = useCallback(() => {
    if (breadcrumbHideTimerRef.current) {
      clearTimeout(breadcrumbHideTimerRef.current);
      breadcrumbHideTimerRef.current = null;
    }
  }, []);

  const scheduleBreadcrumbHide = useCallback(() => {
    if (breadcrumbHideTimerRef.current) clearTimeout(breadcrumbHideTimerRef.current);
    breadcrumbHideTimerRef.current = setTimeout(() => {
      breadcrumbHideTimerRef.current = null;
      setShowBreadcrumb(false);
      setOpenBreadcrumbDropdown(null);
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      if (breadcrumbHideTimerRef.current) clearTimeout(breadcrumbHideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleAppLeave = () => {
      if (breadcrumbHideTimerRef.current) {
        clearTimeout(breadcrumbHideTimerRef.current);
        breadcrumbHideTimerRef.current = null;
      }
      setShowBreadcrumb(false);
      setOpenBreadcrumbDropdown(null);
    };
    document.documentElement.addEventListener("mouseleave", handleAppLeave);
    return () => document.documentElement.removeEventListener("mouseleave", handleAppLeave);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/wiki/pages");
        if (res.ok) {
          const data: WikiPagesResponse = await res.json();
          setWikiPages(data.pages);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (openBreadcrumbDropdown === null) return;
    const handler = () => setOpenBreadcrumbDropdown(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openBreadcrumbDropdown]);

  const wikiBreadcrumbs = useMemo(() => {
    const parts = wikiCurrentPage.split("/");
    return parts.map((part, i) => {
      const pagePath = parts.slice(0, i + 1).join("/");
      const prefix = i > 0 ? parts.slice(0, i).join("/") + "/" : "";
      const siblings = wikiPages
        .filter((p) => {
          if (!p.startsWith(prefix)) return false;
          const rest = p.slice(prefix.length);
          return !rest.includes("/") && rest !== part;
        })
        .sort();
      return {
        label: part.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        page: pagePath,
        siblings,
      };
    });
  }, [wikiCurrentPage, wikiPages]);

  const handleBreadcrumbBarLeave = useCallback(
    (e: ReactMouseEvent) => {
      const topBar = topBarRef.current;
      const related = e.relatedTarget;
      if (topBar && related instanceof Node && topBar.contains(related)) {
        cancelBreadcrumbHide();
        return;
      }
      scheduleBreadcrumbHide();
    },
    [cancelBreadcrumbHide, scheduleBreadcrumbHide],
  );

  const colors: ColorTheme = isDark ? style.dark : style.light;

  const preImportVars = useMemo((): CSSProperties => {
    if (!initResolved) return ECHOWIKI_PRE_IMPORT;
    const bg = colors.bgColor;
    const accent = colors.accentColor;
    const text = colors.textColor;
    const muted = colors.textMuted;
    return {
      "--accent": accent,
      "--accent-hover": darkenHex(accent, 0.05),
      "--accent-ring": hexToRgba(accent, 0.2),
      "--bg": bg,
      "--text": text,
      "--text-muted": muted,
      "--thumb-bg": colors.thumbBgColor,
      "--control-bg": colors.controlBgColor,
      "--control-text": colors.controlTextColor,
    } as CSSProperties;
  }, [initResolved, colors]);

  const wikiTitle = useMemo(() => {
    if (config?.wikiTitle) return config.wikiTitle;
    if (subredditName) return `WIKI r/${subredditName}`;
    return "";
  }, [config?.wikiTitle, subredditName]);

  const cssVars = useMemo(
    () =>
      ({
        "--accent": colors.accentColor,
        "--accent-hover": darkenHex(colors.accentColor, 0.05),
        "--accent-ring": hexToRgba(colors.accentColor, 0.2),
        "--link-color": colors.linkColor,
        "--bg": colors.bgColor,
        "--text": colors.textColor,
        "--text-muted": colors.textMuted,
        "--thumb-bg": colors.thumbBgColor,
        "--control-bg": colors.controlBgColor,
        "--control-text": colors.controlTextColor,
      }) as CSSProperties,
    [
      colors.accentColor,
      colors.linkColor,
      colors.bgColor,
      colors.textColor,
      colors.textMuted,
      colors.thumbBgColor,
      colors.controlBgColor,
      colors.controlTextColor,
    ],
  );

  useEffect(() => {
    const init = async () => {
      const stylePromise = fetch("/api/style").catch(() => null);
      let initConfig: GameConfig | null = null;

      try {
        const res = await fetch("/api/init");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: InitResponse = await res.json();
        setSubredditName(data.subredditName);
        setConfig(data.config);
        setIsMod(data.isMod);
        setUsername(data.username);
        setAppearance(data.appearance);
        initConfig = data.config;
      } catch {}

      try {
        const styleRes = await stylePromise;
        if (styleRes?.ok) {
          const data: StyleResponse = await styleRes.json();
          setStyle(data.style);
        }
      } catch {}

      setInitResolved(true);

      const imported = await hasAssets();
      if (imported) {
        const mappingPromise = fetch("/api/mapping").catch(() => null);

        const m = await getMeta();
        setMeta(m ?? null);
        const allPaths = await listAssetPaths();
        setPaths(allPaths);

        try {
          const mappingRes = await mappingPromise;
          if (mappingRes?.ok) {
            const data: MappingResponse = await mappingRes.json();
            setMapping(data.mapping);
            setMappingText(data.text);
            if (data.mapping) {
              const result = await applyMapping(data.mapping);
              setPathToMapped(result);
              setReverseMapping(result);
            }
          }
        } catch {}

        if (
          initConfig?.gameName &&
          m?.gameTitle &&
          initConfig.gameName.toLowerCase() !== m.gameTitle.toLowerCase()
        ) {
          setGameMismatch({ expected: initConfig.gameName, detected: m.gameTitle });
          setActiveTab("assets");
        }

        setAppState("ready");
      } else {
        setAppState("no-assets");
      }
    };
    void init();
  }, []);

  const filteredPaths = useMemo(() => {
    let result = filter === "images" ? paths.filter(isImagePath) : paths.filter(isAudioPath);
    if (subFilter) {
      result = result.filter((p) => getSubfolder(p) === subFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => {
        if (p.includes(q)) return true;
        const mp = pathToMapped.get(p);
        if (mp && mp.includes(q)) return true;
        return false;
      });
    }
    return [...result].sort((a, b) =>
      naturalSortKey(a, pathToMapped).localeCompare(naturalSortKey(b, pathToMapped), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [paths, filter, subFilter, search, pathToMapped]);

  const subcategories = useMemo(() => {
    const categoryPaths =
      filter === "images" ? paths.filter(isImagePath) : paths.filter(isAudioPath);

    const folderCounts = new Map<string, number>();
    for (const p of categoryPaths) {
      const folder = getSubfolder(p);
      if (folder) {
        folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
      }
    }
    return [...folderCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(([name, count]) => ({ name, count }));
  }, [paths, filter]);

  const visiblePaths = filteredPaths.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPaths.length;

  useEffect(() => {
    if (subcategories.length > 0 && !subcategories.some((s) => s.name === subFilter)) {
      setSubFilter(subcategories[0]!.name);
    }
  }, [subcategories, subFilter]);

  const counts = useMemo(
    () => ({
      images: paths.filter(isImagePath).length,
      audio: paths.filter(isAudioPath).length,
    }),
    [paths],
  );

  const gridClass =
    style.cardSize === "compact"
      ? "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]"
      : style.cardSize === "large"
        ? "grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
        : "grid-cols-[repeat(auto-fill,minmax(80px,1fr))]";

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);
      setAppState("importing");
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const mappingPromise = fetch("/api/mapping").catch(() => null);

      const applyMappingFromPromise = async () => {
        try {
          const mappingRes = await mappingPromise;
          if (mappingRes?.ok) {
            const data: MappingResponse = await mappingRes.json();
            setMapping(data.mapping);
            setMappingText(data.text);
            if (data.mapping) {
              const result = await applyMapping(data.mapping);
              setPathToMapped(result);
              setReverseMapping(result);
            }
          }
        } catch {}
      };

      try {
        const progressRef: { current: ImportProgress | null } = {
          current: null,
        };
        await importGameFiles({
          files,
          engineOverride: config?.engine,
          keyOverride: config?.encryptionKey || undefined,
          onProgress: (p) => {
            progressRef.current = p;
          },
          signal: controller.signal,
        });
        const m = await getMeta();
        setMeta(m ?? null);
        const allPaths = await listAssetPaths();
        setPaths(allPaths);
        setFilter("images");
        setSubFilter(null);
        setSearch("");
        setVisibleCount(PAGE_SIZE);

        await applyMappingFromPromise();

        if (
          config?.gameName &&
          progressRef.current?.gameTitle &&
          config.gameName.toLowerCase() !== progressRef.current.gameTitle.toLowerCase()
        ) {
          setGameMismatch({
            expected: config.gameName,
            detected: progressRef.current.gameTitle,
          });
          setActiveTab("assets");
        }

        setAppState("ready");
      } catch (err) {
        if (err instanceof Error && err.message === "Import cancelled") {
          const still = await hasAssets();
          if (still) {
            const allPaths = await listAssetPaths();
            setPaths(allPaths);
            await applyMappingFromPromise();
            setAppState("ready");
          } else {
            setAppState("no-assets");
          }
        } else {
          setError(err instanceof Error ? err.message : "Import failed");
          const still = await hasAssets();
          if (still) {
            const allPaths = await listAssetPaths();
            setPaths(allPaths);
            await applyMappingFromPromise();
            setAppState("ready");
          } else {
            setAppState("no-assets");
          }
        }
      } finally {
        abortRef.current = null;
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [config],
  );

  const handleCopied = useCallback((_path: string) => {
    showToast("Copied echo link");
  }, []);

  const handleCopyEchoLink = useCallback((link: string) => {
    const container = document.querySelector("[data-wiki-scroll]") as HTMLElement | null;
    const savedTop = container?.scrollTop ?? 0;
    if (container && savedTop > 0) {
      requestAnimationFrame(() => {
        if (container.scrollTop === 0) container.scrollTop = savedTop;
      });
    }
    void navigator.clipboard.writeText(link).then(() => {
      if (container && container.scrollTop === 0 && savedTop > 0) container.scrollTop = savedTop;
      showToast("Copied echo link");
    });
  }, []);

  const handleAnchorConsumed = useCallback(() => setWikiTargetAnchor(null), []);

  const handleWipe = useCallback(async () => {
    revokeAllBlobUrls();
    await wipeAll();
    setMeta(null);
    setPaths([]);
    setFilter("images");
    setSubFilter(null);
    setSearch("");
    setPreviewInitialEditions(null);
    setVisibleCount(PAGE_SIZE);
    setMapping(null);
    setPathToMapped(new Map());
    setReverseMapping(null);
    setPreviewPath(null);
    setActiveTab("wiki");
    setGameMismatch(null);
    setAppState("no-assets");
  }, []);

  const handleMappingSaved = useCallback(
    (newText: string, newMapping: Record<string, string> | null) => {
      const oldMapping = mappingRef.current;

      setMappingText(newText);
      setMapping(newMapping);
      if (newMapping) {
        void applyMapping(newMapping).then((result) => {
          setPathToMapped(result);
          setReverseMapping(result);
        });
      } else {
        setPathToMapped(new Map());
        setReverseMapping(null);
      }

      const lostNames = new Map<string, string>();
      if (oldMapping) {
        for (const [originalKey, oldMappedValue] of Object.entries(oldMapping)) {
          if (newMapping?.[originalKey] !== oldMappedValue) {
            lostNames.set(oldMappedValue, originalKey);
          }
        }
      }

      if (lostNames.size > 0) {
        void (async () => {
          try {
            const pagesRes = await fetch("/api/wiki/pages");
            if (!pagesRes.ok) return;
            const pagesData: WikiPagesResponse = await pagesRes.json();
            let totalReplacements = 0;
            const updatedPages: string[] = [];

            for (const page of pagesData.pages) {
              const wikiRes = await fetch(`/api/wiki?page=${encodeURIComponent(page)}`);
              if (!wikiRes.ok) continue;
              const wikiData: WikiResponse = await wikiRes.json();
              if (!wikiData.content) continue;

              let content = wikiData.content;
              let changed = false;
              for (const [lostName, originalKey] of lostNames) {
                const escaped = lostName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp(
                  `(echo://[^\\s)"]*?)${escaped}(\\.[a-zA-Z0-9]+(?:\\?[^\\s)"]*)?)`,
                  "gi",
                );
                const newContent = content.replace(re, `$1${originalKey}$2`);
                if (newContent !== content) {
                  const matches = content.match(re);
                  totalReplacements += matches?.length ?? 0;
                  content = newContent;
                  changed = true;
                }
              }

              if (changed) {
                const updateRes = await fetch("/api/wiki/update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    page,
                    content,
                    reason: "EchoWiki: auto-replace stale mapped names",
                  }),
                });
                if (updateRes.ok) {
                  updatedPages.push(page);
                }
              }
            }

            if (updatedPages.length > 0) {
              setMappingUpdateInfo(
                `Updated ${totalReplacements} echo link${totalReplacements !== 1 ? "s" : ""} in ${updatedPages.join(", ")}`,
              );
            }
          } catch {}
        })();
      }
    },
    [],
  );

  const handleEchoLinkGo = useCallback(() => {
    let trimmed = echoLinkInput.trim();

    const mdMatch = /^!\[.*?\]\(((?:echo|echolink):\/\/[^)]+)\)$/.exec(trimmed);
    if (mdMatch?.[1]) trimmed = mdMatch[1];

    if (trimmed.startsWith("echo://")) {
      const echoPath = trimmed.slice("echo://".length).toLowerCase();
      const { basePath: rawBase, editions } = parseEditions(echoPath);
      let basePath = rawBase;
      if (!paths.includes(basePath)) {
        const inputFileName = getFileName(basePath).toLowerCase();
        let resolved: string | null = null;
        for (const [origPath, mappedName] of pathToMapped.entries()) {
          if (getFileName(mappedName).toLowerCase() === inputFileName) {
            resolved = origPath;
            break;
          }
        }
        if (!resolved) {
          setEchoLinkError("Asset not found in the loaded game files.");
          return;
        }
        basePath = resolved;
      }
      const newFilter: FilterType = isImagePath(basePath) ? "images" : "audio";
      const subfolder = getSubfolder(basePath);
      setShowEchoLinkDialog(false);
      setEchoLinkError(null);
      setActiveTab("assets");
      setFilter(newFilter);
      setSubFilter(subfolder);
      setSearch("");
      setVisibleCount(PAGE_SIZE);
      setPreviewInitialEditions(editions.length > 0 ? editions : null);
      setPreviewPath(basePath);
      return;
    }

    const target = parseEchoLink(trimmed, subredditName, wikiPages);
    if (!target) {
      setEchoLinkError(
        trimmed.startsWith("echolink://")
          ? "Page not found or wrong subreddit."
          : "Enter a valid echolink:// or echo:// URL.",
      );
      return;
    }
    setShowEchoLinkDialog(false);
    setEchoLinkError(null);
    if (target.type === "assets") {
      setActiveTab("assets");
    } else {
      setActiveTab("wiki");
      setWikiCurrentPage(target.page);
      setWikiTargetAnchor(target.anchor);
    }
  }, [echoLinkInput, subredditName, wikiPages, paths, pathToMapped]);

  const handleStyleChanged = useCallback((newStyle: StyleConfig) => {
    setStyle(newStyle);
  }, []);

  const isInline = getWebViewMode() === "inline";

  useEffect(() => {
    if (!isInline || appState !== "ready") return;
    const onFocus = () => {
      void hasAssets().then((still) => {
        if (!still) {
          revokeAllBlobUrls();
          setMeta(null);
          setPaths([]);
          setActiveTab("wiki");
          setGameMismatch(null);
          setAppState("no-assets");
        }
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isInline, appState]);

  return (
    <div
      className="flex flex-col h-screen"
      style={{
        ...(appState === "ready" ? cssVars : preImportVars),
        backgroundColor: "var(--bg)",
        color: "var(--text)",
        fontFamily: getFontFamily(
          appState === "ready" || initResolved ? style.fontFamily : "system",
          appearance.font,
        ),
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e)}
      />

      {showEchoLinkDialog && (
        <EchoLinkDialog
          subredditName={subredditName}
          input={echoLinkInput}
          error={echoLinkError}
          onInputChange={(v) => {
            setEchoLinkInput(v);
            setEchoLinkError(null);
          }}
          onGo={handleEchoLinkGo}
          onDismiss={() => setShowEchoLinkDialog(false)}
        />
      )}

      {previewPath && (
        <AssetPreview
          path={previewPath}
          mappedPath={pathToMapped.get(previewPath)}
          onClose={() => {
            setPreviewPath(null);
            setPreviewInitialEditions(null);
          }}
          onCopied={handleCopied}
          initialEditions={previewInitialEditions ?? undefined}
        />
      )}

      {appState !== "ready" && (
        <div className="flex-1 relative flex flex-col items-center overflow-hidden">
          {}
          <div
            className="absolute inset-0 pointer-events-none bg-crossfade bg-cover bg-center"
            style={{
              backgroundImage: "url(/default-splash.png)",
              opacity: initResolved ? 0 : 1,
              zIndex: 0,
            }}
          />

          {}
          <div
            className="absolute inset-0 pointer-events-none bg-crossfade"
            style={{
              backgroundColor: "var(--bg)",
              opacity: initResolved ? 1 : 0,
              zIndex: 0,
            }}
          />

          {}
          {appearance.bannerUrl && (
            <div
              className="absolute top-0 left-0 right-0 overflow-hidden pointer-events-none bg-crossfade flex justify-center"
              style={{
                height: 120,
                opacity:
                  initResolved &&
                  (config?.homeBackground === "banner" || config?.homeBackground === "both") &&
                  appState !== "importing"
                    ? 0.3
                    : 0,
                zIndex: 1,
              }}
            >
              <img
                src={appearance.bannerUrl}
                alt=""
                className="h-full w-auto min-w-full object-cover"
              />
            </div>
          )}

          {}
          <div
            className={
              appState === "importing"
                ? "ripple-container ripple-inward"
                : initResolved &&
                    (config?.homeBackground === "ripple" || config?.homeBackground === "both")
                  ? "ripple-container"
                  : "ripple-container ripple-hidden"
            }
            style={{
              position: "absolute",
              top:
                !initResolved || appState === "loading" || appState === "importing"
                  ? "calc(50% - 150px)"
                  : "-5%",
              transition: "top 0.7s ease-in-out",
              zIndex: 2,
            }}
          >
            <div />
            <div />
            <div />

            {}
            <img
              src="/title.png"
              alt="EchoWiki"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-50 object-contain z-1 title-crossfade"
              style={{
                opacity: !initResolved || !config || config.homeLogo === "echowiki" ? 1 : 0,
              }}
            />

            {}
            {appearance.iconUrl && (
              <img
                src={appearance.iconUrl}
                alt={subredditName}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-30 w-30 rounded-full object-cover z-1 title-crossfade"
                style={{
                  opacity: initResolved && config?.homeLogo === "subreddit" ? 1 : 0,
                }}
              />
            )}

            {}
            {initResolved && wikiTitle && (
              <p
                className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-1 title-content-reveal"
                style={{ top: "70%" }}
              >
                <span className="text-base text-[var(--text)] whitespace-nowrap">{wikiTitle}</span>
                <span className="relative mt-1 flex justify-center" style={{ minHeight: 16 }}>
                  {config?.wikiDescription && (
                    <span
                      className="text-xs text-[var(--text-muted)] whitespace-nowrap title-crossfade"
                      style={{ opacity: appState !== "importing" ? 1 : 0 }}
                    >
                      {config.wikiDescription}
                    </span>
                  )}
                  <span
                    className={`text-xs text-[var(--text-muted)] whitespace-nowrap title-crossfade${config?.wikiDescription ? " absolute" : ""}`}
                    style={{ opacity: appState === "importing" ? 1 : 0 }}
                  >
                    Loading
                  </span>
                </span>
              </p>
            )}
          </div>

          {(appState === "no-assets" || appState === "importing") && initResolved && (
            <div
              className={`flex flex-col items-center gap-6 max-w-md text-center${appState === "no-assets" ? " home-content-reveal" : ""}`}
              style={{
                position: "absolute",
                top: "50%",
                zIndex: 3,
                opacity: appState === "no-assets" ? 1 : 0,
                transition: "opacity 0.5s ease-out",
                pointerEvents: appState === "no-assets" ? "auto" : "none",
              }}
            >
              {config?.gameName ? (
                <p className="text-[var(--text-muted)] text-sm">
                  To view the Wiki, select the folder containing
                  <br />
                  <span className="font-semibold text-[var(--text)]">{config.gameName}</span>
                  <br />
                </p>
              ) : (
                <p className="text-[var(--text-muted)] text-sm">
                  To view the Wiki, select your game folder
                  <br />
                </p>
              )}
              <button
                className="flex items-center justify-center h-10 rounded-full cursor-pointer transition-all px-6 font-medium hover:scale-105 hover:font-bold hover:border-2 hover:border-[var(--text)]"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--text)",
                }}
                onClick={handleImport}
              >
                Select Game Folder
              </button>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {appState === "ready" && (
        <>
          <div className="relative" style={{ zIndex: 10 }}>
            <div
              ref={topBarRef}
              className={`flex items-center justify-between px-4 py-2 border-b ${showBreadcrumb && activeTab === "wiki" ? "border-transparent" : "border-gray-100"}`}
              onMouseEnter={cancelBreadcrumbHide}
              onMouseLeave={(e) => {
                const bar = breadcrumbBarRef.current;
                const related = e.relatedTarget;
                if (bar && related instanceof Node && bar.contains(related)) {
                  cancelBreadcrumbHide();
                  return;
                }
                scheduleBreadcrumbHide();
              }}
            >
              <div className="flex items-center gap-1">
                {!gameMismatch && (
                  <button
                    className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      activeTab === "wiki"
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                    style={activeTab !== "wiki" ? { backgroundColor: "transparent" } : undefined}
                    onMouseEnter={(e) => {
                      if (activeTab === "wiki") {
                        setShowBreadcrumb(true);
                      } else {
                        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== "wiki")
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => setActiveTab("wiki")}
                  >
                    Wiki
                  </button>
                )}
                <button
                  className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                    activeTab === "assets"
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--text-muted)]"
                  }`}
                  style={activeTab !== "assets" ? { backgroundColor: "transparent" } : undefined}
                  onMouseEnter={(e) => {
                    if (activeTab !== "assets")
                      e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== "assets")
                      e.currentTarget.style.backgroundColor = "transparent";
                  }}
                  onClick={() => setActiveTab("assets")}
                >
                  Assets
                  {meta && (
                    <span className="ml-1 opacity-70">{meta.assetCount.toLocaleString()}</span>
                  )}
                </button>
                {isMod && (
                  <button
                    className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      activeTab === "settings"
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                    style={
                      activeTab !== "settings" ? { backgroundColor: "transparent" } : undefined
                    }
                    onMouseEnter={(e) => {
                      if (activeTab !== "settings")
                        e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== "settings")
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onClick={() => setActiveTab("settings")}
                  >
                    Settings
                  </button>
                )}
              </div>
              {gameMismatch && (
                <span className="text-[10px] text-red-600 truncate px-2">
                  Expected '{gameMismatch.expected}' but detected '{gameMismatch.detected}'
                </span>
              )}
              <div className="flex items-center gap-3">
                <button
                  className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer"
                  title="Open EchoLink"
                  onClick={() => {
                    setEchoLinkInput("");
                    setEchoLinkError(null);
                    setShowEchoLinkDialog(true);
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z" />
                  </svg>
                </button>
                {isInline && (
                  <button
                    className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer"
                    title="Pop out"
                    onClick={(e) => {
                      void requestExpandedMode(e.nativeEvent, "default");
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </button>
                )}
                <button
                  className="text-sm px-3 py-1 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
                  onClick={(e) => {
                    if (isInline) {
                      void handleWipe();
                    } else {
                      void handleWipe().then(() => exitExpandedMode(e.nativeEvent));
                    }
                  }}
                >
                  Exit
                </button>
              </div>
            </div>

            {activeTab === "wiki" && (
              <div
                ref={breadcrumbBarRef}
                className="absolute left-0 right-0 top-full flex items-center gap-1 px-4 py-1 text-xs border-b border-gray-100 overflow-visible"
                style={{
                  backgroundColor: "var(--bg)",
                  opacity: showBreadcrumb ? 1 : 0,
                  pointerEvents: showBreadcrumb ? "auto" : "none",
                  transition: "opacity 0.15s ease",
                  borderBottomColor: showBreadcrumb ? undefined : "transparent",
                }}
                onMouseEnter={cancelBreadcrumbHide}
                onMouseLeave={handleBreadcrumbBarLeave}
              >
                {wikiBreadcrumbs.map((crumb, i) => (
                  <Fragment key={crumb.page}>
                    {i > 0 && <span className="text-[var(--text-muted)] mx-0.5">&gt;</span>}
                    <button
                      className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                        i === wikiBreadcrumbs.length - 1
                          ? "font-medium text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                      onClick={() => setWikiCurrentPage(crumb.page)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleCopyEchoLink(`echolink://r/${subredditName}/wiki/${crumb.page}`);
                      }}
                    >
                      {crumb.label}
                    </button>
                    {crumb.siblings.length > 0 && (
                      <div className="relative">
                        <button
                          className="text-[var(--text-muted)] hover:text-[var(--text)] px-0.5 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenBreadcrumbDropdown(openBreadcrumbDropdown === i ? null : i);
                          }}
                        >
                          &#9662;
                        </button>
                        {openBreadcrumbDropdown === i && (
                          <div
                            className="absolute top-full left-0 z-50 mt-1 py-1 rounded-lg shadow-lg border border-gray-200 min-w-[140px]"
                            style={{ backgroundColor: "var(--bg)" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {crumb.siblings.map((sib) => {
                              const sibLabel = sib
                                .split("/")
                                .pop()!
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (c) => c.toUpperCase());
                              return (
                                <button
                                  key={sib}
                                  className="w-full text-left text-xs px-3 py-1.5 cursor-pointer text-[var(--text)]"
                                  style={{ backgroundColor: "transparent" }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.backgroundColor = "var(--thumb-bg)")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.backgroundColor = "transparent")
                                  }
                                  onClick={() => {
                                    setWikiCurrentPage(sib);
                                    setOpenBreadcrumbDropdown(null);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    handleCopyEchoLink(`echolink://r/${subredditName}/wiki/${sib}`);
                                  }}
                                >
                                  {sibLabel}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {mappingUpdateInfo && (
            <div className="flex items-center justify-between px-4 py-2 bg-green-50 border-b border-green-200 text-sm text-green-800">
              <span>{mappingUpdateInfo}</span>
              <button
                onClick={() => setMappingUpdateInfo(null)}
                className="ml-3 flex-shrink-0 text-green-600 hover:text-green-800 cursor-pointer"
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
          )}

          {activeTab === "wiki" && (
            <WikiView
              subredditName={subredditName}
              wikiFontSize={style.wikiFontSize}
              currentPage={wikiCurrentPage}
              onPageChange={setWikiCurrentPage}
              isMod={isMod}
              isExpanded={!isInline}
              username={username}
              onCopyEchoLink={handleCopyEchoLink}
              targetAnchor={wikiTargetAnchor}
              onAnchorConsumed={handleAnchorConsumed}
            />
          )}

          {activeTab === "assets" && (
            <>
              <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100">
                <FilterTabs
                  active={filter}
                  counts={counts}
                  onChange={(f) => {
                    setFilter(f);
                    setSubFilter(null);
                    setVisibleCount(PAGE_SIZE);
                  }}
                />
              </div>

              {subcategories.length > 1 && (
                <div className="px-4 py-1.5 border-b border-gray-50">
                  <SubFilterTabs
                    active={subFilter}
                    subcategories={subcategories}
                    onChange={(name) => {
                      setSubFilter(name);
                      setVisibleCount(PAGE_SIZE);
                    }}
                  />
                </div>
              )}

              <div
                className="flex-1 overflow-auto px-4 py-3"
                style={{ scrollbarGutter: "stable both-edges" }}
              >
                {filteredPaths.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <p className="text-sm">No assets in this category</p>
                  </div>
                ) : (
                  <>
                    <div className={`grid ${gridClass} gap-1`}>
                      {visiblePaths.map((p) => (
                        <AssetCard
                          key={p}
                          path={p}
                          mappedPath={pathToMapped.get(p)}
                          cardSize={style.cardSize}
                          onPreview={setPreviewPath}
                          onCopied={handleCopied}
                        />
                      ))}
                    </div>
                    {hasMore && (
                      <div className="flex justify-center py-4">
                        <button
                          className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)] text-white transition-opacity cursor-pointer hover:opacity-80"
                          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                        >
                          Load more
                          <span className="ml-1 opacity-70">
                            {(filteredPaths.length - visibleCount).toLocaleString()}
                          </span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === "settings" && isMod && config && (
            <SettingsView
              mappingText={mappingText}
              style={style}
              config={config}
              appearance={appearance}
              subredditName={subredditName}
              onMappingSaved={handleMappingSaved}
              onStyleChanged={handleStyleChanged}
              onConfigChanged={setConfig}
            />
          )}
        </>
      )}
    </div>
  );
};
