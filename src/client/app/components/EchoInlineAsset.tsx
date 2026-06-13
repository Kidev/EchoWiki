import {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useEchoUrl } from "../../lib/echo";
import { parseEditions } from "../../lib/editions";
import { getAudioEditionParamsForPath } from "../../lib/echo";
import { getFileName, isImagePath, isAudioPath } from "../assetUtils";
import { AssetBypassContext } from "../assetBypass";
import { highlightEchoCode } from "../wikiHighlight";

// When assets are bypassed, an echo reference renders as its source: the same
// `echo://...` text, highlighted exactly like a ```echo``` fenced block. This keeps
// the preview deterministic (no async image decode that would shift a
// scroll-locked diff pane) and keeps the reference readable.
function EchoSourceRef({ reference }: { reference: string }) {
  return (
    <code
      className="echo-asset-source not-prose inline-block max-w-full overflow-x-auto align-middle rounded px-1.5 py-0.5 text-xs font-mono"
      style={{
        background: "var(--thumb-bg)",
        border: "1px solid var(--text-muted)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
      title="Viewing without imported assets: showing the echo:// source"
      dangerouslySetInnerHTML={{ __html: highlightEchoCode(reference) }}
    />
  );
}

// A neutral grey "image" thumbnail used in place of the raw <img> emitted by
// :::scene/:::anim/:::fbf blocks when assets are bypassed. Kept as an <img> with
// a fixed intrinsic ratio so the surrounding block still reserves a sensible box
// (and EchoSceneFrame's natural-width measurement still resolves).
const RAW_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#d1d5db"/><g fill="none" stroke="#9ca3af" stroke-width="4"><rect x="110" y="55" width="100" height="70" rx="6"/><circle cx="140" cy="82" r="9"/><path d="M118 120l28-24 20 14 24-20 22 26"/></g></svg>`;
const RAW_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  RAW_PLACEHOLDER_SVG,
)}`;

// Renders an image with a same-size spinner overlay until the image has decoded.
// This prevents layout reflow: the <img> element reserves its final space immediately
// (once the blob URL is available), and the spinner sits on top until onLoad fires.
function EchoInlineImageLoader({
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
  const [decoded, setDecoded] = useState(false);

  return (
    <span
      className="inline-block relative"
      title={!decoded ? "Loading asset..." : undefined}
      style={{ verticalAlign: "middle" }}
    >
      {/* The img is always in the DOM so the browser computes the final layout size.
          visibility:hidden keeps it invisible until decoded; the element still takes up space. */}
      <img
        src={url}
        alt={alt}
        style={{ ...style, visibility: decoded ? "visible" : "hidden" }}
        className={`echo-inline inline-block max-w-full rounded${extraClass ? ` ${extraClass}` : ""}`}
        onLoad={() => setDecoded(true)}
      />
      {!decoded && (
        <span className="absolute inset-0 flex items-center justify-center rounded bg-gray-100/60 min-w-[2rem] min-h-[1.5rem]">
          <span className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </span>
      )}
    </span>
  );
}

// Renders a bare <img> for echo paths embedded inside raw-HTML echo blocks
// (:::scene, :::fbf, :::anim). These images carry their own absolute-position /
// animation inline styles and MUST NOT be wrapped in an extra positioning span,
// otherwise the layout context that their `inset:0` / `width:100%` rely on is lost.
// The element stays mounted with no src until the blob URL resolves, so it slots
// into the surrounding layout exactly as the block renderer intended.
export function EchoRawImage({
  path,
  alt,
  style,
  className,
}: {
  path: string;
  alt?: string | undefined;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}) {
  const bypass = useContext(AssetBypassContext);
  const { url } = useEchoUrl(bypass ? null : path);
  return (
    <img
      src={bypass ? RAW_PLACEHOLDER : (url ?? undefined)}
      alt={alt ?? getFileName(parseEditions(path).basePath)}
      style={style}
      className={className}
    />
  );
}

// Wraps a :::scene block that has BOTH a background and a foreground. The block
// renderer grid-stacks the two images and sizes them via the `--echo-bg-w` /
// `--echo-fg-w` CSS variables (defaulting to 100%). Here we measure the decoded
// natural widths and resolve those variables so the box tracks the LARGER image
// (it stays 100%) while the smaller one is scaled by the same factor: keeping
// their top-left corners aligned. Widths stay percentages, so the result remains
// responsive without re-measuring on resize.
export function EchoSceneFrame({
  style,
  className,
  children,
}: {
  style?: CSSProperties | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bg = el.querySelector<HTMLImageElement>("img.echo-scene-bg");
    const fg = el.querySelector<HTMLImageElement>("img.echo-scene-fg");
    if (!bg || !fg) return;

    const apply = () => {
      const bw = bg.naturalWidth;
      const fw = fg.naturalWidth;
      if (!bw || !fw) return;
      const max = Math.max(bw, fw);
      el.style.setProperty("--echo-bg-w", `${((bw / max) * 100).toFixed(4)}%`);
      el.style.setProperty("--echo-fg-w", `${((fw / max) * 100).toFixed(4)}%`);
    };

    apply();
    bg.addEventListener("load", apply);
    fg.addEventListener("load", apply);
    return () => {
      bg.removeEventListener("load", apply);
      fg.removeEventListener("load", apply);
    };
  }, [children]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

export function EchoInlineImage({
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

export function EchoInlineAsset({
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
  const bypass = useContext(AssetBypassContext);
  const { basePath } = parseEditions(path);
  const name = getFileName(basePath);
  const { url, loading } = useEchoUrl(bypass ? null : path);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioParams = getAudioEditionParamsForPath(path);

  useEffect(() => {
    if (audioRef.current && audioParams && audioParams.playbackRate !== 1) {
      audioRef.current.playbackRate = audioParams.playbackRate;
      audioRef.current.preservesPitch = false;
    }
  }, [url, audioParams]);

  // Assets bypassed: render the echo:// source instead of resolving it against
  // IDB, so the reference stays visible and the layout stays stable.
  if (bypass) {
    return <EchoSourceRef reference={`echo://${path}`} />;
  }

  // Phase 1: IDB read in progress: show spinner badge
  if (loading) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-[var(--text-muted)] text-xs"
        title="Loading asset..."
      >
        <span className="w-3 h-3 border border-gray-300 border-t-gray-600 rounded-full animate-spin inline-block" />
        {children}
      </span>
    );
  }

  // Phase 2+3: URL ready: use EchoInlineImageLoader to prevent reflow during image decode
  if (isImagePath(basePath) && url) {
    return (
      <EchoInlineImageLoader
        url={url}
        alt={name}
        style={style}
        className={className}
      />
    );
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
