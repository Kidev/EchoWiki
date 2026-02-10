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
  InitResponse,
  MappingResponse,
  MappingUpdateRequest,
  StyleConfig,
  StyleResponse,
  StyleUpdateRequest,
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
  storeLink: "",
  engine: "auto",
  encryptionKey: "",
};

const DEFAULT_MAPPING_TEXT = '"original_filename": "mapped_filename"';

async function getConfig(): Promise<GameConfig> {
  const raw = await redis.hGetAll("config");
  if (!raw || Object.keys(raw).length === 0) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    gameName: raw["gameName"] ?? DEFAULT_CONFIG.gameName,
    storeLink: raw["storeLink"] ?? DEFAULT_CONFIG.storeLink,
    engine: (raw["engine"] as GameConfig["engine"]) ?? DEFAULT_CONFIG.engine,
    encryptionKey: raw["encryptionKey"] ?? DEFAULT_CONFIG.encryptionKey,
  };
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
      const [config, username] = await Promise.all([getConfig(), reddit.getCurrentUsername()]);

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
      if (body.storeLink !== undefined) {
        fields["storeLink"] = body.storeLink;
      }
      if (body.engine !== undefined) {
        fields["engine"] = body.engine;
      }
      if (body.encryptionKey !== undefined) {
        fields["encryptionKey"] = body.encryptionKey;
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
  bgColor: "#ffffff",
  textColor: "#111827",
  textMuted: "#6b7280",
  thumbBgColor: "#e5e7eb",
  controlBgColor: "#ffffff",
  controlTextColor: "#111827",
};

const DEFAULT_DARK: ColorTheme = {
  accentColor: "#ff6b3d",
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
const VALID_FONT_FAMILIES = new Set<string>(["system", "serif", "mono"]);

function parseColorTheme(raw: Record<string, string>, defaults: ColorTheme): ColorTheme {
  return {
    accentColor:
      raw["accentColor"] && VALID_HEX.test(raw["accentColor"])
        ? raw["accentColor"]!
        : defaults.accentColor,
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

async function getStyle(): Promise<StyleConfig> {
  const [shared, lightRaw, darkRaw] = await Promise.all([
    redis.hGetAll("style"),
    redis.hGetAll("style:light"),
    redis.hGetAll("style:dark"),
  ]);
  const s = shared ?? {};
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
        : DEFAULT_STYLE.fontFamily,
    light: parseColorTheme(lightRaw ?? {}, DEFAULT_LIGHT),
    dark: parseColorTheme(darkRaw ?? {}, DEFAULT_DARK),
  };
}

router.get<Record<string, never>, StyleResponse | ErrorResponse>(
  "/api/style",
  async (_req, res): Promise<void> => {
    try {
      const style = await getStyle();
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

      const style = await getStyle();
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

router.post("/internal/on-app-install", async (_req, res): Promise<void> => {
  try {
    const existing = await redis.get("postId");
    if (existing) {
      res.json({
        status: "success",
        message: `Post already exists in subreddit ${context.subredditName} with id ${existing}`,
      });
      return;
    }

    const post = await createPost();
    await redis.set("postId", post.id);
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
      const post = await createPost();
      await redis.set("postId", post.id);
      res.json({
        showToast: {
          text: "EchoWiki post created!",
          appearance: "success",
        },
      });
    } catch {
      res.json({
        showToast: "Failed to create post",
      });
    }
  },
);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.listen(port);
