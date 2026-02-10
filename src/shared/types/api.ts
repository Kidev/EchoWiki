export type EngineType =
  | "rm2k3"
  | "rmxp"
  | "rmvx"
  | "rmvxace"
  | "rmmv"
  | "rmmv-encrypted"
  | "rmmz"
  | "rmmz-encrypted"
  | "tcoaal"
  | "auto";

export type GameConfig = {
  gameName: string;
  storeLink: string;
  engine: EngineType;
  encryptionKey: string;
};

export type ConfigResponse = {
  type: "config";
  config: GameConfig;
};

export type ConfigUpdateRequest = {
  gameName?: string;
  storeLink?: string;
  engine?: EngineType;
  encryptionKey?: string;
};

export type ConfigUpdateResponse = {
  type: "config-updated";
  config: GameConfig;
};

export type InitResponse = {
  type: "init";
  postId: string;
  subredditName: string;
  username: string;
  isMod: boolean;
  config: GameConfig;
};

export type WikiResponse = {
  type: "wiki";
  content: string | null;
};

export type WikiPagesResponse = {
  type: "wiki-pages";
  pages: string[];
};

export type MappingResponse = {
  type: "mapping";
  mapping: Record<string, string> | null;
  text: string;
};

export type MappingUpdateRequest = {
  text: string;
  entries?: Array<[string, string]> | undefined;
};

export type CardSize = "compact" | "normal" | "large";

export type WikiFontSize = "small" | "normal" | "large";

export type FontFamily = "system" | "serif" | "mono";

export type ColorTheme = {
  accentColor: string;
  bgColor: string;
  textColor: string;
  textMuted: string;
  thumbBgColor: string;
  controlBgColor: string;
  controlTextColor: string;
};

export type StyleConfig = {
  cardSize: CardSize;
  wikiFontSize: WikiFontSize;
  fontFamily: FontFamily;
  light: ColorTheme;
  dark: ColorTheme;
};

export type StyleResponse = {
  type: "style";
  style: StyleConfig;
};

export type StyleUpdateRequest = {
  mode?: "light" | "dark" | undefined;
  accentColor?: string | undefined;
  bgColor?: string | undefined;
  textColor?: string | undefined;
  textMuted?: string | undefined;
  thumbBgColor?: string | undefined;
  controlBgColor?: string | undefined;
  controlTextColor?: string | undefined;
  cardSize?: CardSize | undefined;
  wikiFontSize?: WikiFontSize | undefined;
  fontFamily?: FontFamily | undefined;
};

export type WikiUpdateRequest = {
  page: string;
  content: string;
  reason: string;
};

export type WikiUpdateResponse = {
  type: "wiki-updated";
  page: string;
};

export type ErrorResponse = {
  status: "error";
  message: string;
};
