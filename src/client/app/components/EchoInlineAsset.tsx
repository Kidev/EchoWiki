import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEchoUrl } from "../../lib/echo";
import { parseEditions } from "../../lib/editions";
import { getAudioEditionParamsForPath } from "../../lib/echo";
import { getFileName, isImagePath, isAudioPath } from "../assetUtils";

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
  const { url } = useEchoUrl(path);
  return (
    <img
      src={url ?? undefined}
      alt={alt ?? getFileName(parseEditions(path).basePath)}
      style={style}
      className={className}
    />
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
    return <EchoInlineImageLoader url={url} alt={name} style={style} className={className} />;
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
