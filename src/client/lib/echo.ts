import { useEffect, useRef, useState } from 'react';
import { getAsset } from './idb';

export function parseEchoUrl(url: string): string | null {
  const match = /^echo:\/\/(.+)$/.exec(url);
  if (!match?.[1]) return null;
  return match[1].toLowerCase();
}

const blobUrlCache = new Map<string, string>();

let reverseMapping: Map<string, string> | null = null;

export function setReverseMapping(pathToMapped: Map<string, string> | null): void {
  if (!pathToMapped || pathToMapped.size === 0) {
    reverseMapping = null;
    return;
  }
  reverseMapping = new Map();
  for (const [original, mapped] of pathToMapped) {
    reverseMapping.set(mapped, original);
  }
}

export async function resolveEchoPath(path: string): Promise<string | null> {
  const normalized = path.toLowerCase();

  const cached = blobUrlCache.get(normalized);
  if (cached) return cached;

  let asset = await getAsset(normalized);

  if (!asset && reverseMapping) {
    const originalPath = reverseMapping.get(normalized);
    if (originalPath) {
      asset = await getAsset(originalPath);
    }
  }

  if (!asset) return null;

  const url = URL.createObjectURL(asset.blob);
  blobUrlCache.set(normalized, url);
  return url;
}

export function revokeAllBlobUrls(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}

export function useEchoUrl(echoPath: string | null): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!echoPath) {
      setUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void resolveEchoPath(echoPath).then((resolved) => {
      if (mountedRef.current) {
        setUrl(resolved);
        setLoading(false);
      }
    });
  }, [echoPath]);

  return { url, loading };
}
