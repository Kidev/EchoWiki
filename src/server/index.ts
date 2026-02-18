import express from "express";
import type { Response } from "express";
import type {
  CardSize,
  ColorTheme,
  ConfigResponse,
  ConfigUpdateRequest,
  ConfigUpdateResponse,
  ErrorResponse,
  FontFamily,
  GameConfig,
  HomeBackground,
  HomeLogo,
  InitResponse,
  MappingResponse,
  MappingUpdateRequest,
  StyleConfig,
  StyleResponse,
  StyleUpdateRequest,
  SubredditAppearance,
  WikiFontSize,
  WikiPagesResponse,
  WikiResponse,
  WikiUpdateRequest,
  WikiUpdateResponse,
} from "../shared/types/api";
import type { UiResponse } from "@devvit/web/shared";
import { redis, reddit, createServer, context, getServerPort } from "@devvit/web/server";
import { createPost } from "./core/post";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

const router = express.Router();

const DEFAULT_CONFIG: GameConfig = {
  gameName: "",
  engine: "auto",
  encryptionKey: "",
  wikiTitle: "",
  wikiDescription: "",
  homeBackground: "ripple",
  homeLogo: "subreddit",
};

const VALID_HOME_BACKGROUNDS = new Set<string>(["ripple", "banner", "both", "none"]);
const VALID_HOME_LOGOS = new Set<string>(["echowiki", "subreddit"]);

const DEFAULT_MAPPING_TEXT = '"original_filename": "mapped_filename"';

async function getConfig(): Promise<GameConfig> {
  const raw = await redis.hGetAll("config");
  if (!raw || Object.keys(raw).length === 0) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    gameName: raw["gameName"] ?? DEFAULT_CONFIG.gameName,
    engine: (raw["engine"] as GameConfig["engine"]) ?? DEFAULT_CONFIG.engine,
    encryptionKey: raw["encryptionKey"] ?? DEFAULT_CONFIG.encryptionKey,
    wikiTitle: raw["wikiTitle"] ?? DEFAULT_CONFIG.wikiTitle,
    wikiDescription: raw["wikiDescription"] ?? DEFAULT_CONFIG.wikiDescription,
    homeBackground:
      raw["homeBackground"] && VALID_HOME_BACKGROUNDS.has(raw["homeBackground"]!)
        ? (raw["homeBackground"] as HomeBackground)
        : DEFAULT_CONFIG.homeBackground,
    homeLogo:
      raw["homeLogo"] && VALID_HOME_LOGOS.has(raw["homeLogo"]!)
        ? (raw["homeLogo"] as HomeLogo)
        : DEFAULT_CONFIG.homeLogo,
  };
}

async function getSubredditAppearance(): Promise<SubredditAppearance> {
  const fallback: SubredditAppearance = {
    bannerUrl: null,
    iconUrl: null,
    keyColor: null,
    primaryColor: null,
    bgColor: null,
    highlightColor: null,
    font: null,
  };
  try {
    const name = context.subredditName;
    if (!name) return fallback;
    const sub = await reddit.getSubredditByName(name);
    const settings = sub.settings;

    let bgColor: string | null = null;
    let highlightColor: string | null = null;
    let stylesKeyColor: string | null = null;
    try {
      const styles = await reddit.getSubredditStyles(sub.id);
      bgColor = styles.backgroundColor ?? null;
      highlightColor = styles.highlightColor ?? null;
      stylesKeyColor = styles.primaryColor ?? null;
    } catch {}

    return {
      bannerUrl: settings.bannerBackgroundImage ?? settings.bannerImage ?? null,
      iconUrl: settings.communityIcon ?? null,
      keyColor: settings.keyColor ?? stylesKeyColor ?? null,
      primaryColor: settings.primaryColor ?? null,
      bgColor,
      highlightColor,
      font: null,
    };
  } catch {
    return fallback;
  }
}

const ALLOWED_MAPPING_CHARS = /^[a-zA-Z0-9!_\-()[\]' ]+$/;

function entriesFromPairs(entries: Array<[string, string]>): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    const k = key.toLowerCase();
    const v = value.toLowerCase();
    if (!ALLOWED_MAPPING_CHARS.test(k) || !ALLOWED_MAPPING_CHARS.test(v)) continue;
    result[k] = v;
  }
  return Object.keys(result).length > 0 ? result : null;
}

