import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { useEchoUrl, modelHasEchoTexture } from "../../lib/echo";
import { copyText } from "../../lib/clipboard";
import {
  getFileName,
  isImagePath,
  isModelPath,
  getCategory,
  toDisplayName,
  groupLabel,
} from "../assetUtils";
import type { FilterType } from "../appTypes";
import type { CardSize } from "../../../shared/types/api";

export function AssetNameLabel({
  displayName,
  hovered,
}: {
  displayName: string;
  hovered: boolean;
}) {
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
    <span
      ref={measureRef}
      className="asset-name-static text-[var(--text-muted)] leading-tight"
    >
      {displayName}
    </span>
  );
}

export function AssetCard({
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

  // Flag models that ship with an attached texture (a GLB `extras.echoTex`
  // pointer). Read lazily so the grid stays responsive on large imports.
  const [hasTexture, setHasTexture] = useState(false);
  useEffect(() => {
    if (category !== "models") {
      setHasTexture(false);
      return;
    }
    let cancelled = false;
    void modelHasEchoTexture(path).then((v) => {
      if (!cancelled) setHasTexture(v);
    });
    return () => {
      cancelled = true;
    };
  }, [category, path]);

  const displayName = toDisplayName(mappedPath ?? path);
  const echoPath = mappedPath ?? path;
  const name = getFileName(path);

  const isEmbeddable = isImagePath(path) || isModelPath(path);
  const echoMarkdown = isEmbeddable
    ? `![${displayName}](echo://${echoPath})`
    : `[${displayName}](echo://${echoPath})`;

  const originalMarkdown = isEmbeddable
    ? `![${toDisplayName(path)}](echo://${path})`
    : `[${toDisplayName(path)}](echo://${path})`;

  const handleClick = useCallback(() => {
    onPreview(path);
  }, [onPreview, path]);

  const handleCopy = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      const text = e.ctrlKey || e.metaKey ? originalMarkdown : echoMarkdown;
      void copyText(text).then((ok) => {
        if (ok) onCopied(path);
      });
    },
    [echoMarkdown, originalMarkdown, onCopied, path],
  );

  const [cardHovered, setCardHovered] = useState(false);

  const thumbClass =
    cardSize === "compact"
      ? "w-12 h-12"
      : cardSize === "large"
        ? "w-24 h-24"
        : "w-16 h-16";
  const labelClass =
    cardSize === "compact"
      ? "text-[9px]"
      : cardSize === "large"
        ? "text-[11px]"
        : "text-[10px]";
  const copyIconClass =
    cardSize === "compact"
      ? "w-2.5 h-2.5"
      : cardSize === "large"
        ? "w-3.5 h-3.5"
        : "w-3 h-3";
  const badgeClass =
    cardSize === "compact"
      ? "w-3 h-3"
      : cardSize === "large"
        ? "w-[18px] h-[18px]"
        : "w-4 h-4";

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
        className={`${thumbClass} relative rounded border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0`}
        style={{
          backgroundColor: category === "data" ? "#f9fafb" : "var(--thumb-bg)",
        }}
      >
        {category === "images" ? (
          loading ? (
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          ) : url ? (
            <img
              src={url}
              alt={name}
              className="w-full h-full object-contain"
            />
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
        ) : category === "models" ? (
          <svg
            className="w-6 h-6 text-violet-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 2l9 5v10l-9 5-9-5V7l9-5zM3.5 7L12 12m0 0l8.5-5M12 12v10"
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
        {category === "models" && hasTexture && (
          <span
            className={`${badgeClass} absolute bottom-0.5 right-0.5 flex items-center justify-center rounded-full bg-violet-500 text-white ring-1 ring-white/70 shadow-sm`}
            title="Texture attached"
          >
            <svg
              className="w-2/3 h-2/3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-9-6h.01M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"
              />
            </svg>
          </span>
        )}
      </div>
      <div className={`${labelClass} flex items-center gap-0.5 w-full min-w-0`}>
        <AssetNameLabel displayName={displayName} hovered={cardHovered} />
        <button
          className="flex-shrink-0 text-gray-300 hover:text-[var(--accent)] transition-colors cursor-pointer p-0.5"
          onClick={handleCopy}
          title="Copy echo link (Ctrl+click for original name)"
        >
          <svg
            className={copyIconClass}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
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

export const FILTERS: readonly FilterType[] = [
  "images",
  "audio",
  "models",
] as const;

export function FilterTabs({
  active,
  counts,
  onChange,
}: {
  active: FilterType;
  counts: Record<FilterType, number>;
  onChange: (f: FilterType) => void;
}) {
  // Images and audio are always offered; the Models tab only appears once a game
  // actually has 3D assets, keeping the bar uncluttered for the common case.
  const visible = FILTERS.filter(
    (f) => f === "images" || f === "audio" || counts[f] > 0,
  );
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((f) => (
        <button
          key={f}
          className={`text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
            active === f
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-muted)]"
          }`}
          style={active !== f ? { backgroundColor: "transparent" } : undefined}
          onMouseEnter={(e) => {
            if (active !== f)
              e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
          }}
          onMouseLeave={(e) => {
            if (active !== f)
              e.currentTarget.style.backgroundColor = "transparent";
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

export function SubFilterTabs({
  active,
  subcategories,
  groups,
  activeGroup,
  foldersWithGroups,
  onChange,
  onGroupChange,
}: {
  active: string | null;
  subcategories: readonly { name: string; count: number }[];
  groups: readonly string[];
  activeGroup: string | null;
  foldersWithGroups: ReadonlySet<string>;
  onChange: (name: string) => void;
  onGroupChange: (group: string | null) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [scrollNeeded, setScrollNeeded] = useState(false);
  const [rowHeight, setRowHeight] = useState(0);
  const [activeOffset, setActiveOffset] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDropdownOpen(false);
  }, [active]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = () => setDropdownOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [dropdownOpen]);

  // Detect whether the tabs wrap onto more than one line (so we can collapse
  // them to a single row) and locate the row holding the active subcategory.
  const remeasure = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const rh = first ? first.offsetHeight : 0;
    setRowHeight(rh);
    setOverflowing(rh > 0 && el.scrollHeight > rh + 4);
    setScrollNeeded(el.scrollHeight > window.innerHeight * 0.6);
    const activeEl = el.querySelector<HTMLElement>('[data-sub-active="true"]');
    setActiveOffset(activeEl ? activeEl.offsetTop : 0);
  }, []);

  useLayoutEffect(() => {
    remeasure();
    const el = tabsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [subcategories, remeasure]);

  // Recompute the active row's offset when the selection changes.
  useLayoutEffect(() => {
    remeasure();
  }, [active, remeasure]);

  if (subcategories.length <= 1) return null;

  const collapsed = overflowing && !hovered;

  return (
    <div
      // While the group dropdown is open, lift the whole tab bar into its own
      // stacking context above the asset grid. The inner content layer carries a
      // non-`none` transform, which traps the dropdown's z-index in a nested
      // context; without this the grid (later in DOM order) paints over it.
      className={`relative ${dropdownOpen ? "z-50" : ""}`}
      style={overflowing ? { height: rowHeight } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Clipping viewport: fixes the visible height; the inner content layer
          slides via translateY so the active row stays visible when collapsed. */}
      <div
        className={`transition-[max-height] ${
          overflowing ? "absolute left-0 right-0 top-0 z-40" : ""
        }`}
        style={
          overflowing
            ? collapsed
              ? { maxHeight: rowHeight, overflow: "hidden" }
              : {
                  maxHeight: "60vh",
                  overflowY: scrollNeeded ? "auto" : "hidden",
                  backgroundColor: "var(--bg)",
                  boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
                  borderRadius: "0.5rem",
                  padding: "0.25rem",
                  margin: "-0.25rem",
                }
            : undefined
        }
      >
        <div
          ref={tabsRef}
          className="relative flex flex-wrap gap-1 transition-transform"
          style={{
            transform: collapsed
              ? `translateY(-${activeOffset}px)`
              : "translateY(0)",
          }}
        >
          {subcategories.map((s) => {
            const isActive = active === s.name;

            const folderHasGroups = foldersWithGroups.has(s.name);

            const dropdownEnabled = isActive && groups.length > 0;
            return (
              <div key={s.name} className="relative" data-sub-active={isActive}>
                <button
                  className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer inline-flex items-center gap-0.5 ${
                    isActive
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--text-muted)]"
                  }`}
                  style={
                    !isActive ? { backgroundColor: "transparent" } : undefined
                  }
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.backgroundColor = "transparent";
                  }}
                  onClick={() => {
                    onChange(s.name);
                    setDropdownOpen(false);
                  }}
                  onContextMenu={(e) => {
                    if (dropdownEnabled) {
                      e.preventDefault();
                      setDropdownOpen((o) => !o);
                    }
                  }}
                >
                  {s.name.charAt(0).toUpperCase() + s.name.slice(1)}
                  <span className="opacity-70">{s.count}</span>
                  {folderHasGroups && (
                    <span
                      className={`text-[7px] leading-none px-1 py-0.5 -my-0.5 ${
                        dropdownEnabled
                          ? "opacity-70 cursor-pointer"
                          : "opacity-30"
                      }`}
                      onClick={(e) => {
                        if (!dropdownEnabled) return;
                        e.stopPropagation();
                        setDropdownOpen((o) => !o);
                      }}
                    >
                      &#9662;
                    </span>
                  )}
                </button>
                {dropdownEnabled && dropdownOpen && (
                  <div
                    className="absolute top-full left-0 z-50 mt-1 py-1 rounded-lg shadow-lg border border-gray-200 min-w-[140px] max-h-48 overflow-y-auto"
                    style={{ backgroundColor: "var(--bg)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {([null, ...groups] as (string | null)[]).map((g) => {
                      const label = g === null ? "All" : groupLabel(g);
                      const isActiveGroup = activeGroup === g;
                      return (
                        <button
                          key={g ?? "__all"}
                          className="w-full text-left text-xs px-3 py-1.5 cursor-pointer text-[var(--text)]"
                          style={{
                            backgroundColor: isActiveGroup
                              ? "var(--thumb-bg)"
                              : "transparent",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              "var(--thumb-bg)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              isActiveGroup ? "var(--thumb-bg)" : "transparent")
                          }
                          onClick={() => {
                            onGroupChange(g);
                            setDropdownOpen(false);
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {overflowing && (
        <div
          className="pointer-events-none absolute top-0 right-0 z-50 flex h-full items-center pl-8 pr-0.5"
          style={{
            opacity: collapsed ? 1 : 0,
            transition: "opacity 120ms ease",
            background:
              "linear-gradient(to right, transparent, var(--bg) 55%, var(--bg) 100%)",
          }}
        >
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] leading-none text-[var(--text-muted)]"
            style={{ backgroundColor: "var(--thumb-bg)" }}
            title="Hover to expand"
          >
            &#9662;
          </span>
        </div>
      )}
    </div>
  );
}

export function SegmentedControl<T extends string>({
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
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-muted)]"
          }`}
          style={
            value !== opt.value
              ? { backgroundColor: "var(--control-bg)" }
              : undefined
          }
          onMouseEnter={(e) => {
            if (value !== opt.value)
              e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
          }}
          onMouseLeave={(e) => {
            if (value !== opt.value)
              e.currentTarget.style.backgroundColor = "var(--control-bg)";
          }}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
