import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getWebViewMode, requestExpandedMode, navigateTo } from '@devvit/web/client';
import type {
  CardSize,
  ColorTheme,
  FontFamily,
  InitResponse,
  GameConfig,
  MappingResponse,
  StyleConfig,
  StyleResponse,
  WikiFontSize,
  WikiResponse,
  WikiPagesResponse,
} from '../../shared/types/api';
import { hasAssets, getMeta, wipeAll, listAssetPaths, applyMapping } from '../lib/idb';
import { importGameFiles } from '../lib/decrypt/index';
import type { ImportProgress } from '../lib/decrypt/index';
import { revokeAllBlobUrls, useEchoUrl, setReverseMapping, preloadPaths } from '../lib/echo';
import type { EchoMeta } from '../lib/idb';

type AppState = 'loading' | 'no-assets' | 'importing' | 'ready';

type ActiveTab = 'wiki' | 'assets' | 'settings';

type FilterType = 'images' | 'audio';

const PAGE_SIZE = 60;

const DEFAULT_STYLE: StyleConfig = {
  cardSize: 'normal',
  wikiFontSize: 'normal',
  fontFamily: 'system',
  light: {
    accentColor: '#d93900',
    bgColor: '#ffffff',
    textColor: '#111827',
    textMuted: '#6b7280',
    thumbBgColor: '#e5e7eb',
    controlBgColor: '#ffffff',
    controlTextColor: '#111827',
  },
  dark: {
    accentColor: '#ff6b3d',
    bgColor: '#1a1a1b',
    textColor: '#d7dadc',
    textMuted: '#818384',
    thumbBgColor: '#343536',
    controlBgColor: '#343536',
    controlTextColor: '#d7dadc',
  },
};

const ACCENT_PRESETS = ['#d93900', '#2563eb', '#16a34a', '#7c3aed', '#db2777', '#0d9488'] as const;

const BG_PRESETS = ['#ffffff', '#f9fafb', '#1f2937', '#111827'] as const;

const TEXT_PRESETS = ['#111827', '#1f2937', '#f9fafb', '#ffffff'] as const;

const MUTED_PRESETS = ['#6b7280', '#9ca3af', '#4b5563', '#d1d5db'] as const;

const THUMB_BG_PRESETS = ['#e5e7eb', '#d1d5db', '#f3f4f6', '#1f2937'] as const;

const DARK_BG_PRESETS = ['#1a1a1b', '#111827', '#1f2937', '#0f172a'] as const;

const DARK_TEXT_PRESETS = ['#d7dadc', '#f9fafb', '#e5e7eb', '#ffffff'] as const;

const DARK_THUMB_BG_PRESETS = ['#343536', '#374151', '#1f2937', '#4b5563'] as const;

const CONTROL_BG_PRESETS = ['#ffffff', '#f9fafb', '#f3f4f6', '#e5e7eb'] as const;

const CONTROL_TEXT_PRESETS = ['#111827', '#1f2937', '#374151', '#4b5563'] as const;

const DARK_CONTROL_BG_PRESETS = ['#343536', '#374151', '#1f2937', '#4b5563'] as const;

const DARK_CONTROL_TEXT_PRESETS = ['#d7dadc', '#e5e7eb', '#f9fafb', '#ffffff'] as const;

const PRE_IMPORT_VARS: CSSProperties = {
  '--accent': '#6a5cff',
  '--accent-hover': '#5a4ee6',
  '--accent-ring': 'rgba(106, 92, 255, 0.2)',
  '--bg': '#1a1a2e',
  '--text': '#ffffff',
  '--text-muted': '#677db7',
  '--thumb-bg': '#16213e',
  '--control-bg': '#16213e',
  '--control-text': '#ffffff',
} as CSSProperties;

const FONT_MAP: Record<FontFamily, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
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
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function getStem(p: string): string {
  const fileName = getFileName(p);
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function getExt(p: string): string {
  const fileName = getFileName(p);
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot) : '';
}

function getCategory(p: string): 'images' | 'audio' | 'data' {
  if (isImagePath(p)) return 'images';
  if (isAudioPath(p)) return 'audio';
  return 'data';
}

function getSubfolder(p: string): string | null {
  const parts = p.split('/');
  if (parts.length < 2) return null;
  const folder = parts[parts.length - 2];
  return folder && folder.length > 0 ? folder : null;
}

function naturalSortKey(p: string, pathToMapped: Map<string, string>): string {
  const mapped = pathToMapped.get(p);
  return getFileName(mapped ?? p).toLowerCase();
}

