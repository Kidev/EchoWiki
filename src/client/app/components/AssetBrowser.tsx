import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useEchoUrl } from "../../lib/echo";
import { getFileName, isImagePath, getCategory, toDisplayName, groupLabel } from "../assetUtils";
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
    <span ref={measureRef} className="asset-name-static text-[var(--text-muted)] leading-tight">
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
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
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

export const FILTERS: readonly FilterType[] = ["images", "audio"] as const;

export function FilterTabs({
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

  useEffect(() => {
    setDropdownOpen(false);
  }, [active]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = () => setDropdownOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [dropdownOpen]);

  if (subcategories.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {subcategories.map((s) => {
        const isActive = active === s.name;

        const folderHasGroups = foldersWithGroups.has(s.name);

        const dropdownEnabled = isActive && groups.length > 0;
        return (
          <div key={s.name} className="relative">
            <button
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer inline-flex items-center gap-0.5 ${
                isActive ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)]"
              }`}
              style={!isActive ? { backgroundColor: "transparent" } : undefined}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
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
                    dropdownEnabled ? "opacity-70 cursor-pointer" : "opacity-30"
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
                        backgroundColor: isActiveGroup ? "var(--thumb-bg)" : "transparent",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--thumb-bg)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = isActiveGroup
                          ? "var(--thumb-bg)"
                          : "transparent")
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
