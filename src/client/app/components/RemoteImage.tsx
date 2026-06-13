import { useEffect, useRef, useState, type CSSProperties } from "react";
import { proxiedImageUrl } from "../assetUtils";

// Remote http(s) images can't be loaded by a bare `<img src>` in the Reddit
// webview. A browser-issued request to `/api/image-proxy` is sent WITHOUT the
// auth Devvit injects only into JS `fetch`, so the platform gateway answers 401.
// Instead we `fetch` the proxied bytes (authorized), turn the response into a
// blob object URL, and point the <img> at that: the same blob-URL strategy the
// echo:// asset pipeline uses (see lib/echo.ts).

// Session cache: a given remote src resolves to one blob URL we keep alive for
// the session (mirrors echo's blobUrlCache) so re-renders don't refetch/flicker.
const remoteBlobCache = new Map<string, string>();
const remoteInflight = new Map<string, Promise<string | null>>();

async function loadRemoteImage(src: string): Promise<string | null> {
  const cached = remoteBlobCache.get(src);
  if (cached) return cached;

  let pending = remoteInflight.get(src);
  if (!pending) {
    pending = (async (): Promise<string | null> => {
      try {
        const res = await fetch(proxiedImageUrl(src));
        if (!res.ok) return null;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        remoteBlobCache.set(src, url);
        return url;
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
  const [url, setUrl] = useState<string | null>(
    () => remoteBlobCache.get(src) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const cached = remoteBlobCache.get(src);
    if (cached) {
      setUrl(cached);
      setFailed(false);
      return;
    }
    setUrl(null);
    setFailed(false);
    void loadRemoteImage(src).then((resolved) => {
      if (!mountedRef.current) return;
      if (resolved) setUrl(resolved);
      else setFailed(true);
    });
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
  return <img src={url} alt={alt} style={style} className={className} />;
}
