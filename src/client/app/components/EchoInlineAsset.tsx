import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useEchoUrl } from "../../lib/echo";
import { parseEditions } from "../../lib/editions";
import { getAudioEditionParamsForPath } from "../../lib/echo";
import { getFileName, isImagePath, isAudioPath } from "../assetUtils";

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
