import { useLayoutEffect, useState, type CSSProperties } from "react";
import { proxiedImageUrl } from "../assetUtils";

// Remote http(s) images can't be loaded by a bare `<img src>` in the Reddit
// webview. A browser-issued request to `/api/image-proxy` is sent WITHOUT the
// auth Devvit injects only into JS `fetch`, so the platform gateway answers 401.
// Instead we `fetch` the proxied bytes (authorized), turn the response into a
// blob object URL, and point the <img> at that: the same blob-URL strategy the
// echo:// asset pipeline uses (see lib/echo.ts).

// Session cache: a given remote src resolves to one decoded Blob we keep alive
// for the session so re-renders don't refetch. We deliberately cache the Blob
// (not an object URL): the side-by-side vote preview mounts the same image in
// both panes, and a single shared `blob:` URL handed to two concurrently-loading
// <img> elements fails to render in the Reddit webview (the second one falls back
// to its alt text). Each RemoteImage instance instead mints: and owns its own
// object URL from the shared Blob, so the panes never contend over one URL.
const remoteBlobCache = new Map<string, Blob>();
const remoteInflight = new Map<string, Promise<Blob | null>>();

async function loadRemoteBlob(src: string): Promise<Blob | null> {
  const cached = remoteBlobCache.get(src);
  if (cached) return cached;

  let pending = remoteInflight.get(src);
  if (!pending) {
    pending = (async (): Promise<Blob | null> => {
      try {
        const res = await fetch(proxiedImageUrl(src));
        if (!res.ok) return null;
        const blob = await res.blob();
        remoteBlobCache.set(src, blob);
        return blob;
      } catch {
        return null;
      } finally {
        remoteInflight.delete(src);
      }
    })();
    remoteInflight.set(src, pending);
  }
  return pending;
}

// Inline placeholder shown when a remote image can't be fetched (host not
// allowlisted, upstream error, non-image, too large). Keeps the alt text
// visible so the page still conveys what was meant to be there.
function BrokenRemoteImage({
  alt,
  className,
}: {
  alt: string;
  className?: string | undefined;
}) {
  return (
    <span
      className={`not-prose inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 align-middle text-xs ${className ?? ""}`}
      style={{
        borderColor: "var(--text-muted)",
        color: "var(--text-muted)",
        background: "var(--thumb-bg)",
      }}
      title="This remote image could not be loaded."
    >
      <svg
        className="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="m3 16 5-5 4 4" />
        <path d="m21 21-6-6" />
        <path d="M21 3 3 21" />
      </svg>
      {alt || "image unavailable"}
    </span>
  );
}

export function RemoteImage({
  src,
  alt,
  style,
  className,
}: {
  src: string;
  alt: string | undefined;
  style?: CSSProperties | undefined;
  className?: string | undefined;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Mint a fresh object URL from the (cached) Blob for THIS instance and revoke
  // it on unmount / src change, so each <img> owns an independent URL. See the
  // remoteBlobCache note above for why the URL isn't shared across instances.
  //
  // Runs as a layout effect (pre-paint) so that when the Blob is ALREADY in the
  // session cache: e.g. this image is being remounted because typing in the
  // editor re-rendered the markdown preview: the URL is set before the browser
  // paints, and the spinner never shows for a frame. That one-frame spinner was
  // the visible "flash" while typing. A genuine cache miss still falls back to
  // the async fetch (and shows the spinner once, as intended).
  useLayoutEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const cached = remoteBlobCache.get(src);
    if (cached) {
      objectUrl = URL.createObjectURL(cached);
      setUrl(objectUrl);
      setFailed(false);
    } else {
      setUrl(null);
      setFailed(false);
      void loadRemoteBlob(src).then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return <BrokenRemoteImage alt={alt ?? ""} className={className} />;
  }
  if (!url) {
    // Loading: a minimal same-line spinner so layout doesn't jump.
    return (
      <span
        className="not-prose inline-flex h-5 w-5 items-center justify-center align-middle"
        aria-label="Loading image"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      style={style}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