router.get<Record<string, never>, InitResponse | ErrorResponse>(
  "/api/init",
  async (_req, res): Promise<void> => {
    const { postId } = context;

    if (!postId) {
      res.status(400).json({
        status: "error",
        message: "postId is required but missing from context",
      });
      return;
    }

    try {
      const [config, username, appearance] = await Promise.all([
        getConfig(),
        reddit.getCurrentUsername(),
        getSubredditAppearance(),
      ]);

      let isMod = false;
      if (username && context.subredditName) {
        try {
          const mods = reddit.getModerators({
            subredditName: context.subredditName,
            username,
          });
          const modList = await mods.all();
          isMod = modList.length > 0;
        } catch {}
      }

      res.json({
        type: "init",
        postId,
        subredditName: context.subredditName ?? "",
        username: username ?? "anonymous",
        isMod,
        config,
        appearance,
      });
    } catch (error) {
      const message =
        error instanceof Error ? `Initialization failed: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, ConfigResponse | ErrorResponse>(
  "/api/config",
  async (_req, res): Promise<void> => {
    try {
      const config = await getConfig();
      res.json({ type: "config", config });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to get config: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<Record<string, never>, ConfigUpdateResponse | ErrorResponse, ConfigUpdateRequest>(
  "/api/config",
  async (req, res): Promise<void> => {
    try {
      const body = req.body as ConfigUpdateRequest;
      const fields: Record<string, string> = {};

      if (body.gameName !== undefined) {
        fields["gameName"] = body.gameName;
      }
      if (body.engine !== undefined) {
        fields["engine"] = body.engine;
      }
      if (body.encryptionKey !== undefined) {
        fields["encryptionKey"] = body.encryptionKey;
      }
      if (body.wikiTitle !== undefined) {
        fields["wikiTitle"] = body.wikiTitle;
      }
      if (body.wikiDescription !== undefined) {
        fields["wikiDescription"] = body.wikiDescription;
      }
      if (body.homeBackground && VALID_HOME_BACKGROUNDS.has(body.homeBackground)) {
        fields["homeBackground"] = body.homeBackground;
      }
      if (body.homeLogo && VALID_HOME_LOGOS.has(body.homeLogo)) {
        fields["homeLogo"] = body.homeLogo;
      }

      if (Object.keys(fields).length > 0) {
        const entries = Object.entries(fields);
        await Promise.all(entries.map(([k, v]) => redis.hSet("config", { [k]: v })));
      }

      const config = await getConfig();
      res.json({ type: "config-updated", config });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to update config: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, MappingResponse | ErrorResponse>(
  "/api/mapping",
  async (_req, res): Promise<void> => {
    try {
      const text = (await redis.get("mappingText")) ?? DEFAULT_MAPPING_TEXT;
      const storedMapping = await redis.get("mappingJson");
      let mapping: Record<string, string> | null = storedMapping
        ? (JSON.parse(storedMapping) as Record<string, string>)
        : null;

      if (!mapping && text !== DEFAULT_MAPPING_TEXT) {
        const pairRegex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
        const pairs: Array<[string, string]> = [];
        let m;
        while ((m = pairRegex.exec(text)) !== null) {
          pairs.push([m[1]!, m[2]!]);
        }
        if (pairs.length > 0) {
          mapping = entriesFromPairs(pairs);
          if (mapping) {
            await redis.set("mappingJson", JSON.stringify(mapping));
          }
        }
      }

      res.json({ type: "mapping", mapping, text });
    } catch {
      res.json({ type: "mapping", mapping: null, text: DEFAULT_MAPPING_TEXT });
    }
  },
);

router.post<Record<string, never>, MappingResponse | ErrorResponse, MappingUpdateRequest>(
  "/api/mapping",
  async (req, res): Promise<void> => {
    try {
      const body = req.body as MappingUpdateRequest;
      const text = body.text ?? DEFAULT_MAPPING_TEXT;
      const mapping = body.entries ? entriesFromPairs(body.entries) : null;

      await redis.set("mappingText", text);
      if (mapping) {
        await redis.set("mappingJson", JSON.stringify(mapping));
      } else {
        await redis.del("mappingJson");
      }

      res.json({ type: "mapping", mapping, text });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to save mapping: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

const DEFAULT_LIGHT: ColorTheme = {
  accentColor: "#d93900",
  linkColor: "#d93900",
  bgColor: "#ffffff",
  textColor: "#111827",
  textMuted: "#6b7280",
  thumbBgColor: "#e5e7eb",
  controlBgColor: "#ffffff",
  controlTextColor: "#111827",
};

const DEFAULT_DARK: ColorTheme = {
  accentColor: "#ff6b3d",
  linkColor: "#ff6b3d",
  bgColor: "#1a1a1b",
  textColor: "#d7dadc",
  textMuted: "#818384",
  thumbBgColor: "#343536",
  controlBgColor: "#343536",
  controlTextColor: "#d7dadc",
};

const DEFAULT_STYLE: StyleConfig = {
  cardSize: "normal",
  wikiFontSize: "normal",
  fontFamily: "system",
  light: { ...DEFAULT_LIGHT },
  dark: { ...DEFAULT_DARK },
};

const VALID_HEX = /^#[0-9a-fA-F]{6}$/;
const VALID_CARD_SIZES = new Set<string>(["compact", "normal", "large"]);
const VALID_FONT_SIZES = new Set<string>(["small", "normal", "large"]);
const VALID_FONT_FAMILIES = new Set<string>(["system", "serif", "mono", "subreddit"]);

function getSubredditDefaults(appearance: SubredditAppearance): {
  light: ColorTheme;
  dark: ColorTheme;
  fontFamily: FontFamily;
} {
  const accent = appearance.keyColor ?? DEFAULT_LIGHT.accentColor;
  const bg = appearance.bgColor ?? DEFAULT_LIGHT.bgColor;
  const highlight = appearance.highlightColor ?? darkenHex(bg, 0.05);
  const light: ColorTheme = {
    accentColor: accent,
    linkColor: accent,
    bgColor: bg,
    textColor: "#f3f3f3",
    textMuted: "#919191",
    thumbBgColor: highlight,
    controlBgColor: highlight,
    controlTextColor: "#f3f3f3",
  };
  const darkAccent = appearance.keyColor ?? DEFAULT_DARK.accentColor;
  const dark: ColorTheme = {
    accentColor: darkAccent,
    linkColor: darkAccent,
    bgColor: appearance.bgColor ?? DEFAULT_DARK.bgColor,
    textColor: "#f3f3f3",
    textMuted: "#919191",
    thumbBgColor: appearance.highlightColor ?? DEFAULT_DARK.thumbBgColor,
    controlBgColor: appearance.highlightColor ?? DEFAULT_DARK.controlBgColor,
    controlTextColor: "#f3f3f3",
  };
  return { light, dark, fontFamily: "subreddit" };
}

function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function parseColorTheme(raw: Record<string, string>, defaults: ColorTheme): ColorTheme {
  return {
    accentColor:
      raw["accentColor"] && VALID_HEX.test(raw["accentColor"])
        ? raw["accentColor"]!
        : defaults.accentColor,
    linkColor:
      raw["linkColor"] && VALID_HEX.test(raw["linkColor"]) ? raw["linkColor"]! : defaults.linkColor,
    bgColor: raw["bgColor"] && VALID_HEX.test(raw["bgColor"]) ? raw["bgColor"]! : defaults.bgColor,
    textColor:
      raw["textColor"] && VALID_HEX.test(raw["textColor"]) ? raw["textColor"]! : defaults.textColor,
    textMuted:
      raw["textMuted"] && VALID_HEX.test(raw["textMuted"]) ? raw["textMuted"]! : defaults.textMuted,
    thumbBgColor:
      raw["thumbBgColor"] && VALID_HEX.test(raw["thumbBgColor"])
        ? raw["thumbBgColor"]!
        : defaults.thumbBgColor,
    controlBgColor:
      raw["controlBgColor"] && VALID_HEX.test(raw["controlBgColor"])
        ? raw["controlBgColor"]!
        : defaults.controlBgColor,
    controlTextColor:
      raw["controlTextColor"] && VALID_HEX.test(raw["controlTextColor"])
        ? raw["controlTextColor"]!
        : defaults.controlTextColor,
  };
}

async function getStyle(appearance?: SubredditAppearance | undefined): Promise<StyleConfig> {
  const [shared, lightRaw, darkRaw] = await Promise.all([
    redis.hGetAll("style"),
    redis.hGetAll("style:light"),
    redis.hGetAll("style:dark"),
  ]);
  const s = shared ?? {};
  const subDefaults = appearance ? getSubredditDefaults(appearance) : null;
  const lightDefaults = subDefaults?.light ?? DEFAULT_LIGHT;
  const darkDefaults = subDefaults?.dark ?? DEFAULT_DARK;
  const defaultFont = subDefaults?.fontFamily ?? DEFAULT_STYLE.fontFamily;
  return {
    cardSize:
      s["cardSize"] && VALID_CARD_SIZES.has(s["cardSize"]!)
        ? (s["cardSize"] as CardSize)
        : DEFAULT_STYLE.cardSize,
    wikiFontSize:
      s["wikiFontSize"] && VALID_FONT_SIZES.has(s["wikiFontSize"]!)
        ? (s["wikiFontSize"] as WikiFontSize)
        : DEFAULT_STYLE.wikiFontSize,
    fontFamily:
      s["fontFamily"] && VALID_FONT_FAMILIES.has(s["fontFamily"]!)
        ? (s["fontFamily"] as FontFamily)
        : defaultFont,
    light: parseColorTheme(lightRaw ?? {}, lightDefaults),
    dark: parseColorTheme(darkRaw ?? {}, darkDefaults),
  };
}

router.get<Record<string, never>, StyleResponse | ErrorResponse>(
  "/api/style",
  async (_req, res): Promise<void> => {
    try {
      const appearance = await getSubredditAppearance();
      const style = await getStyle(appearance);
      res.json({ type: "style", style });
    } catch {
      res.json({ type: "style", style: { ...DEFAULT_STYLE } });
    }
  },
);

router.post<Record<string, never>, StyleResponse | ErrorResponse, StyleUpdateRequest>(
  "/api/style",
  async (req, res): Promise<void> => {
    try {
      const body = req.body as StyleUpdateRequest;
      const appearance = await getSubredditAppearance();

      if (body.reset) {
        await Promise.all([redis.del("style"), redis.del("style:light"), redis.del("style:dark")]);
        const style = await getStyle(appearance);
        res.json({ type: "style", style });
        return;
      }

      const shared: Record<string, string> = {};
      if (body.cardSize && VALID_CARD_SIZES.has(body.cardSize)) {
        shared["cardSize"] = body.cardSize;
      }
      if (body.wikiFontSize && VALID_FONT_SIZES.has(body.wikiFontSize)) {
        shared["wikiFontSize"] = body.wikiFontSize;
      }
      if (body.fontFamily && VALID_FONT_FAMILIES.has(body.fontFamily)) {
        shared["fontFamily"] = body.fontFamily;
      }
      if (Object.keys(shared).length > 0) {
        const entries = Object.entries(shared);
        await Promise.all(entries.map(([k, v]) => redis.hSet("style", { [k]: v })));
      }

      if (body.mode === "light" || body.mode === "dark") {
        const colors: Record<string, string> = {};
        if (body.accentColor && VALID_HEX.test(body.accentColor)) {
          colors["accentColor"] = body.accentColor;
        }
        if (body.linkColor && VALID_HEX.test(body.linkColor)) {
          colors["linkColor"] = body.linkColor;
        }
        if (body.bgColor && VALID_HEX.test(body.bgColor)) {
          colors["bgColor"] = body.bgColor;
        }
        if (body.textColor && VALID_HEX.test(body.textColor)) {
          colors["textColor"] = body.textColor;
        }
        if (body.textMuted && VALID_HEX.test(body.textMuted)) {
          colors["textMuted"] = body.textMuted;
        }
        if (body.thumbBgColor && VALID_HEX.test(body.thumbBgColor)) {
          colors["thumbBgColor"] = body.thumbBgColor;
        }
        if (body.controlBgColor && VALID_HEX.test(body.controlBgColor)) {
          colors["controlBgColor"] = body.controlBgColor;
        }
        if (body.controlTextColor && VALID_HEX.test(body.controlTextColor)) {
          colors["controlTextColor"] = body.controlTextColor;
        }
        if (Object.keys(colors).length > 0) {
          const key = `style:${body.mode}`;
          const entries = Object.entries(colors);
          await Promise.all(entries.map(([k, v]) => redis.hSet(key, { [k]: v })));
        }
      }

      const style = await getStyle(appearance);
      res.json({ type: "style", style });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to update style: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, WikiPagesResponse | ErrorResponse>(
  "/api/wiki/pages",
  async (_req, res): Promise<void> => {
    try {
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({
          status: "error",
          message: "Subreddit context not available",
        });
        return;
      }
      const allPages = await reddit.getWikiPages(subreddit);
      const filtered = allPages.filter((p) => !p.startsWith("config/"));
      const toCheck = filtered.slice(0, 50);
      const results = await Promise.allSettled(
        toCheck.map((page) => reddit.getWikiPage(subreddit, page).then(() => page)),
      );
      const pages = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
      res.json({ type: "wiki-pages", pages });
    } catch {
      res.json({ type: "wiki-pages", pages: [] });
    }
  },
);

router.get<Record<string, never>, WikiResponse | ErrorResponse>(
  "/api/wiki",
  async (req, res): Promise<void> => {
    try {
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({
          status: "error",
          message: "Subreddit context not available",
        });
        return;
      }
      const pageName = (req.query["page"] as string) || "index";
      const page = await reddit.getWikiPage(subreddit, pageName);
      res.json({ type: "wiki", content: page.content });
    } catch {
      res.json({ type: "wiki", content: null });
    }
  },
);

router.post<Record<string, never>, WikiUpdateResponse | ErrorResponse, WikiUpdateRequest>(
  "/api/wiki/update",
  async (req, res): Promise<void> => {
    try {
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({
          status: "error",
          message: "Subreddit context not available",
        });
        return;
      }
      const body = req.body as WikiUpdateRequest;
      await reddit.updateWikiPage({
        subredditName: subreddit,
        page: body.page,
        content: body.content,
        reason: body.reason,
      });
      res.json({ type: "wiki-updated", page: body.page });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to update wiki: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

function normalizePostId(id: string): string {
  return id.startsWith("t3_") ? id : `t3_${id}`;
}

async function getPostIds(): Promise<string[]> {
  const legacy = await redis.get("postId");
  if (legacy) {
    const normalized = normalizePostId(legacy);
    await redis.zAdd("postIds", { member: normalized, score: Date.now() });
    await redis.del("postId");
  }
  const entries = await redis.zRange("postIds", 0, -1);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of entries) {
    const id = normalizePostId(e.member);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

async function trackPost(postId: string): Promise<void> {
  await redis.zAdd("postIds", { member: normalizePostId(postId), score: Date.now() });
}

router.post("/internal/on-app-install", async (_req, res): Promise<void> => {
  try {
    const existingIds = await getPostIds();
    if (existingIds.length > 0) {
      res.json({
        status: "success",
        message: `Post(s) already exist in subreddit ${context.subredditName}`,
      });
      return;
    }

    const sub = context.subredditName ?? "unknown";
    const post = await createPost(`EchoWiki - r/${sub}`);
    await trackPost(post.id);
    res.json({
      status: "success",
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch {
    res.status(400).json({
      status: "error",
      message: "Failed to create post",
    });
  }
});

router.post(
  "/internal/menu/post-create",
  async (_req, res: Response<UiResponse>): Promise<void> => {
    try {
      const config = await getConfig();
      const sub = context.subredditName ?? "unknown";
      const defaultTitle = config.wikiTitle || `EchoWiki - r/${sub}`;

      const trackedIds = await getPostIds();
      const verifiedIds: string[] = [];
      await Promise.all(
        trackedIds.map(async (id) => {
          try {
            const p = await reddit.getPostById(id as `t3_${string}`);
            if (!p.removed) verifiedIds.push(id);
          } catch {}
        }),
      );

      res.json({
        showForm: {
          name: "postTitleForm",
          form: {
            title: "Create EchoWiki Post",
            fields: [
              {
                type: "string" as const,
                name: "postTitle",
                label: "Post title",
                required: true,
                defaultValue: defaultTitle,
              },
              {
                type: "string" as const,
                name: "subtitle",
                label: "Subtitle (optional)",
                helpText: "Shown on the home screen below the title",
                defaultValue: config.wikiDescription || "",
              },
              {
                type: "string" as const,
                name: "gameName",
                label: "Game name (optional)",
                helpText: "Shown on import. Warns if imported game doesn't match",
                defaultValue: config.gameName || "",
              },
              {
                label: "Post options",
                type: "group" as const,
                fields: [
                  {
                    type: "boolean" as const,
                    name: "addWidget",
                    label: "Add sidebar widget linking to the post",
                    defaultValue: true,
                  },
                  {
                    type: "boolean" as const,
                    name: "lockComments",
                    label: "Lock comments",
                    defaultValue: false,
                  },
                ],
              },
              ...(verifiedIds.length > 0
                ? [
                    {
                      type: "boolean" as const,
                      name: "deleteExisting",
                      label: `Delete ${verifiedIds.length} existing post(s)`,
                      defaultValue: false,
                    },
                  ]
                : []),
            ],
            acceptLabel: "Create",
          },
        },
      });
    } catch {
      res.json({ showToast: "Failed to load form" });
    }
  },
);

type PostCreateFormData = {
  postTitle: string;
  subtitle?: string;
  gameName?: string;
  addWidget?: boolean;
  lockComments?: boolean;
  deleteExisting?: boolean;
};

router.post(
  "/internal/form/post-title-submit",
  async (req, res: Response<UiResponse>): Promise<void> => {
    try {
      const body = req.body as PostCreateFormData;

      if (body.deleteExisting) {
        const existingIds = await getPostIds();
        for (const id of existingIds) {
          try {
            const fullId = id.startsWith("t3_") ? id : `t3_${id}`;
            const existingPost = await reddit.getPostById(fullId as `t3_${string}`);
            await existingPost.delete();
          } catch {
            try {
              const fullId = id.startsWith("t3_") ? id : `t3_${id}`;
              const existingPost = await reddit.getPostById(fullId as `t3_${string}`);
              await existingPost.remove();
            } catch {}
          }
        }
        await redis.del("postIds");
      }

      const post = await createPost(body.postTitle);
      await trackPost(post.id);

      const warnings: string[] = [];

      if (body.lockComments) {
        try {
          await post.lock();
        } catch {
          warnings.push("Could not lock comments");
        }
      }

      if (body.addWidget && context.subredditName) {
        const postUrl = `https://www.reddit.com/r/${context.subredditName}/comments/${post.id.replace("t3_", "")}`;
        try {
          await reddit.addWidget({
            type: "button",
            subreddit: context.subredditName,
            shortName: "Links",
            description: "",
            buttons: [
              {
                kind: "text",
                text: body.postTitle,
                url: postUrl,
                color: "#FFFFFF",
                textColor: "#000000",
                fillColor: "#FFFFFF",
              },
            ],
          });
        } catch {
          warnings.push("Could not add sidebar widget");
        }
      }

      const configFields: Record<string, string> = { wikiTitle: body.postTitle };
      if (body.subtitle !== undefined) configFields["wikiDescription"] = body.subtitle;
      if (body.gameName !== undefined) configFields["gameName"] = body.gameName;
      await Promise.all(
        Object.entries(configFields).map(([k, v]) => redis.hSet("config", { [k]: v })),
      );

      const parts = [body.deleteExisting ? "Old posts deleted." : "", "EchoWiki post created!"];
      if (warnings.length > 0) parts.push(`(${warnings.join(", ")})`);

      res.json({
        showToast: {
          text: parts.filter(Boolean).join(" "),
          appearance: warnings.length > 0 ? "neutral" : "success",
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.json({ showToast: `Failed to create post: ${msg}` });
    }
  },
);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.listen(port);