function getFirstVisibleImagePaths(allPaths: string[]): string[] {
  const images = allPaths.filter(isImagePath);
  const folderCounts = new Map<string, number>();
  for (const p of images) {
    const folder = getSubfolder(p);
    if (folder) folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  const firstFolder =
    [...folderCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([name]) => name)[0] ?? null;
  const filtered = firstFolder ? images.filter((p) => getSubfolder(p) === firstFolder) : images;
  const empty = new Map<string, string>();
  return [...filtered]
    .sort((a, b) =>
      naturalSortKey(a, empty).localeCompare(naturalSortKey(b, empty), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    )
    .slice(0, PAGE_SIZE);
}

function toDisplayName(path: string): string {
  const stem = getStem(path);
  const ext = getExt(path);
  return stem.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + ext;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractWikiPage(href: string, subredditName: string): string | null {
  const sub = subredditName.toLowerCase();

  try {
    const url = new URL(href, 'https://www.reddit.com');
    if (
      url.hostname === 'www.reddit.com' ||
      url.hostname === 'reddit.com' ||
      url.hostname === 'old.reddit.com' ||
      url.hostname === 'new.reddit.com'
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

function formatPageName(page: string): string {
  const parts = page.split('/');
  const prefix = parts.slice(0, -1).join(' > ');
  const last = parts[parts.length - 1] ?? page;
  const display = last.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return prefix ? `${prefix} > ${display}` : display;
}

function EchoInlineAsset({ path, children }: { path: string; children: ReactNode }) {
  const { url, loading } = useEchoUrl(path);
  const name = getFileName(path);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-[var(--text-muted)] text-xs">
        <span className="w-3 h-3 border border-gray-300 border-t-gray-600 rounded-full animate-spin inline-block" />
        {children}
      </span>
    );
  }

  if (isImagePath(path) && url) {
    return (
      <img src={url} alt={name} className="inline-block max-w-full rounded my-1" loading="lazy" />
    );
  }

  if (isAudioPath(path) && url) {
    return (
      <span className="inline-flex flex-col gap-1 my-1">
        <span className="text-xs text-[var(--text-muted)]">{children}</span>
        <audio controls src={url} className="max-w-xs h-8" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-[var(--text-muted)] text-xs">
      {children}
    </span>
  );
}

function AudioPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return;

    const audioCtx = new AudioContext();
    ctxRef.current = audioCtx;
    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const canvasCtx = canvas.getContext('2d')!;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = '#1f2937';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i]! / 255) * canvas.height;
        const hue = (i / bufferLength) * 30;
        canvasCtx.fillStyle = `hsl(${hue}, 80%, 50%)`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      void audioCtx.close();
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-sm">
      <canvas ref={canvasRef} width={320} height={100} className="w-full rounded bg-gray-800" />
      <audio ref={audioRef} controls src={url} className="w-full" />
    </div>
  );
}

function AssetPreview({
  path,
  mappedPath,
  onClose,
  onCopied,
}: {
  path: string;
  mappedPath: string | undefined;
  onClose: () => void;
  onCopied: (path: string) => void;
}) {
  const category = getCategory(path);
  const { url, loading } = useEchoUrl(path);
  const displayName = toDisplayName(mappedPath ?? path);
  const echoPath = mappedPath ?? path;
  const [hovered, setHovered] = useState(false);

  const echoMarkdown = isImagePath(path)
    ? `![${displayName}](echo://${echoPath})`
    : `[${displayName}](echo://${echoPath})`;

  const originalMarkdown = isImagePath(path)
    ? `![${toDisplayName(path)}](echo://${path})`
    : `[${toDisplayName(path)}](echo://${path})`;

  const handleCopy = useCallback(
    (e?: ReactMouseEvent) => {
      const text = e && (e.ctrlKey || e.metaKey) ? originalMarkdown : echoMarkdown;
      void navigator.clipboard.writeText(text).then(() => onCopied(path));
    },
    [echoMarkdown, originalMarkdown, onCopied, path]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          handleCopy();
        }}
      >
        <button
          onClick={handleCopy}
          className={`absolute top-2 right-2 z-10 p-2 rounded-lg bg-black/50 text-white transition-opacity cursor-pointer ${hovered ? 'opacity-100' : 'opacity-0'}`}
          title="Copy echo link (Ctrl+click for original name)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>

        {loading ? (
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : category === 'images' && url ? (
          <div
            className="rounded border border-white/20 p-1"
            style={{ backgroundColor: 'var(--thumb-bg)' }}
          >
            <img
              src={url}
              alt={displayName}
              className="max-w-full max-h-[80vh] object-contain rounded"
            />
          </div>
        ) : category === 'audio' && url ? (
          <AudioPreview url={url} />
        ) : (
          <div className="flex items-center justify-center w-32 h-32 rounded bg-gray-800 text-gray-400 text-sm">
            No preview
          </div>
        )}

        <span className="text-white text-sm bg-black/40 px-3 py-1 rounded">{displayName}</span>
      </div>
    </div>
  );
}

