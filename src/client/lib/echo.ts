import { useEffect, useRef, useState } from "react";
import { getAsset } from "./idb";
import {
  parseEditions,
  applyImageEditions,
  getAudioEditionParams as computeAudioEditionParams,
  getEditionBlobUrl,
  setEditionBlobUrl,
  revokeAllEditionBlobUrls,
  type AudioEditionParams,
} from "./editions";

export function parseEchoUrl(url: string): string | null {
  const match = /^echo:\/\/(.+)$/.exec(url);
  if (!match?.[1]) return null;
  return match[1].toLowerCase();
}

const blobUrlCache = new Map<string, string>();
const audioEditionParamsCache = new Map<string, AudioEditionParams>();

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

function isImagePath(p: string): boolean {
  return /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(p);
}

function isAudioPath(p: string): boolean {
  return /\.(ogg|mp3|m4a|wav|mid|midi)$/i.test(p);
}

async function resolveBaseAsset(normalized: string): Promise<Blob | null> {
  let asset = await getAsset(normalized);
  if (!asset && reverseMapping) {
    const originalPath = reverseMapping.get(normalized);
    if (originalPath) {
      asset = await getAsset(originalPath);
    }
  }
  return asset?.blob ?? null;
}

export async function resolveEchoPath(path: string): Promise<string | null> {
  const normalized = path.toLowerCase();
  const { basePath, editions } = parseEditions(normalized);

  if (editions.length === 0) {
    const cached = blobUrlCache.get(normalized);
    if (cached) return cached;

    const blob = await resolveBaseAsset(normalized);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    blobUrlCache.set(normalized, url);
    return url;
  }

  const editionCached = getEditionBlobUrl(normalized);
  if (editionCached) return editionCached;

  const blob = await resolveBaseAsset(basePath);
  if (!blob) return null;

  if (isImagePath(basePath)) {
    const editedBlob = await applyImageEditions(blob, editions);
    const url = URL.createObjectURL(editedBlob);
    setEditionBlobUrl(normalized, url);
    return url;
  }

  if (isAudioPath(basePath)) {
    const params = computeAudioEditionParams(editions);
    const baseUrl = blobUrlCache.get(basePath) ?? URL.createObjectURL(blob);
    if (!blobUrlCache.has(basePath)) {
      blobUrlCache.set(basePath, baseUrl);
    }
    audioEditionParamsCache.set(normalized, params);
    setEditionBlobUrl(normalized, baseUrl);
    return baseUrl;
  }

  const url = URL.createObjectURL(blob);
  setEditionBlobUrl(normalized, url);
  return url;
}

export function getAudioEditionParamsForPath(echoPath: string): AudioEditionParams | null {
  return audioEditionParamsCache.get(echoPath.toLowerCase()) ?? null;
}

export function revokeAllBlobUrls(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
  revokeAllEditionBlobUrls();
  audioEditionParamsCache.clear();
}

export async function preloadPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => resolveEchoPath(p)));
}

export function useEchoUrl(echoPath: string | null): {
  url: string | null;
  loading: boolean;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(echoPath !== null);
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
