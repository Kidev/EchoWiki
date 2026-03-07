import type { FontFamily, StyleConfig, SubredditAppearance } from "../../shared/types/api";

export type AppState = "loading" | "no-assets" | "importing" | "ready" | "server-unavailable";

export type AppMode = "main" | "voting";

export type ActiveTab = "wiki" | "assets" | "submissions" | "settings";

export type FilterType = "images" | "audio";

export type EchoLinkTarget =
  | { type: "wiki"; page: string; anchor: string | null }
  | { type: "assets" };

export const PAGE_SIZE = 60;
export const INIT_PRELOAD_COUNT = 20;

export const DEFAULT_STYLE: StyleConfig = {
  cardSize: "normal",
  wikiFontSize: "normal",
  fontFamily: "system",
  light: {
    accentColor: "#d93900",
    linkColor: "#d93900",
    bgColor: "#ffffff",
    textColor: "#111827",
    textMuted: "#6b7280",
    thumbBgColor: "#e5e7eb",
    controlBgColor: "#ffffff",
    controlTextColor: "#111827",
  },
  dark: {
    accentColor: "#ff6b3d",
    linkColor: "#ff6b3d",
    bgColor: "#1a1a1b",
    textColor: "#d7dadc",
    textMuted: "#818384",
    thumbBgColor: "#343536",
    controlBgColor: "#343536",
    controlTextColor: "#d7dadc",
  },
};

export const DEFAULT_APPEARANCE: SubredditAppearance = {
  bannerUrl: null,
  iconUrl: null,
  keyColor: null,
  primaryColor: null,
  bgColor: null,
  highlightColor: null,
  font: null,
};

export const FONT_MAP: Record<Exclude<FontFamily, "subreddit">, string> = {
  system: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

export function getFontFamily(fontFamily: FontFamily, subredditFont: string | null): string {
  if (fontFamily === "subreddit") {
    return subredditFont ?? FONT_MAP.system;
  }
  return FONT_MAP[fontFamily];
}

export function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