function WikiView({
  subredditName,
  wikiFontSize,
}: {
  subredditName: string;
  wikiFontSize: WikiFontSize;
}) {
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState('index');
  const wikiContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [wikiRes, pagesRes] = await Promise.all([
          fetch('/api/wiki'),
          fetch('/api/wiki/pages'),
        ]);
        if (wikiRes.ok) {
          const data: WikiResponse = await wikiRes.json();
          setContent(data.content);
        } else {
          setContent(null);
        }
        if (pagesRes.ok) {
          const data: WikiPagesResponse = await pagesRes.json();
          setPages(data.pages);
        }
      } catch {
        setContent(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handlePageChange = useCallback(async (page: string) => {
    setCurrentPage(page);
    setLoading(true);
    try {
      const res = await fetch(`/api/wiki?page=${encodeURIComponent(page)}`);
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
  }, []);

  const handleLinkClick = useCallback(() => {
    navigateTo({ url: `https://www.reddit.com/r/${subredditName}/wiki/${currentPage}` });
  }, [subredditName, currentPage]);

  const proseSize =
    wikiFontSize === 'small' ? 'prose-sm' : wikiFontSize === 'large' ? 'prose-lg' : '';

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (content === null || content === undefined) {
    return (
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
    );
  }

  return (
    <div ref={wikiContainerRef} className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        {pages.length > 1 ? (
          <select
            value={currentPage}
            onChange={(e) => void handlePageChange(e.target.value)}
            className="text-sm px-2 py-1 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
            style={{ backgroundColor: 'var(--control-bg)', color: 'var(--control-text)' }}
          >
            {pages.map((p) => (
              <option key={p} value={p}>
                {formatPageName(p)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-medium">{formatPageName(currentPage)}</span>
        )}
        <button
          onClick={handleLinkClick}
          className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer"
          title="Open wiki page in browser"
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
      </div>

      <div
        className={`prose ${proseSize} max-w-none`}
        style={
          {
            '--tw-prose-body': 'var(--text)',
            '--tw-prose-headings': 'var(--text)',
            '--tw-prose-bold': 'var(--text)',
            '--tw-prose-links': 'var(--accent)',
            '--tw-prose-quotes': 'var(--text-muted)',
            '--tw-prose-quote-borders': 'var(--accent)',
            '--tw-prose-code': 'var(--text)',
            '--tw-prose-counters': 'var(--text-muted)',
            '--tw-prose-bullets': 'var(--text-muted)',
            '--tw-prose-hr': 'var(--text-muted)',
            '--tw-prose-th-borders': 'var(--text-muted)',
            '--tw-prose-td-borders': 'var(--text-muted)',
          } as CSSProperties
        }
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => (url.startsWith('echo://') ? url : defaultUrlTransform(url))}
          components={{
            h1: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === 'string' ? c : '';
              return <h1 id={slugify(text)}>{c}</h1>;
            },
            h2: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === 'string' ? c : '';
              return <h2 id={slugify(text)}>{c}</h2>;
            },
            h3: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === 'string' ? c : '';
              return <h3 id={slugify(text)}>{c}</h3>;
            },
            h4: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === 'string' ? c : '';
              return <h4 id={slugify(text)}>{c}</h4>;
            },
            h5: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === 'string' ? c : '';
              return <h5 id={slugify(text)}>{c}</h5>;
            },
            h6: ({ children: c }: { children?: ReactNode }) => {
              const text = typeof c === 'string' ? c : '';
              return <h6 id={slugify(text)}>{c}</h6>;
            },
            img: ({ src, alt }: { src?: string | undefined; alt?: string | undefined }) => {
              if (src?.startsWith('echo://')) {
                const echoPath = src.slice('echo://'.length).toLowerCase();
                return (
                  <EchoInlineAsset path={echoPath}>{alt ?? getFileName(echoPath)}</EchoInlineAsset>
                );
              }
              return <img src={src} alt={alt} />;
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

              if (href.startsWith('echo://')) {
                const echoPath = href.slice('echo://'.length).toLowerCase();
                return <EchoInlineAsset path={echoPath}>{linkChildren}</EchoInlineAsset>;
              }

              const wikiPage = extractWikiPage(href, subredditName);
              if (wikiPage !== null) {
                return (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      void handlePageChange(wikiPage);
                    }}
                    className="text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {linkChildren}
                  </a>
                );
              }

              if (href.startsWith('#')) {
                return (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      const id = href.slice(1);
                      const target =
                        wikiContainerRef.current?.querySelector(`[id="${CSS.escape(id)}"]`) ??
                        wikiContainerRef.current?.querySelector(
                          `[id="${CSS.escape(id.toLowerCase())}"]`
                        );
                      if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    className="text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {linkChildren}
                  </a>
                );
              }

              const externalUrl =
                href.startsWith('http://') || href.startsWith('https://')
                  ? href
                  : `https://www.reddit.com${href.startsWith('/') ? href : `/${href}`}`;
              return (
                <a
                  href={externalUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    try {
                      navigateTo({ url: externalUrl });
                    } catch {
                      window.open(externalUrl, '_blank');
                    }
                  }}
                  className="text-[var(--accent)] hover:underline cursor-pointer"
                >
                  {linkChildren}
                </a>
              );
            },
          }}
        >
          {content}
        </Markdown>
      </div>
    </div>
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
  const { url, loading } = useEchoUrl(category === 'images' ? path : null);
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
    [echoMarkdown, originalMarkdown, onCopied, path]
  );

  const thumbClass =
    cardSize === 'compact' ? 'w-12 h-12' : cardSize === 'large' ? 'w-24 h-24' : 'w-16 h-16';
  const labelClass =
    cardSize === 'compact' ? 'text-[9px]' : cardSize === 'large' ? 'text-[11px]' : 'text-[10px]';
  const copyIconClass =
    cardSize === 'compact' ? 'w-2.5 h-2.5' : cardSize === 'large' ? 'w-3.5 h-3.5' : 'w-3 h-3';

  return (
    <div
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer overflow-hidden"
      onClick={handleClick}
      title={echoMarkdown}
    >
      <div
        className={`${thumbClass} rounded border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0`}
        style={{
          backgroundColor: category === 'data' ? '#f9fafb' : 'var(--thumb-bg)',
        }}
      >
        {category === 'images' ? (
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
        ) : category === 'audio' ? (
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
        <span className="text-[var(--text-muted)] truncate flex-1 leading-tight">
          {displayName}
        </span>
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

const FILTERS: readonly FilterType[] = ['images', 'audio'] as const;

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
            active === f
              ? 'bg-[var(--accent)] text-white'
              : 'bg-gray-100 text-[var(--text-muted)] hover:bg-gray-200'
          }`}
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
            active === s.name
              ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
              : 'bg-gray-50 text-[var(--text-muted)] hover:bg-gray-100'
          }`}
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
            value === opt.value
              ? 'bg-[var(--accent)] text-white'
              : 'bg-white text-[var(--text-muted)] hover:bg-gray-50'
          }`}
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
  presets,
  onSelect,
}: {
  label: string;
  value: string;
  presets: readonly string[];
  onSelect: (color: string) => void;
}) {
  const [customHex, setCustomHex] = useState(presets.includes(value) ? '' : value);

  const handleCustom = useCallback(
    (hex: string) => {
      setCustomHex(hex);
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        onSelect(hex);
      }
    },
    [onSelect]
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {presets.map((color) => (
          <button
            key={color}
            className={`w-7 h-7 rounded-full cursor-pointer transition-shadow border border-gray-200 ${
              value === color && !customHex
                ? 'ring-2 ring-offset-2 ring-gray-400'
                : 'hover:ring-2 hover:ring-offset-1 hover:ring-gray-300'
            }`}
            style={{ backgroundColor: color }}
            onClick={() => {
              setCustomHex('');
              onSelect(color);
            }}
            title={color}
          />
        ))}
        <input
          type="text"
          placeholder="#hex"
          value={customHex}
          onChange={(e) => handleCustom(e.target.value)}
          maxLength={7}
          className="w-20 text-xs font-mono px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
        />
      </div>
    </div>
  );
}

function parseMappingText(text: string): Array<[string, string]> {
  const cleaned = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const pairRegex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  const results: Array<[string, string]> = [];
  let match;
  while ((match = pairRegex.exec(cleaned)) !== null) {
    results.push([match[1]!.toLowerCase(), match[2]!.toLowerCase()]);
  }
  return results;
}

type SettingsTab = 'general' | 'style' | 'mapping';

function SettingsView({
  mappingText,
  style,
  config,
  onMappingSaved,
  onStyleChanged,
  onConfigChanged,
}: {
  mappingText: string;
  style: StyleConfig;
  config: GameConfig;
  onMappingSaved: (text: string, mapping: Record<string, string> | null) => void;
  onStyleChanged: (style: StyleConfig) => void;
  onConfigChanged: (config: GameConfig) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [text, setText] = useState(mappingText);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [editingMode, setEditingMode] = useState<'light' | 'dark'>('light');
  const [gameTitle, setGameTitle] = useState(config.gameName);
  const [storeLink, setStoreLink] = useState(config.storeLink);
  const [savingConfig, setSavingConfig] = useState(false);

  const editingColors = editingMode === 'light' ? style.light : style.dark;

  const parsedEntries = useMemo(() => parseMappingText(text), [text]);

  const configDirty = gameTitle !== config.gameName || storeLink !== config.storeLink;

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: gameTitle, storeLink }),
      });
      if (res.ok) {
        const data = (await res.json()) as { config: GameConfig };
        onConfigChanged(data.config);
      }
    } catch {
    } finally {
      setSavingConfig(false);
    }
  }, [gameTitle, storeLink, onConfigChanged]);

  const handleSaveMapping = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const entries = parseMappingText(text);
      const res = await fetch('/api/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, entries: entries.length > 0 ? entries : undefined }),
      });
      if (res.ok) {
        const data: MappingResponse = await res.json();
        onMappingSaved(data.text, data.mapping);
        setStatus({ ok: true, message: 'Mapping saved' });
      } else {
        const err = await res.json();
        setStatus({
          ok: false,
          message: (err as { message?: string }).message ?? 'Save failed',
        });
      }
    } catch {
      setStatus({ ok: false, message: 'Network error' });
    } finally {
      setSaving(false);
    }
  }, [text, onMappingSaved]);

  const saveStyle = useCallback(
    async (update: Record<string, string>) => {
      try {
        const res = await fetch('/api/style', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
        });
        if (res.ok) {
          const data: StyleResponse = await res.json();
          onStyleChanged(data.style);
        }
      } catch {}
    },
    [onStyleChanged]
  );

  const saveColor = useCallback(
    (field: string, value: string) => {
      void saveStyle({ mode: editingMode, [field]: value });
    },
    [saveStyle, editingMode]
  );

  const SETTINGS_TABS: readonly { value: SettingsTab; label: string }[] = [
    { value: 'general', label: 'General' },
    { value: 'style', label: 'Style' },
    { value: 'mapping', label: 'Mapping' },
  ] as const;

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-gray-200">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.value}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
              settingsTab === tab.value
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:bg-gray-100'
            }`}
            onClick={() => setSettingsTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 max-w-lg">
        {settingsTab === 'general' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Game Title</span>
              <input
                type="text"
                value={gameTitle}
                onChange={(e) => setGameTitle(e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                style={{ backgroundColor: 'var(--control-bg)', color: 'var(--control-text)' }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                Shown to users on import. Warns if imported game doesn't match.
              </span>
            </div>

            {gameTitle.trim() && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium">Store Link</span>
                <input
                  type="text"
                  value={storeLink}
                  onChange={(e) => setStoreLink(e.target.value)}
                  placeholder="https://store.steampowered.com/app/..."
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                  style={{ backgroundColor: 'var(--control-bg)', color: 'var(--control-text)' }}
                />
                <span className="text-[10px] text-[var(--text-muted)]">
                  If set, a purchase link is shown on the import screen.
                </span>
              </div>
            )}

            <button
              onClick={() => void handleSaveConfig()}
              disabled={savingConfig || !configDirty}
              className="self-start text-sm px-4 py-1.5 rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingConfig ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {settingsTab === 'style' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Font</span>
              <SegmentedControl
                value={style.fontFamily}
                options={[
                  { value: 'system' as FontFamily, label: 'System' },
                  { value: 'serif' as FontFamily, label: 'Serif' },
                  { value: 'mono' as FontFamily, label: 'Mono' },
                ]}
                onChange={(v) => void saveStyle({ fontFamily: v })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Card Size</span>
              <SegmentedControl
                value={style.cardSize}
                options={[
                  { value: 'compact' as CardSize, label: 'Compact' },
                  { value: 'normal' as CardSize, label: 'Normal' },
                  { value: 'large' as CardSize, label: 'Large' },
                ]}
                onChange={(v) => void saveStyle({ cardSize: v })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wiki Font Size</span>
              <SegmentedControl
                value={style.wikiFontSize}
                options={[
                  { value: 'small' as WikiFontSize, label: 'Small' },
                  { value: 'normal' as WikiFontSize, label: 'Normal' },
                  { value: 'large' as WikiFontSize, label: 'Large' },
                ]}
                onChange={(v) => void saveStyle({ wikiFontSize: v })}
              />
            </div>

            <div className="border-b border-gray-200 my-1" />

            <SegmentedControl
              value={editingMode}
              options={[
                { value: 'light' as const, label: 'Light' },
                { value: 'dark' as const, label: 'Dark' },
              ]}
              onChange={setEditingMode}
            />

            <ColorPickerRow
              key={`accent-${editingMode}`}
              label="Accent Color"
              value={editingColors.accentColor}
              presets={ACCENT_PRESETS}
              onSelect={(c) => saveColor('accentColor', c)}
            />

            <ColorPickerRow
              key={`bg-${editingMode}`}
              label="Background"
              value={editingColors.bgColor}
              presets={editingMode === 'light' ? BG_PRESETS : DARK_BG_PRESETS}
              onSelect={(c) => saveColor('bgColor', c)}
            />

            <ColorPickerRow
              key={`text-${editingMode}`}
              label="Text Color"
              value={editingColors.textColor}
              presets={editingMode === 'light' ? TEXT_PRESETS : DARK_TEXT_PRESETS}
              onSelect={(c) => saveColor('textColor', c)}
            />

            <ColorPickerRow
              key={`muted-${editingMode}`}
              label="Muted Text"
              value={editingColors.textMuted}
              presets={MUTED_PRESETS}
              onSelect={(c) => saveColor('textMuted', c)}
            />

            <ColorPickerRow
              key={`thumb-${editingMode}`}
              label="Thumbnail Background"
              value={editingColors.thumbBgColor}
              presets={editingMode === 'light' ? THUMB_BG_PRESETS : DARK_THUMB_BG_PRESETS}
              onSelect={(c) => saveColor('thumbBgColor', c)}
            />

            <ColorPickerRow
              key={`control-bg-${editingMode}`}
              label="Control Background"
              value={editingColors.controlBgColor}
              presets={editingMode === 'light' ? CONTROL_BG_PRESETS : DARK_CONTROL_BG_PRESETS}
              onSelect={(c) => saveColor('controlBgColor', c)}
            />

            <ColorPickerRow
              key={`control-text-${editingMode}`}
              label="Control Text"
              value={editingColors.controlTextColor}
              presets={editingMode === 'light' ? CONTROL_TEXT_PRESETS : DARK_CONTROL_TEXT_PRESETS}
              onSelect={(c) => saveColor('controlTextColor', c)}
            />
          </div>
        )}

        {settingsTab === 'mapping' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={`// Map original filenames to custom names\n"actor1": "hero_sprite"\n"dungeon_a1": "cave_tileset"`}
                className="text-sm font-mono px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] resize-y"
                style={{ backgroundColor: 'var(--control-bg)', color: 'var(--control-text)' }}
              />
            </label>

            {parsedEntries.length > 0 ? (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--thumb-bg)' }}>
                      <th className="text-left px-3 py-1.5 font-medium text-[var(--text-muted)]">
                        Original
                      </th>
                      <th className="text-left px-3 py-1.5 font-medium text-[var(--text-muted)]">
                        Mapped To
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedEntries.map(([key, value], i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-1 font-mono text-[var(--text)]">{key}</td>
                        <td className="px-3 py-1 font-mono text-[var(--text)]">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No valid mappings found</p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => void handleSaveMapping()}
                disabled={saving}
                className="text-sm px-4 py-1.5 rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              {status && (
                <span className={`text-xs ${status.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {status.message}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const App = () => {
  const [appState, setAppState] = useState<AppState>('loading');
  const [activeTab, setActiveTab] = useState<ActiveTab>('wiki');
  const [subredditName, setSubredditName] = useState('');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [isMod, setIsMod] = useState(false);
  const [meta, setMeta] = useState<EchoMeta | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [paths, setPaths] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterType>('images');
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [mappingText, setMappingText] = useState('"original_filename": "mapped_filename"');
  const [pathToMapped, setPathToMapped] = useState<Map<string, string>>(new Map());

  const [mismatchWarning, setMismatchWarning] = useState<string | null>(null);
  const [style, setStyle] = useState<StyleConfig>({ ...DEFAULT_STYLE });
  const [isDark, setIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const colors: ColorTheme = isDark ? style.dark : style.light;

  const cssVars = useMemo(
    () =>
      ({
        '--accent': colors.accentColor,
        '--accent-hover': darkenHex(colors.accentColor, 0.05),
        '--accent-ring': hexToRgba(colors.accentColor, 0.2),
        '--bg': colors.bgColor,
        '--text': colors.textColor,
        '--text-muted': colors.textMuted,
        '--thumb-bg': colors.thumbBgColor,
        '--control-bg': colors.controlBgColor,
        '--control-text': colors.controlTextColor,
      }) as CSSProperties,
    [
      colors.accentColor,
      colors.bgColor,
      colors.textColor,
      colors.textMuted,
      colors.thumbBgColor,
      colors.controlBgColor,
      colors.controlTextColor,
    ]
  );

  useEffect(() => {
    const init = async () => {
      const wikiPromise = fetch('/api/wiki').catch(() => null);

      try {
        const res = await fetch('/api/init');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: InitResponse = await res.json();
        setSubredditName(data.subredditName);
        setConfig(data.config);
        setIsMod(data.isMod);
      } catch {}

      const imported = await hasAssets();
      if (imported) {
        const m = await getMeta();
        setMeta(m ?? null);
        const allPaths = await listAssetPaths();
        setPaths(allPaths);

        const imagePaths = getFirstVisibleImagePaths(allPaths);
        const wikiEchoPaths: string[] = [];

        try {
          const wikiRes = await wikiPromise;
          if (wikiRes?.ok) {
            const data: WikiResponse = await wikiRes.json();
            if (data.content) {
              const re = /echo:\/\/([^\s)"\]]+)/g;
              let em;
              while ((em = re.exec(data.content)) !== null) {
                if (em[1]) wikiEchoPaths.push(em[1].toLowerCase());
              }
            }
          }
        } catch {}

        await preloadPaths([...new Set([...imagePaths, ...wikiEchoPaths])]);
        setAppState('ready');
      } else {
        setAppState('no-assets');
      }
    };
    void init();
  }, []);

  useEffect(() => {
    if (appState !== 'ready') return;
    const load = async () => {
      try {
        const [mappingRes, styleRes] = await Promise.all([
          fetch('/api/mapping'),
          fetch('/api/style'),
        ]);
        if (mappingRes.ok) {
          const data: MappingResponse = await mappingRes.json();
          setMapping(data.mapping);
          setMappingText(data.text);
          if (data.mapping) {
            const result = await applyMapping(data.mapping);
            setPathToMapped(result);
            setReverseMapping(result);
          }
        }
        if (styleRes.ok) {
          const data: StyleResponse = await styleRes.json();
          setStyle(data.style);
        }
      } catch {}
    };
    void load();
  }, [appState]);

  const filteredPaths = useMemo(() => {
    let result = filter === 'images' ? paths.filter(isImagePath) : paths.filter(isAudioPath);
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
        sensitivity: 'base',
      })
    );
  }, [paths, filter, subFilter, search, pathToMapped]);

  const subcategories = useMemo(() => {
    const categoryPaths =
      filter === 'images' ? paths.filter(isImagePath) : paths.filter(isAudioPath);

    const folderCounts = new Map<string, number>();
    for (const p of categoryPaths) {
      const folder = getSubfolder(p);
      if (folder) {
        folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
      }
    }
    return [...folderCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
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
    [paths]
  );

  const gridClass =
    style.cardSize === 'compact'
      ? 'grid-cols-[repeat(auto-fill,minmax(64px,1fr))]'
      : style.cardSize === 'large'
        ? 'grid-cols-[repeat(auto-fill,minmax(120px,1fr))]'
        : 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))]';

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);
      setAppState('importing');
      setError(null);
      setProgress(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const progressRef: { current: ImportProgress | null } = { current: null };
        await importGameFiles({
          files,
          engineOverride: config?.engine,
          keyOverride: config?.encryptionKey || undefined,
          onProgress: (p) => {
            progressRef.current = p;
            setProgress(p);
          },
          signal: controller.signal,
        });
        const m = await getMeta();
        setMeta(m ?? null);
        const allPaths = await listAssetPaths();
        setPaths(allPaths);
        setFilter('images');
        setSubFilter(null);
        setSearch('');
        setVisibleCount(PAGE_SIZE);

        if (mapping) {
          const result = await applyMapping(mapping);
          setPathToMapped(result);
          setReverseMapping(result);
        }

        if (
          config?.gameName &&
          progressRef.current?.gameTitle &&
          config.gameName.toLowerCase() !== progressRef.current.gameTitle.toLowerCase()
        ) {
          setMismatchWarning(
            `Expected '${config.gameName}' but detected '${progressRef.current.gameTitle}'. You may have imported the wrong game.`
          );
        }

        await preloadPaths(getFirstVisibleImagePaths(allPaths));

        setAppState('ready');
      } catch (err) {
        if (err instanceof Error && err.message === 'Import cancelled') {
          const still = await hasAssets();
          if (still) {
            const allPaths = await listAssetPaths();
            setPaths(allPaths);
            setAppState('ready');
          } else {
            setAppState('no-assets');
          }
        } else {
          setError(err instanceof Error ? err.message : 'Import failed');
          const still = await hasAssets();
          if (still) {
            const allPaths = await listAssetPaths();
            setPaths(allPaths);
            setAppState('ready');
          } else {
            setAppState('no-assets');
          }
        }
      } finally {
        abortRef.current = null;
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [config, mapping]
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleCopied = useCallback((path: string) => {
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  }, []);

  const handleWipe = useCallback(async () => {
    revokeAllBlobUrls();
    await wipeAll();
    setMeta(null);
    setPaths([]);
    setFilter('images');
    setSubFilter(null);
    setSearch('');
    setCopiedPath(null);
    setVisibleCount(PAGE_SIZE);
    setMapping(null);
    setPathToMapped(new Map());
    setReverseMapping(null);
    setPreviewPath(null);
    setAppState('no-assets');
  }, []);

  const handleMappingSaved = useCallback(
    (newText: string, newMapping: Record<string, string> | null) => {
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
    },
    []
  );

  const handleStyleChanged = useCallback((newStyle: StyleConfig) => {
    setStyle(newStyle);
  }, []);

  const isInline = getWebViewMode() === 'inline';

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{
        ...(appState === 'ready' ? cssVars : PRE_IMPORT_VARS),
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: appState === 'ready' ? FONT_MAP[style.fontFamily] : FONT_MAP.system,
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

      {copiedPath && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          Copied echo link
        </div>
      )}

      {previewPath && (
        <AssetPreview
          path={previewPath}
          mappedPath={pathToMapped.get(previewPath)}
          onClose={() => setPreviewPath(null)}
          onCopied={handleCopied}
        />
      )}

      {appState !== 'ready' && (
        <div className="flex-1 relative flex flex-col items-center">
          <div
            className="ripple-container"
            style={{
              position: 'absolute',
              top: appState === 'loading' ? 'calc(50% - 150px)' : '-5%',
              transition: 'top 0.7s ease-in-out',
            }}
          >
            <div />
            <div />
            <div />
            <img
              src="/title.png"
              alt="EchoWiki"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-50 object-contain z-1"
            />
            {subredditName && (
              <p
                className="absolute left-1/2 -translate-x-1/2 text-base text-[var(--text)] whitespace-nowrap pointer-events-none z-1"
                style={{ top: '70%' }}
              >
                r/{subredditName}
              </p>
            )}
          </div>

          {appState === 'no-assets' && (
            <div
              className="content-fade-in flex flex-col items-center gap-6 max-w-md text-center"
              style={{ position: 'absolute', top: '50%' }}
            >
              {config?.gameName ? (
                <p className="text-[var(--text-muted)] text-sm">
                  Please select the folder that contains the game{' '}
                  <div className="font-semibold text-[var(--text)]">{config.gameName}</div>
                  Those files will never leave your device.
                </p>
              ) : (
                <p className="text-[var(--text-muted)] text-sm">
                  Select your game folder to import assets locally. Files never leave your device..
                </p>
              )}
              <button
                className="flex items-center justify-center bg-[var(--accent)] text-white h-10 rounded-full cursor-pointer transition-all px-6 font-medium hover:scale-105 hover:font-bold hover:border-2 hover:border-white"
                onClick={handleImport}
              >
                Import Game Folder
              </button>
              {config?.gameName && config?.storeLink && (
                <div className="flex flex-col items-center gap-4 mt-2">
                  <button
                    onClick={() => {
                      try {
                        navigateTo({ url: config.storeLink });
                      } catch {
                        window.open(config.storeLink, '_blank');
                      }
                    }}
                    className="flex items-center justify-center h-10 rounded-full cursor-pointer transition-all px-6 font-medium text-xs border-2 border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white hover:scale-105 hover:border-white"
                  >
                    Purchase {config.gameName}
                  </button>
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}

          {appState === 'importing' && (
            <div
              className="content-fade-in flex flex-col items-center gap-4 max-w-md w-full"
              style={{ position: 'absolute', top: '50%' }}
            >
              {progress ? (
                <>
                  <div className="w-full">
                    {progress.total > 0 ? (
                      <>
                        <div className="flex justify-end text-xs text-[var(--text-muted)] mb-1">
                          <span>
                            {Math.min(Math.round((progress.processed / progress.total) * 100), 100)}
                            %
                          </span>
                        </div>
                        <div
                          className="w-full rounded-full h-1.5"
                          style={{ backgroundColor: 'var(--thumb-bg)' }}
                        >
                          <div
                            className="h-1.5 rounded-full transition-all duration-300 ease-linear"
                            style={{
                              width: `${Math.min((progress.processed / progress.total) * 100, 100)}%`,
                              backgroundColor: 'var(--accent)',
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)] text-center">
                        {progress.phase === 'detecting' ? 'Detecting engine...' : 'Extracting...'}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Starting import...</p>
              )}
              <button
                className="text-xs px-3 py-1 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {appState === 'ready' && (
        <>
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <div className="flex items-center gap-1">
              <h1 className="text-lg font-bold mr-2">EchoWiki</h1>
              <button
                className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                  activeTab === 'wiki'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-gray-100'
                }`}
                onClick={() => setActiveTab('wiki')}
              >
                Wiki
              </button>
              <button
                className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                  activeTab === 'assets'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-gray-100'
                }`}
                onClick={() => setActiveTab('assets')}
              >
                Assets
                {meta && (
                  <span className="ml-1 opacity-70">{meta.assetCount.toLocaleString()}</span>
                )}
              </button>
              {isMod && (
                <button
                  className={`text-sm px-3 py-1 rounded-full transition-colors cursor-pointer ${
                    activeTab === 'settings'
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-muted)] hover:bg-gray-100'
                  }`}
                  onClick={() => setActiveTab('settings')}
                >
                  Settings
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isInline && (
                <button
                  className="text-gray-400 hover:text-[var(--text-muted)] transition-colors cursor-pointer"
                  title="Pop out"
                  onClick={(e) => void requestExpandedMode(e.nativeEvent, 'default')}
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
                className="text-xs px-3 py-1 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
                onClick={() => void handleWipe()}
              >
                Exit
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {mismatchWarning && (
            <div className="flex items-center justify-between px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-sm text-yellow-800">
              <span>{mismatchWarning}</span>
              <button
                onClick={() => setMismatchWarning(null)}
                className="ml-3 flex-shrink-0 text-yellow-600 hover:text-yellow-800 cursor-pointer"
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

          {activeTab === 'wiki' && (
            <div className="flex-1 overflow-auto">
              <WikiView subredditName={subredditName} wikiFontSize={style.wikiFontSize} />
            </div>
          )}

          {activeTab === 'assets' && (
            <>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-2 border-b border-gray-50">
                <FilterTabs
                  active={filter}
                  counts={counts}
                  onChange={(f) => {
                    setFilter(f);
                    setSubFilter(null);
                    setVisibleCount(PAGE_SIZE);
                  }}
                />
                <input
                  type="text"
                  placeholder="Search assets..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="flex-1 text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                  style={{ backgroundColor: 'var(--control-bg)', color: 'var(--control-text)' }}
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

              <div className="flex-1 overflow-auto px-4 py-3">
                {filteredPaths.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <p className="text-sm">
                      {search ? 'No matching assets' : 'No assets in this category'}
                    </p>
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
                          className="text-sm px-4 py-1.5 rounded-full bg-gray-100 text-[var(--text-muted)] hover:bg-gray-200 transition-colors cursor-pointer"
                          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                        >
                          Load more ({(filteredPaths.length - visibleCount).toLocaleString()}{' '}
                          remaining)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === 'settings' && isMod && config && (
            <SettingsView
              mappingText={mappingText}
              style={style}
              config={config}
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
