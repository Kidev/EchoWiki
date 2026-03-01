import express from "express";
import type { Response } from "express";
import type {
  AdvancedContributorRequest,
  AdvancedContributorResponse,
  CardSize,
  CastVoteRequest,
  CastVoteResponse,
  CollabInfoResponse,
  ColorTheme,
  ConfigResponse,
  ConfigUpdateRequest,
  ConfigUpdateResponse,
  EquipFlairRequest,
  EquipFlairResponse,
  ErrorResponse,
  FlairTemplateInfo,
  FontFamily,
  GameConfig,
  HomeBackground,
  HomeLogo,
  InitResponse,
  MappingResponse,
  MappingUpdateRequest,
  MyFlairsResponse,
  StyleConfig,
  StyleResponse,
  StyleUpdateRequest,
  SubredditAppearance,
  SuggestionAuthorInfo,
  SuggestionFlairRequest,
  SuggestionFlairResponse,
  VoteStatusData,
  VoteStatus,
  VoteValue,
  VoteEntry,
  VotingInitResponse,
  WikiFontSize,
  WikiPagesResponse,
  WikiSuggestion,
  WikiSuggestionActionRequest,
  WikiSuggestionActionResponse,
  WikiSuggestionRequest,
  WikiSuggestionResponse,
  WikiSuggestionWithVoting,
  WikiSuggestionsResponse,
  WikiBanRequest,
  WikiBanResponse,
  WikiBansResponse,
  WikiResponse,
  WikiUpdateRequest,
  WikiUpdateResponse,
} from "../shared/types/api";
import type { UiResponse } from "@devvit/web/shared";
import type { TaskRequest, TaskResponse, ScheduledJob } from "@devvit/web/server";
import { redis, reddit, createServer, context, getServerPort, scheduler } from "@devvit/web/server";
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
  collaborativeMode: false,
  minKarma: 0,
  minAccountAgeDays: 0,
  votingEnabled: false,
  votingAcceptThreshold: 100,
  votingRejectThreshold: 0,
  votingPercentThreshold: 0,
  votingDurationDays: 0,
  votingAllowVoteChange: true,
  votingChangeCooldownMinutes: 0,
  votingShowVoterNames: true,
  votingVoterMinKarma: 0,
  votingVoterMinAccountAgeDays: 0,
  votingPostTitle: "[WIKI] Vote: %user% suggests changes to the page %shortPathPage%",
  votingFlairTemplateId: null,
  votingMinVotersForTiming: 0,
  votingMaxSuggestionEdits: 1,
  suggestionEditCooldownMinutes: 0,
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
    collaborativeMode: raw["collaborativeMode"] === "true",
    minKarma: Math.max(0, parseInt(raw["minKarma"] ?? "0", 10) || 0),
    minAccountAgeDays: Math.max(0, parseInt(raw["minAccountAgeDays"] ?? "0", 10) || 0),
    votingEnabled: raw["votingEnabled"] === "true",
    votingAcceptThreshold: Math.max(0, parseInt(raw["votingAcceptThreshold"] ?? "100", 10) || 100),
    votingRejectThreshold: Math.max(0, parseInt(raw["votingRejectThreshold"] ?? "0", 10) || 0),
    votingPercentThreshold: Math.min(
      100,
      Math.max(0, parseInt(raw["votingPercentThreshold"] ?? "0", 10) || 0),
    ),
    votingDurationDays: Math.max(0, parseInt(raw["votingDurationDays"] ?? "0", 10) || 0),
    votingAllowVoteChange: raw["votingAllowVoteChange"] !== "false",
    votingChangeCooldownMinutes: Math.max(
      0,
      parseInt(raw["votingChangeCooldownMinutes"] ?? "0", 10) || 0,
    ),
    votingShowVoterNames: raw["votingShowVoterNames"] !== "false",
    votingVoterMinKarma: Math.max(0, parseInt(raw["votingVoterMinKarma"] ?? "0", 10) || 0),
    votingVoterMinAccountAgeDays: Math.max(
      0,
      parseInt(raw["votingVoterMinAccountAgeDays"] ?? "0", 10) || 0,
    ),
    votingPostTitle: raw["votingPostTitle"] ?? DEFAULT_CONFIG.votingPostTitle,
    votingFlairTemplateId: raw["votingFlairTemplateId"] || null,
    votingMinVotersForTiming: Math.max(
      0,
      parseInt(raw["votingMinVotersForTiming"] ?? "0", 10) || 0,
    ),
    votingMaxSuggestionEdits: Math.max(
      0,
      parseInt(raw["votingMaxSuggestionEdits"] ?? "1", 10) || 0,
    ),
    suggestionEditCooldownMinutes: Math.max(
      0,
      parseInt(raw["suggestionEditCooldownMinutes"] ?? "0", 10) || 0,
    ),
  };
}

async function getModLevel(username: string): Promise<"config" | "wiki" | null> {
  if (!context.subredditName) return null;
  try {
    const mods = reddit.getModerators({ subredditName: context.subredditName, username });
    const modList = await mods.all();
    if (modList.length === 0) return null;
    const mod = modList[0]!;
    const perms = await mod.getModPermissionsForSubreddit(context.subredditName);
    if (perms.includes("all") || perms.includes("config")) return "config";
    if (perms.includes("wiki")) return "wiki";
    return null;
  } catch {
    return null;
  }
}

async function checkIsMod(username: string): Promise<boolean> {
  return (await getModLevel(username)) !== null;
}

async function checkIsAllMod(username: string): Promise<boolean> {
  return (await getModLevel(username)) === "config";
}

async function checkEligibility(
  username: string,
  minKarma: number,
  minAccountAgeDays: number,
): Promise<boolean> {
  if (minKarma === 0 && minAccountAgeDays === 0) return true;
  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return true;
    if (minKarma > 0) {
      const totalKarma = user.linkKarma + user.commentKarma;
      if (totalKarma < minKarma) return false;
    }
    if (minAccountAgeDays > 0) {
      const ageMs = Date.now() - user.createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < minAccountAgeDays) return false;
    }
    return true;
  } catch {
    return true;
  }
}

function capitalizeWords(str: string): string {
  return str
    .split("/")
    .map((seg) =>
      seg
        .split(" ")
        .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
        .join(" "),
    )
    .join("/");
}

function expandVotingTitle(template: string, username: string, page: string): string {
  const pathPage = capitalizeWords(page.replace(/_/g, " "));
  const parts = pathPage.split("/");
  const shortPathPage = parts.length > 1 ? parts.slice(1).join("/") : pathPage;
  const capPage = page
    .split("/")
    .map((seg) =>
      seg
        .split("_")
        .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
        .join("_"),
    )
    .join("/");
  return template
    .replace(/%user%/g, username)
    .replace(/%page%/g, capPage)
    .replace(/%pathPage%/g, pathPage)
    .replace(/%shortPathPage%/g, shortPathPage);
}

async function appendBotComment(
  votingPostId: string,
  listEntry: string,
  newStatus?: string | undefined,
): Promise<void> {
  const idKey = `votingBotCommentId:${votingPostId}`;
  const listKey = `votingBotCommentList:${votingPostId}`;
  const statusKey = `votingBotCommentStatus:${votingPostId}`;
  const [existingId, existingListRaw, existingStatus] = await Promise.all([
    redis.get(idKey).catch(() => null),
    redis.get(listKey).catch(() => null),
    redis.get(statusKey).catch(() => null),
  ]);
  const entries: string[] = existingListRaw ? (JSON.parse(existingListRaw) as string[]) : [];
  entries.push(listEntry);
  const status = newStatus ?? existingStatus ?? "Active";
  const newText = `# [WIKI] Vote status: ${status}\n\n- ${entries.join("\n- ")}`;
  await Promise.all([redis.set(listKey, JSON.stringify(entries)), redis.set(statusKey, status)]);
  if (existingId) {
    try {
      const comment = await reddit.getCommentById(existingId as `t1_${string}`);
      await comment.edit({ text: newText });
      return;
    } catch {}
  }
  try {
    const comment = await reddit.submitComment({
      id: votingPostId as `t3_${string}`,
      text: newText,
    });
    await comment.distinguish(true);
    await redis.set(idKey, comment.id);
  } catch (err) {
    console.error("Failed to create bot comment:", err);
  }
}

async function getVoterEligibilityInfo(
  username: string,
  config: GameConfig,
): Promise<{ eligible: boolean; reason: string | null }> {
  if (config.votingVoterMinKarma === 0 && config.votingVoterMinAccountAgeDays === 0) {
    return { eligible: true, reason: null };
  }
  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return { eligible: true, reason: null };
    const karma = user.linkKarma + user.commentKarma;
    if (config.votingVoterMinKarma > 0 && karma < config.votingVoterMinKarma) {
      return {
        eligible: false,
        reason: `Insufficient karma: you have ${karma.toLocaleString()} but need at least ${config.votingVoterMinKarma.toLocaleString()}.`,
      };
    }
    const ageDays = Math.floor((Date.now() - user.createdAt.getTime()) / 86400000);
    if (config.votingVoterMinAccountAgeDays > 0 && ageDays < config.votingVoterMinAccountAgeDays) {
      return {
        eligible: false,
        reason: `Account too new: your account is ${ageDays} day${ageDays !== 1 ? "s" : ""} old but needs to be at least ${config.votingVoterMinAccountAgeDays} days old.`,
      };
    }
    return { eligible: true, reason: null };
  } catch {
    return { eligible: true, reason: null };
  }
}

async function checkVoterEligibility(username: string, config: GameConfig): Promise<boolean> {
  const info = await getVoterEligibilityInfo(username, config);
  return info.eligible;
}

async function getVoteStatus(
  username: string,
  config: GameConfig,
  callerUsername: string,
  isMod: boolean,
): Promise<VoteStatus> {
  const [statusRaw, votesRaw] = await Promise.all([
    redis.get(`voteStatus:${username}`).catch(() => null),
    redis.hGetAll(`votes:${username}`).catch(() => null),
  ]);

  const statusData: VoteStatusData = statusRaw
    ? (JSON.parse(statusRaw) as VoteStatusData)
    : { status: "active", decidedAt: null, reason: null };

  const votes = votesRaw ?? {};
  let acceptCount = 0;
  let rejectCount = 0;
  const voteEntries: VoteEntry[] = [];

  for (const [voter, raw] of Object.entries(votes)) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx === -1) continue;
    const voteType = raw.slice(0, colonIdx) as VoteValue;
    const votedAt = parseInt(raw.slice(colonIdx + 1), 10);
    if (voteType === "accept") acceptCount++;
    else if (voteType === "reject") rejectCount++;
    const showVoter = config.votingShowVoterNames || isMod || callerUsername === username;
    voteEntries.push({ username: showVoter ? voter : "", vote: voteType, votedAt });
  }

  return {
    ...statusData,
    acceptCount,
    rejectCount,
    totalVoters: acceptCount + rejectCount,
    votes: voteEntries,
  };
}

function getVoteReasonText(reason: VoteStatusData["reason"]): string {
  switch (reason) {
    case "threshold_accept":
      return "accept vote threshold reached";
    case "threshold_reject":
      return "reject vote threshold reached";
    case "percent_time":
      return "voting deadline reached";
    case "mod_override":
      return "decided by moderator";
    case "cancelled":
      return "suggestion was withdrawn";
    default:
      return "vote concluded";
  }
}

async function performAcceptCore(
  username: string,
  subredditName: string,
  actorLabel: string,
): Promise<void> {
  const raw = await redis.get(`suggestion:${username}`);
  if (!raw) return;
  const suggestion = JSON.parse(raw) as WikiSuggestion;
  await reddit.updateWikiPage({
    subredditName,
    page: suggestion.page,
    content: suggestion.content,
    reason: `${actorLabel} accepted suggestion by ${suggestion.username}: ${suggestion.description}`,
  });
  const [, , newCount, basicFlairId, advCountRaw, advFlairId] = await Promise.all([
    redis.del(`suggestion:${username}`),
    redis.zRem("suggestions", [username]),
    redis.incrBy(`acceptedCount:${suggestion.username}`, 1),
    redis.get("suggestionFlairTemplateId").catch(() => null),
    redis.get("advancedContributorCount").catch(() => null),
    redis.get("advancedContributorFlairTemplateId").catch(() => null),
  ]);
  const advancedCount = Math.max(0, parseInt(advCountRaw ?? "0", 10) || 0);
  const earnedKey = `earnedFlairIds:${suggestion.username}`;
  try {
    const rawEarned = await redis.get(earnedKey);
    const earnedIds: string[] = rawEarned ? (JSON.parse(rawEarned) as string[]) : [];
    if (basicFlairId && !earnedIds.includes(basicFlairId)) {
      earnedIds.push(basicFlairId);
    }
    if (
      advancedCount > 0 &&
      newCount >= advancedCount &&
      advFlairId &&
      !earnedIds.includes(advFlairId)
    ) {
      earnedIds.push(advFlairId);
    }
    if (earnedIds.length > 0) {
      await redis.set(earnedKey, JSON.stringify(earnedIds));
    }
  } catch {}
}

async function cleanupVotingPost(
  username: string,
  outcome: "accepted" | "rejected",
  reason: VoteStatusData["reason"],
  votingPostId: string,
  concludedSuggestion?: WikiSuggestion | null | undefined,
  concludedAcceptCount?: number | undefined,
  concludedRejectCount?: number | undefined,
): Promise<void> {
  const decidedAt = Date.now();
  await redis.set(`voteStatus:${username}`, JSON.stringify({ status: outcome, decidedAt, reason }));

  const existingRaw = await redis.get(`votingPost:${votingPostId}`).catch(() => null);
  const baseData = existingRaw
    ? (JSON.parse(existingRaw) as { username: string; subredditName: string })
    : { username, subredditName: "" };

  await Promise.all([
    redis.set(
      `votingPost:${votingPostId}`,
      JSON.stringify({
        ...baseData,
        concluded: true,
        status: outcome,
        decidedAt,
        reason,
        ...(concludedSuggestion
          ? {
              suggestion: {
                page: concludedSuggestion.page,
                content: concludedSuggestion.content,
                description: concludedSuggestion.description,
                createdAt: concludedSuggestion.createdAt,
                previousDescriptions: concludedSuggestion.previousDescriptions,
              },
            }
          : {}),
        ...(concludedAcceptCount !== undefined ? { acceptCount: concludedAcceptCount } : {}),
        ...(concludedRejectCount !== undefined ? { rejectCount: concludedRejectCount } : {}),
      }),
    ),
    redis.del(`votingPostId:${username}`),
    redis.del(`votes:${username}`),
  ]);

  const outcomeText = outcome === "accepted" ? "**ACCEPTED**" : "**REJECTED**";
  const reasonText = getVoteReasonText(reason);
  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  await appendBotComment(
    votingPostId,
    `**Vote decided** on ${dateStr}: **${reasonText}**`,
    outcomeText,
  );
  try {
    const post = await reddit.getPostById(votingPostId as `t3_${string}`);
    await post.lock();
  } catch (err) {
    console.error("Failed to lock voting post:", err);
  }
  const jobId = await redis.get(`voteJobId:${username}`).catch(() => null);
  if (jobId) {
    try {
      await scheduler.cancelJob(jobId);
    } catch {}
    await redis.del(`voteJobId:${username}`);
  }
}

async function finalizeVote(
  username: string,
  outcome: "accepted" | "rejected",
  reason: VoteStatusData["reason"],
  votingPostId: string,
  subredditName: string,
): Promise<void> {
  const [suggestionRaw, votesRaw] = await Promise.all([
    redis.get(`suggestion:${username}`).catch(() => null),
    redis.hGetAll(`votes:${username}`).catch(() => null),
  ]);
  const concludedSuggestion = suggestionRaw ? (JSON.parse(suggestionRaw) as WikiSuggestion) : null;
  let concludedAcceptCount = 0;
  let concludedRejectCount = 0;
  for (const v of Object.values(votesRaw ?? {})) {
    const colonIdx = v.indexOf(":");
    if (colonIdx < 0) continue;
    const voteType = v.slice(0, colonIdx);
    if (voteType === "accept") concludedAcceptCount++;
    else if (voteType === "reject") concludedRejectCount++;
  }

  if (outcome === "accepted") {
    await performAcceptCore(username, subredditName, "vote");
  } else {
    await Promise.all([redis.del(`suggestion:${username}`), redis.zRem("suggestions", [username])]);
  }
  await cleanupVotingPost(
    username,
    outcome,
    reason,
    votingPostId,
    concludedSuggestion,
    concludedAcceptCount,
    concludedRejectCount,
  );
}

async function checkAndMaybeFinalize(
  username: string,
  config: GameConfig,
  votingPostId: string,
  subredditName: string,
): Promise<void> {
  const statusRaw = await redis.get(`voteStatus:${username}`).catch(() => null);
  if (statusRaw) {
    const statusData = JSON.parse(statusRaw) as VoteStatusData;
    if (statusData.status !== "active") return;
  }

  const votesRaw = await redis.hGetAll(`votes:${username}`).catch(() => null);
  const votes = votesRaw ?? {};
  let acceptCount = 0;
  let rejectCount = 0;
  for (const raw of Object.values(votes)) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx < 0) continue;
    const voteType = raw.slice(0, colonIdx);
    if (voteType === "accept") acceptCount++;
    else if (voteType === "reject") rejectCount++;
  }

  if (config.votingRejectThreshold > 0 && rejectCount >= config.votingRejectThreshold) {
    await finalizeVote(username, "rejected", "threshold_reject", votingPostId, subredditName);
    return;
  }
  if (config.votingAcceptThreshold > 0 && acceptCount >= config.votingAcceptThreshold) {
    await finalizeVote(username, "accepted", "threshold_accept", votingPostId, subredditName);
    return;
  }
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

router.get<Record<string, never>, InitResponse | VotingInitResponse | ErrorResponse>(
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

      let modLevel: "config" | "wiki" | null = null;
      if (username) {
        modLevel = await getModLevel(username);
      }
      const isMod = modLevel !== null;

      // Check if this is a voting post
      const votingPostRaw = await redis.get(`votingPost:${postId}`).catch(() => null);
      if (votingPostRaw) {
        type VotingPostData = {
          username: string;
          subredditName: string;
          concluded?: boolean;
          status?: "accepted" | "rejected" | "cancelled";
          decidedAt?: number;
          reason?: VoteStatusData["reason"];
          suggestion?: {
            page: string;
            content: string;
            description: string;
            createdAt: number;
            previousDescriptions?: string[];
          };
          acceptCount?: number;
          rejectCount?: number;
        };
        const votingPostData = JSON.parse(votingPostRaw) as VotingPostData;
        const { username: suggestionUsername } = votingPostData;
        const subreddit = context.subredditName ?? "";

        let suggestionAuthorInfo: SuggestionAuthorInfo | null = null;
        try {
          const [authorUser, acceptedRaw] = await Promise.all([
            reddit.getUserByUsername(suggestionUsername).catch(() => undefined),
            redis.get(`acceptedCount:${suggestionUsername}`).catch(() => null),
          ]);
          if (authorUser) {
            suggestionAuthorInfo = {
              karma: authorUser.linkKarma + authorUser.commentKarma,
              accountAgeDays: Math.floor(
                (Date.now() - authorUser.createdAt.getTime()) / (1000 * 60 * 60 * 24),
              ),
              acceptedContributions: acceptedRaw ? parseInt(acceptedRaw, 10) || 0 : 0,
            };
          }
        } catch {}

        const raw = await redis.get(`suggestion:${suggestionUsername}`);
        if (!raw) {
          let voteStatus: VoteStatus;
          if (votingPostData.concluded && votingPostData.status) {
            const storedAccept = votingPostData.acceptCount ?? 0;
            const storedReject = votingPostData.rejectCount ?? 0;
            voteStatus = {
              status: votingPostData.status,
              decidedAt: votingPostData.decidedAt ?? null,
              reason: votingPostData.reason ?? null,
              acceptCount: storedAccept,
              rejectCount: storedReject,
              totalVoters: storedAccept + storedReject,
              votes: [],
            };
          } else {
            voteStatus = await getVoteStatus(
              suggestionUsername,
              config,
              username ?? "anonymous",
              isMod,
            );
          }

          let placeholder: WikiSuggestion;
          let concludedContent = "";
          if (votingPostData.suggestion) {
            placeholder = {
              username: suggestionUsername,
              page: votingPostData.suggestion.page,
              content: votingPostData.suggestion.content,
              description: votingPostData.suggestion.description,
              createdAt: votingPostData.suggestion.createdAt,
              ...(votingPostData.suggestion.previousDescriptions !== undefined
                ? { previousDescriptions: votingPostData.suggestion.previousDescriptions }
                : {}),
            };
            try {
              const wikiPage = await reddit.getWikiPage(subreddit, placeholder.page);
              concludedContent = wikiPage.content;
            } catch {}
          } else {
            placeholder = {
              username: suggestionUsername,
              page: "",
              content: "",
              description: "",
              createdAt: 0,
            };
          }
          res.json({
            type: "voting-init",
            postId,
            subredditName: subreddit,
            username: username ?? "anonymous",
            modLevel,
            config,
            appearance,
            suggestion: placeholder,
            currentContent: concludedContent,
            voteStatus,
            canVote: false,
            myVote: null,
            voteIneligibleReason: null,
            suggestionAuthorInfo,
          } as VotingInitResponse);
          return;
        }

        const suggestion = JSON.parse(raw) as WikiSuggestion;

        let currentContent = "";
        try {
          const wikiPage = await reddit.getWikiPage(subreddit, suggestion.page);
          currentContent = wikiPage.content;
        } catch {}

        const voteStatus = await getVoteStatus(
          suggestionUsername,
          config,
          username ?? "anonymous",
          isMod,
        );

        let canVote = false;
        let voteIneligibleReason: string | null = null;
        if (!username || username === "anonymous") {
          voteIneligibleReason = "You must be logged in to vote.";
        } else if (username === suggestionUsername) {
          voteIneligibleReason = "You cannot vote on your own suggestion.";
        } else if (voteStatus.status !== "active") {
          voteIneligibleReason = null;
        } else {
          let banned = false;
          try {
            const bannedList = await reddit
              .getBannedWikiContributors({ subredditName: subreddit, username })
              .all()
              .catch(() => []);
            banned = bannedList.length > 0;
          } catch {}
          if (banned) {
            voteIneligibleReason = "You are banned from this wiki.";
          } else {
            const eligInfo = await getVoterEligibilityInfo(username, config);
            if (!eligInfo.eligible) {
              voteIneligibleReason = eligInfo.reason;
            } else {
              canVote = true;
            }
          }
        }

        let myVote: VoteValue | null = null;
        if (username && username !== "anonymous") {
          const voteRaw = await redis
            .hGet(`votes:${suggestionUsername}`, username)
            .catch(() => null);
          if (voteRaw) {
            const colonIdx = voteRaw.indexOf(":");
            myVote = colonIdx >= 0 ? (voteRaw.slice(0, colonIdx) as VoteValue) : null;
          }
        }

        res.json({
          type: "voting-init",
          postId,
          subredditName: subreddit,
          username: username ?? "anonymous",
          modLevel,
          config,
          appearance,
          suggestion,
          currentContent,
          voteStatus,
          canVote,
          myVote,
          voteIneligibleReason,
          suggestionAuthorInfo,
        } as VotingInitResponse);
        return;
      }

      let canSuggest = false;
      if (config.collaborativeMode && username && username !== "anonymous" && !isMod) {
        try {
          const subredditName = context.subredditName ?? "";
          const bannedList = await reddit
            .getBannedWikiContributors({ subredditName, username })
            .all()
            .catch(() => []);
          if (bannedList.length > 0) {
            canSuggest = false;
          } else {
            canSuggest = await checkEligibility(
              username,
              config.minKarma,
              config.minAccountAgeDays,
            );
          }
        } catch {
          canSuggest = true;
        }
      }

      res.json({
        type: "init",
        postId,
        subredditName: context.subredditName ?? "",
        username: username ?? "anonymous",
        modLevel,
        config,
        appearance,
        collaborativeMode: config.collaborativeMode,
        canSuggest,
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
      const configUsername = await reddit.getCurrentUsername();
      if (!configUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const isAllMod = await checkIsAllMod(configUsername);
      if (!isAllMod) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
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
      if (body.collaborativeMode !== undefined) {
        fields["collaborativeMode"] = body.collaborativeMode ? "true" : "false";
      }
      if (body.minKarma !== undefined) {
        fields["minKarma"] = String(Math.max(0, Math.floor(body.minKarma)));
      }
      if (body.minAccountAgeDays !== undefined) {
        fields["minAccountAgeDays"] = String(Math.max(0, Math.floor(body.minAccountAgeDays)));
      }
      if (body.votingEnabled !== undefined) {
        fields["votingEnabled"] = body.votingEnabled ? "true" : "false";
      }
      if (body.votingAcceptThreshold !== undefined) {
        fields["votingAcceptThreshold"] = String(
          Math.max(0, Math.floor(body.votingAcceptThreshold)),
        );
      }
      if (body.votingRejectThreshold !== undefined) {
        fields["votingRejectThreshold"] = String(
          Math.max(0, Math.floor(body.votingRejectThreshold)),
        );
      }
      if (body.votingPercentThreshold !== undefined) {
        fields["votingPercentThreshold"] = String(
          Math.min(100, Math.max(0, Math.floor(body.votingPercentThreshold))),
        );
      }
      if (body.votingDurationDays !== undefined) {
        fields["votingDurationDays"] = String(Math.max(0, Math.floor(body.votingDurationDays)));
      }
      if (body.votingAllowVoteChange !== undefined) {
        fields["votingAllowVoteChange"] = body.votingAllowVoteChange ? "true" : "false";
      }
      if (body.votingChangeCooldownMinutes !== undefined) {
        fields["votingChangeCooldownMinutes"] = String(
          Math.max(0, Math.floor(body.votingChangeCooldownMinutes)),
        );
      }
      if (body.votingShowVoterNames !== undefined) {
        fields["votingShowVoterNames"] = body.votingShowVoterNames ? "true" : "false";
      }
      if (body.votingVoterMinKarma !== undefined) {
        fields["votingVoterMinKarma"] = String(Math.max(0, Math.floor(body.votingVoterMinKarma)));
      }
      if (body.votingVoterMinAccountAgeDays !== undefined) {
        fields["votingVoterMinAccountAgeDays"] = String(
          Math.max(0, Math.floor(body.votingVoterMinAccountAgeDays)),
        );
      }
      if (body.votingPostTitle !== undefined) {
        fields["votingPostTitle"] = body.votingPostTitle;
      }
      if (body.votingFlairTemplateId !== undefined) {
        fields["votingFlairTemplateId"] = body.votingFlairTemplateId ?? "";
      }
      if (body.votingMinVotersForTiming !== undefined) {
        fields["votingMinVotersForTiming"] = String(
          Math.max(0, Math.floor(body.votingMinVotersForTiming)),
        );
      }
      if (body.votingMaxSuggestionEdits !== undefined) {
        fields["votingMaxSuggestionEdits"] = String(
          Math.max(0, Math.floor(body.votingMaxSuggestionEdits)),
        );
      }
      if (body.suggestionEditCooldownMinutes !== undefined) {
        fields["suggestionEditCooldownMinutes"] = String(
          Math.max(0, Math.floor(body.suggestionEditCooldownMinutes)),
        );
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
      const updatingUsername = await reddit.getCurrentUsername();
      if (!updatingUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const canUpdate = await checkIsMod(updatingUsername);
      if (!canUpdate) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
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

router.get<Record<string, never>, WikiSuggestionResponse | ErrorResponse>(
  "/api/wiki/suggestion",
  async (_req, res): Promise<void> => {
    try {
      const username = await reddit.getCurrentUsername();
      if (!username) {
        res.json({ type: "wiki-suggestion", suggestion: null });
        return;
      }
      const raw = await redis.get(`suggestion:${username}`);
      const suggestion = raw ? (JSON.parse(raw) as WikiSuggestion) : null;
      res.json({ type: "wiki-suggestion", suggestion });
    } catch {
      res.json({ type: "wiki-suggestion", suggestion: null });
    }
  },
);

router.post<Record<string, never>, WikiSuggestionResponse | ErrorResponse, WikiSuggestionRequest>(
  "/api/wiki/suggestion",
  async (req, res): Promise<void> => {
    try {
      const username = await reddit.getCurrentUsername();
      if (!username) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const config = await getConfig();
      if (!config.collaborativeMode) {
        res.status(403).json({ status: "error", message: "Collaborative mode is not enabled." });
        return;
      }

      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({ status: "error", message: "Subreddit context not available" });
        return;
      }

      const body = req.body as WikiSuggestionRequest;

      if (!body.description || body.description.trim().length < 10) {
        res
          .status(400)
          .json({ status: "error", message: "Description must be at least 10 characters." });
        return;
      }

      const isMod = await checkIsMod(username);

      if (!isMod) {
        const bannedList = await reddit
          .getBannedWikiContributors({ subredditName: subreddit, username })
          .all()
          .catch(() => []);

        if (bannedList.length > 0) {
          res
            .status(403)
            .json({ status: "error", message: "You are banned from editing this wiki." });
          return;
        }

        const eligible = await checkEligibility(
          username,
          config.minKarma,
          config.minAccountAgeDays,
        );
        if (!eligible) {
          const parts: string[] = [];
          if (config.minKarma > 0) parts.push(`${config.minKarma.toLocaleString()} karma`);
          if (config.minAccountAgeDays > 0)
            parts.push(`account at least ${config.minAccountAgeDays} days old`);
          res.status(403).json({
            status: "error",
            message: `You don't meet the requirements to suggest changes: ${parts.join(" and ")}.`,
          });
          return;
        }
      }

      const existingRaw = await redis.get(`suggestion:${username}`).catch(() => null);
      const existingSuggestion = existingRaw ? (JSON.parse(existingRaw) as WikiSuggestion) : null;

      if (existingSuggestion && config.votingMaxSuggestionEdits > 0) {
        const currentEdits = existingSuggestion.editCount ?? 0;
        if (currentEdits >= config.votingMaxSuggestionEdits) {
          const n = config.votingMaxSuggestionEdits;
          res.status(403).json({
            status: "error",
            message: `You've reached the maximum of ${n} update${n !== 1 ? "s" : ""} for this suggestion.`,
          });
          return;
        }
      }

      const now = Date.now();

      if (existingSuggestion && config.suggestionEditCooldownMinutes > 0) {
        const lastEditAt = existingSuggestion.lastEditAt ?? existingSuggestion.createdAt;
        const elapsedMinutes = (now - lastEditAt) / 60000;
        if (elapsedMinutes < config.suggestionEditCooldownMinutes) {
          const remaining = Math.ceil(config.suggestionEditCooldownMinutes - elapsedMinutes);
          res.status(429).json({
            status: "error",
            message: `Edit cooldown: ${remaining} minute${remaining !== 1 ? "s" : ""} remaining before you can update your suggestion.`,
          });
          return;
        }
      }
      const suggestion: WikiSuggestion = {
        username,
        page: body.page,
        content: body.content,
        description: body.description,
        createdAt: existingSuggestion ? existingSuggestion.createdAt : now,
        ...(existingSuggestion
          ? {
              editCount: (existingSuggestion.editCount ?? 0) + 1,
              lastEditAt: now,
              previousDescriptions: [
                ...(existingSuggestion.previousDescriptions ?? []),
                existingSuggestion.description,
              ],
            }
          : {}),
      };
      await Promise.all([
        redis.set(`suggestion:${username}`, JSON.stringify(suggestion)),
        redis.zAdd("suggestions", { member: username, score: now }),
      ]);

      // Voting post creation / reset
      if (config.votingEnabled && config.collaborativeMode) {
        const existingVotingPostId = await redis.get(`votingPostId:${username}`).catch(() => null);
        if (existingVotingPostId) {
          // Updating suggestion: reset votes and status
          await Promise.all([
            redis.del(`votes:${username}`),
            redis.set(
              `voteStatus:${username}`,
              JSON.stringify({ status: "active", decidedAt: null, reason: null }),
            ),
          ]);
          const updateDateStr = new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          await appendBotComment(
            existingVotingPostId,
            `**Suggestion updated** on ${updateDateStr}: all votes have been reset`,
          );
          if (config.votingDurationDays > 0) {
            const oldJobId = await redis.get(`voteJobId:${username}`).catch(() => null);
            if (oldJobId) {
              try {
                await scheduler.cancelJob(oldJobId);
              } catch {}
            }
            const jobId = await scheduler.runJob({
              id: `vote-deadline-${username}-${Date.now()}`,
              name: "vote-deadline",
              data: { username, postId: existingVotingPostId },
              runAt: new Date(Date.now() + config.votingDurationDays * 86400 * 1000),
            } as ScheduledJob);
            await redis.set(`voteJobId:${username}`, jobId);
          }
        } else {
          // New suggestion: create voting post
          try {
            const user = await reddit.getUserByUsername(username).catch(() => null);
            const karma = user ? user.linkKarma + user.commentKarma : 0;
            const ageMs = user ? Date.now() - user.createdAt.getTime() : 0;
            const ageDays = Math.floor(ageMs / 86400000);
            const acceptedCount =
              parseInt(
                (await redis.get(`acceptedCount:${username}`).catch(() => null)) ?? "0",
                10,
              ) || 0;
            const pageLabel = suggestion.page
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
            const dateStr = new Date(suggestion.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            const votingPost = await reddit.submitCustomPost({
              subredditName: subreddit,
              title: expandVotingTitle(config.votingPostTitle, username, suggestion.page),
              entry: "default",
              userGeneratedContent: {
                text: `u/${username} (${karma.toLocaleString()} karma, account ${ageDays} days old, ${acceptedCount} contribution${acceptedCount !== 1 ? "s" : ""}) suggested changes to the "${pageLabel}" page on ${dateStr}. Vote to accept or reject below.`,
              },
            });

            const newPostId = votingPost.id.startsWith("t3_")
              ? votingPost.id
              : `t3_${votingPost.id}`;

            if (config.votingFlairTemplateId) {
              try {
                await reddit.setPostFlair({
                  subredditName: subreddit,
                  postId: newPostId as `t3_${string}`,
                  flairTemplateId: config.votingFlairTemplateId,
                });
              } catch {}
            }

            await Promise.all([
              redis.set(
                `votingPost:${newPostId}`,
                JSON.stringify({ username, subredditName: subreddit }),
              ),
              redis.set(`votingPostId:${username}`, newPostId),
              redis.set(
                `voteStatus:${username}`,
                JSON.stringify({ status: "active", decidedAt: null, reason: null }),
              ),
            ]);

            const startDateStr = new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            await appendBotComment(newPostId, `**Vote started** on ${startDateStr}`, "Active");

            if (config.votingDurationDays > 0) {
              const jobId = await scheduler.runJob({
                id: `vote-deadline-${username}-${Date.now()}`,
                name: "vote-deadline",
                data: { username, postId: newPostId },
                runAt: new Date(Date.now() + config.votingDurationDays * 86400 * 1000),
              } as ScheduledJob);
              await redis.set(`voteJobId:${username}`, jobId);
            }
          } catch (err) {
            console.error("Failed to create voting post:", err);
          }
        }
      }

      res.json({ type: "wiki-suggestion", suggestion });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to submit suggestion: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.delete<Record<string, never>, WikiSuggestionActionResponse | ErrorResponse>(
  "/api/wiki/suggestion",
  async (_req, res): Promise<void> => {
    try {
      const username = await reddit.getCurrentUsername();
      if (!username) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const votingPostId = await redis.get(`votingPostId:${username}`).catch(() => null);

      const [withdrawnRaw, withdrawnVotesRaw] = await Promise.all([
        redis.get(`suggestion:${username}`).catch(() => null),
        votingPostId ? redis.hGetAll(`votes:${username}`).catch(() => null) : Promise.resolve(null),
      ]);
      const withdrawnSuggestion = withdrawnRaw
        ? (JSON.parse(withdrawnRaw) as WikiSuggestion)
        : null;
      let withdrawnAcceptCount = 0;
      let withdrawnRejectCount = 0;
      for (const v of Object.values(withdrawnVotesRaw ?? {})) {
        const colonIdx = v.indexOf(":");
        if (colonIdx < 0) continue;
        const voteType = v.slice(0, colonIdx);
        if (voteType === "accept") withdrawnAcceptCount++;
        else if (voteType === "reject") withdrawnRejectCount++;
      }

      await Promise.all([
        redis.del(`suggestion:${username}`),
        redis.zRem("suggestions", [username]),
      ]);
      if (votingPostId) {
        const decidedAt = Date.now();
        const dateStr = new Date(decidedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const existingRaw = await redis.get(`votingPost:${votingPostId}`).catch(() => null);
        const baseData = existingRaw
          ? (JSON.parse(existingRaw) as { username: string; subredditName: string })
          : { username, subredditName: context.subredditName ?? "" };
        await Promise.all([
          redis.set(
            `votingPost:${votingPostId}`,
            JSON.stringify({
              ...baseData,
              concluded: true,
              status: "cancelled",
              decidedAt,
              reason: "cancelled",
              ...(withdrawnSuggestion
                ? {
                    suggestion: {
                      page: withdrawnSuggestion.page,
                      content: withdrawnSuggestion.content,
                      description: withdrawnSuggestion.description,
                      createdAt: withdrawnSuggestion.createdAt,
                      previousDescriptions: withdrawnSuggestion.previousDescriptions,
                    },
                  }
                : {}),
              acceptCount: withdrawnAcceptCount,
              rejectCount: withdrawnRejectCount,
            }),
          ),
          redis.del(`votingPostId:${username}`),
          redis.del(`votes:${username}`),
          redis.set(
            `voteStatus:${username}`,
            JSON.stringify({ status: "cancelled", decidedAt, reason: "cancelled" }),
          ),
          redis.del(`voteJobId:${username}`),
        ]);
        await appendBotComment(
          votingPostId,
          `**Vote concluded** on ${dateStr}: the author has retracted their suggestion`,
          "**WITHDRAWN**",
        );
        try {
          const post = await reddit.getPostById(votingPostId as `t3_${string}`);
          await post.lock();
        } catch {}
        const jobId = await redis.get(`voteJobId:${username}`).catch(() => null);
        if (jobId) {
          try {
            await scheduler.cancelJob(jobId);
          } catch {}
        }
      }
      res.json({ type: "wiki-suggestion-action" });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to delete suggestion: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, WikiSuggestionsResponse | ErrorResponse>(
  "/api/wiki/suggestions",
  async (_req, res): Promise<void> => {
    try {
      const username = await reddit.getCurrentUsername();
      if (!username) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const [isMod, config] = await Promise.all([checkIsMod(username), getConfig()]);
      if (!config.collaborativeMode) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }

      if (!isMod) {
        const raw = await redis.get(`suggestion:${username}`).catch(() => null);
        const suggestions: WikiSuggestionWithVoting[] = [];
        if (raw) {
          try {
            const suggestion = JSON.parse(raw) as WikiSuggestion;
            const votingPostId = await redis.get(`votingPostId:${username}`).catch(() => null);
            let voteStatus: VoteStatus | null = null;
            if (votingPostId) {
              voteStatus = await getVoteStatus(username, config, username, false);
            }
            suggestions.push({ ...suggestion, votingPostId: votingPostId ?? null, voteStatus });
          } catch {}
        }
        res.json({ type: "wiki-suggestions", suggestions });
        return;
      }

      const members = await redis.zRange("suggestions", 0, -1);
      const suggestions: WikiSuggestionWithVoting[] = [];
      for (const m of members) {
        const raw = await redis.get(`suggestion:${m.member}`);
        if (raw) {
          try {
            const suggestion = JSON.parse(raw) as WikiSuggestion;
            const votingPostId = await redis.get(`votingPostId:${m.member}`).catch(() => null);
            let voteStatus: VoteStatus | null = null;
            if (votingPostId) {
              voteStatus = await getVoteStatus(m.member, config, username, isMod);
            }
            suggestions.push({ ...suggestion, votingPostId: votingPostId ?? null, voteStatus });
          } catch {}
        }
      }
      res.json({ type: "wiki-suggestions", suggestions });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to list suggestions: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<
  Record<string, never>,
  WikiSuggestionActionResponse | ErrorResponse,
  WikiSuggestionActionRequest
>("/api/wiki/suggestion/accept", async (req, res): Promise<void> => {
  try {
    const modUsername = await reddit.getCurrentUsername();
    if (!modUsername) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const isMod = await checkIsMod(modUsername);
    if (!isMod) {
      res.status(403).json({ status: "error", message: "Not authorized" });
      return;
    }
    const subreddit = context.subredditName;
    if (!subreddit) {
      res.status(400).json({ status: "error", message: "Subreddit context not available" });
      return;
    }
    const body = req.body as WikiSuggestionActionRequest;
    const raw = await redis.get(`suggestion:${body.username}`);
    if (!raw) {
      res.status(404).json({ status: "error", message: "Suggestion not found" });
      return;
    }
    const suggestion = JSON.parse(raw) as WikiSuggestion;
    await reddit.updateWikiPage({
      subredditName: subreddit,
      page: suggestion.page,
      content: suggestion.content,
      reason: `${modUsername} accepted suggestion by ${suggestion.username}: ${suggestion.description}`,
    });
    const [, , newCount, basicFlairId, advCountRaw, advFlairId] = await Promise.all([
      redis.del(`suggestion:${body.username}`),
      redis.zRem("suggestions", [body.username]),
      redis.incrBy(`acceptedCount:${suggestion.username}`, 1),
      redis.get("suggestionFlairTemplateId").catch(() => null),
      redis.get("advancedContributorCount").catch(() => null),
      redis.get("advancedContributorFlairTemplateId").catch(() => null),
    ]);

    const advancedCount = Math.max(0, parseInt(advCountRaw ?? "0", 10) || 0);
    const earnedKey = `earnedFlairIds:${suggestion.username}`;
    try {
      const rawEarned = await redis.get(earnedKey);
      const earnedIds: string[] = rawEarned ? (JSON.parse(rawEarned) as string[]) : [];

      if (basicFlairId && !earnedIds.includes(basicFlairId)) {
        earnedIds.push(basicFlairId);
      }

      if (
        advancedCount > 0 &&
        newCount >= advancedCount &&
        advFlairId &&
        !earnedIds.includes(advFlairId)
      ) {
        earnedIds.push(advFlairId);
      }
      if (earnedIds.length > 0) {
        await redis.set(earnedKey, JSON.stringify(earnedIds));
      }
    } catch {}

    // Finalize voting post if exists
    const votingPostId = await redis.get(`votingPostId:${body.username}`).catch(() => null);
    if (votingPostId) {
      const modVotesRaw = await redis.hGetAll(`votes:${body.username}`).catch(() => null);
      let modAcceptCount = 0;
      let modRejectCount = 0;
      for (const v of Object.values(modVotesRaw ?? {})) {
        const colonIdx = v.indexOf(":");
        if (colonIdx < 0) continue;
        const voteType = v.slice(0, colonIdx);
        if (voteType === "accept") modAcceptCount++;
        else if (voteType === "reject") modRejectCount++;
      }
      await cleanupVotingPost(
        body.username,
        "accepted",
        "mod_override",
        votingPostId,
        suggestion,
        modAcceptCount,
        modRejectCount,
      );
    }

    res.json({ type: "wiki-suggestion-action" });
  } catch (error) {
    const message =
      error instanceof Error ? `Failed to accept suggestion: ${error.message}` : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.post<
  Record<string, never>,
  WikiSuggestionActionResponse | ErrorResponse,
  WikiSuggestionActionRequest
>("/api/wiki/suggestion/deny", async (req, res): Promise<void> => {
  try {
    const modUsername = await reddit.getCurrentUsername();
    if (!modUsername) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const isMod = await checkIsMod(modUsername);
    if (!isMod) {
      res.status(403).json({ status: "error", message: "Not authorized" });
      return;
    }
    const body = req.body as WikiSuggestionActionRequest;

    const denyVotingPostId = await redis.get(`votingPostId:${body.username}`).catch(() => null);
    const [deniedRaw, deniedVotesRaw] = await Promise.all([
      redis.get(`suggestion:${body.username}`).catch(() => null),
      denyVotingPostId
        ? redis.hGetAll(`votes:${body.username}`).catch(() => null)
        : Promise.resolve(null),
    ]);
    const deniedSuggestion = deniedRaw ? (JSON.parse(deniedRaw) as WikiSuggestion) : null;
    let denyAcceptCount = 0;
    let denyRejectCount = 0;
    for (const v of Object.values(deniedVotesRaw ?? {})) {
      const colonIdx = v.indexOf(":");
      if (colonIdx < 0) continue;
      const voteType = v.slice(0, colonIdx);
      if (voteType === "accept") denyAcceptCount++;
      else if (voteType === "reject") denyRejectCount++;
    }

    await Promise.all([
      redis.del(`suggestion:${body.username}`),
      redis.zRem("suggestions", [body.username]),
    ]);

    // Finalize voting post if exists
    if (denyVotingPostId) {
      await cleanupVotingPost(
        body.username,
        "rejected",
        "mod_override",
        denyVotingPostId,
        deniedSuggestion,
        denyAcceptCount,
        denyRejectCount,
      );
    }

    res.json({ type: "wiki-suggestion-action" });
  } catch (error) {
    const message =
      error instanceof Error ? `Failed to deny suggestion: ${error.message}` : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.get<Record<string, never>, CollabInfoResponse | ErrorResponse>(
  "/api/wiki/collab-info",
  async (_req, res): Promise<void> => {
    try {
      const modUsername = await reddit.getCurrentUsername();
      if (!modUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const isAllMod = await checkIsAllMod(modUsername);
      if (!isAllMod) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({ status: "error", message: "Subreddit context not available" });
        return;
      }

      const [
        bannedUsers,
        userFlairTemplatesRaw,
        linkFlairTemplatesRaw,
        subInfo,
        storedFlairId,
        advCountRaw,
        advFlairId,
      ] = await Promise.all([
        reddit
          .getBannedWikiContributors({ subredditName: subreddit })
          .all()
          .catch(() => []),
        reddit.getUserFlairTemplates(subreddit).catch(() => []),
        reddit.getPostFlairTemplates(subreddit).catch(() => []),
        reddit.getSubredditInfoByName(subreddit).catch(() => null),
        redis.get("suggestionFlairTemplateId"),
        redis.get("advancedContributorCount"),
        redis.get("advancedContributorFlairTemplateId"),
      ]);

      const banned = bannedUsers.map((u) => u.username);
      const flairTemplates: FlairTemplateInfo[] = userFlairTemplatesRaw.map((t) => ({
        id: t.id,
        text: t.text,
        textColor: t.textColor,
        backgroundColor: t.backgroundColor,
      }));
      const linkFlairTemplates: FlairTemplateInfo[] = linkFlairTemplatesRaw.map((t) => ({
        id: t.id,
        text: t.text,
        textColor: t.textColor,
        backgroundColor: t.backgroundColor,
      }));
      const wikiEditMode = subInfo?.wikiSettings?.wikiEditMode ?? null;

      res.json({
        type: "collab-info",
        wikiEditMode,
        banned,
        flairTemplateId: storedFlairId ?? null,
        flairTemplates,
        linkFlairTemplates,
        advancedContributorCount: Math.max(0, parseInt(advCountRaw ?? "0", 10) || 0),
        advancedContributorFlairTemplateId: advFlairId ?? null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to get collab info: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<Record<string, never>, SuggestionFlairResponse | ErrorResponse, SuggestionFlairRequest>(
  "/api/wiki/suggestion-flair",
  async (req, res): Promise<void> => {
    try {
      const modUsername = await reddit.getCurrentUsername();
      if (!modUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const isAllMod = await checkIsAllMod(modUsername);
      if (!isAllMod) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
      const body = req.body as SuggestionFlairRequest;
      if (body.flairTemplateId) {
        await redis.set("suggestionFlairTemplateId", body.flairTemplateId);
      } else {
        await redis.del("suggestionFlairTemplateId");
      }
      res.json({ type: "suggestion-flair", flairTemplateId: body.flairTemplateId });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to save flair setting: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<
  Record<string, never>,
  AdvancedContributorResponse | ErrorResponse,
  AdvancedContributorRequest
>("/api/wiki/advanced-contributor", async (req, res): Promise<void> => {
  try {
    const modUsername = await reddit.getCurrentUsername();
    if (!modUsername) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const isAllMod = await checkIsAllMod(modUsername);
    if (!isAllMod) {
      res.status(403).json({ status: "error", message: "Not authorized" });
      return;
    }
    const body = req.body as AdvancedContributorRequest;
    const count = Math.max(0, Math.floor(body.count ?? 0));
    if (count > 0) {
      await redis.set("advancedContributorCount", String(count));
    } else {
      await redis.del("advancedContributorCount");
    }
    if (body.flairTemplateId) {
      await redis.set("advancedContributorFlairTemplateId", body.flairTemplateId);
    } else {
      await redis.del("advancedContributorFlairTemplateId");
    }
    res.json({ type: "advanced-contributor", count, flairTemplateId: body.flairTemplateId });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to save advanced contributor settings: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.get<Record<string, never>, MyFlairsResponse | ErrorResponse>(
  "/api/wiki/my-flairs",
  async (_req, res): Promise<void> => {
    try {
      const username = await reddit.getCurrentUsername();
      if (!username || username === "anonymous") {
        res.json({ type: "my-flairs", earned: [], equipped: null });
        return;
      }
      const [rawEarned, equipped, flairTemplatesRaw] = await Promise.all([
        redis.get(`earnedFlairIds:${username}`).catch(() => null),
        redis.get(`equippedFlairId:${username}`).catch(() => null),
        reddit.getUserFlairTemplates(context.subredditName ?? "").catch(() => []),
      ]);
      const earnedIds: string[] = rawEarned ? (JSON.parse(rawEarned) as string[]) : [];
      const earnedSet = new Set(earnedIds);
      const earned: FlairTemplateInfo[] = flairTemplatesRaw
        .filter((t) => earnedSet.has(t.id))
        .map((t) => ({
          id: t.id,
          text: t.text,
          textColor: t.textColor,
          backgroundColor: t.backgroundColor,
        }));
      res.json({ type: "my-flairs", earned, equipped: equipped ?? null });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to get flairs: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<Record<string, never>, EquipFlairResponse | ErrorResponse, EquipFlairRequest>(
  "/api/wiki/equip-flair",
  async (req, res): Promise<void> => {
    try {
      const username = await reddit.getCurrentUsername();
      if (!username || username === "anonymous") {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({ status: "error", message: "Subreddit context not available" });
        return;
      }
      const body = req.body as EquipFlairRequest;
      if (body.flairTemplateId !== null) {
        const rawEarned = await redis.get(`earnedFlairIds:${username}`).catch(() => null);
        const earnedIds: string[] = rawEarned ? (JSON.parse(rawEarned) as string[]) : [];
        if (!earnedIds.includes(body.flairTemplateId)) {
          res.status(403).json({ status: "error", message: "You have not earned this flair." });
          return;
        }
        await reddit.setUserFlair({
          subredditName: subreddit,
          username,
          flairTemplateId: body.flairTemplateId,
        });
        await redis.set(`equippedFlairId:${username}`, body.flairTemplateId);
      } else {
        await reddit.setUserFlair({ subredditName: subreddit, username, flairTemplateId: "" });
        await redis.del(`equippedFlairId:${username}`);
      }
      res.json({ type: "equip-flair", flairTemplateId: body.flairTemplateId });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to equip flair: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<Record<string, never>, WikiBanResponse | ErrorResponse, WikiBanRequest>(
  "/api/wiki/ban",
  async (req, res): Promise<void> => {
    try {
      const modUsername = await reddit.getCurrentUsername();
      if (!modUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const isAllMod = await checkIsAllMod(modUsername);
      if (!isAllMod) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({ status: "error", message: "Subreddit context not available" });
        return;
      }
      const body = req.body as WikiBanRequest;
      const username = body.username?.trim();
      if (!username) {
        res.status(400).json({ status: "error", message: "Username required" });
        return;
      }
      await reddit.banWikiContributor({ username, subredditName: subreddit });

      await Promise.all([
        redis.del(`suggestion:${username}`),
        redis.zRem("suggestions", [username]),
      ]);
      res.json({ type: "wiki-ban" });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to ban user: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.delete<Record<string, never>, WikiBanResponse | ErrorResponse>(
  "/api/wiki/ban",
  async (req, res): Promise<void> => {
    try {
      const modUsername = await reddit.getCurrentUsername();
      if (!modUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const isAllMod = await checkIsAllMod(modUsername);
      if (!isAllMod) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({ status: "error", message: "Subreddit context not available" });
        return;
      }
      const body = req.body as WikiBanRequest;
      const username = body.username?.trim();
      if (!username) {
        res.status(400).json({ status: "error", message: "Username required" });
        return;
      }
      await reddit.unbanWikiContributor(username, subreddit);
      res.json({ type: "wiki-ban" });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to unban user: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, WikiBansResponse | ErrorResponse>(
  "/api/wiki/bans",
  async (_req, res): Promise<void> => {
    try {
      const modUsername = await reddit.getCurrentUsername();
      if (!modUsername) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const isAllMod = await checkIsAllMod(modUsername);
      if (!isAllMod) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
      const subreddit = context.subredditName;
      if (!subreddit) {
        res.status(400).json({ status: "error", message: "Subreddit context not available" });
        return;
      }
      const bannedUsers = await reddit
        .getBannedWikiContributors({ subredditName: subreddit })
        .all()
        .catch(() => []);
      const banned = bannedUsers.map((u) => u.username);
      res.json({ type: "wiki-bans", banned });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to list wiki bans: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, CastVoteResponse | ErrorResponse>(
  "/api/vote",
  async (_req, res): Promise<void> => {
    try {
      const { postId } = context;
      if (!postId) {
        res.status(400).json({ status: "error", message: "No post context" });
        return;
      }
      const votingPostRaw = await redis.get(`votingPost:${postId}`).catch(() => null);
      if (!votingPostRaw) {
        res.status(404).json({ status: "error", message: "Not a voting post" });
        return;
      }
      const { username: suggestionUsername } = JSON.parse(votingPostRaw) as {
        username: string;
        subredditName: string;
      };
      const voterUsername = await reddit.getCurrentUsername();
      const config = await getConfig();
      const isMod = voterUsername ? await checkIsMod(voterUsername) : false;
      const voteStatus = await getVoteStatus(
        suggestionUsername,
        config,
        voterUsername ?? "anonymous",
        isMod,
      );
      let myVote: VoteValue | null = null;
      if (voterUsername && voterUsername !== "anonymous") {
        const raw = await redis
          .hGet(`votes:${suggestionUsername}`, voterUsername)
          .catch(() => null);
        if (raw) {
          const colonIdx = raw.indexOf(":");
          myVote = colonIdx >= 0 ? (raw.slice(0, colonIdx) as VoteValue) : null;
        }
      }
      res.json({ type: "vote-cast", voteStatus, myVote });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to get vote: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<Record<string, never>, CastVoteResponse | ErrorResponse, CastVoteRequest>(
  "/api/vote",
  async (req, res): Promise<void> => {
    try {
      const { postId } = context;
      if (!postId) {
        res.status(400).json({ status: "error", message: "No post context" });
        return;
      }
      const votingPostRaw = await redis.get(`votingPost:${postId}`).catch(() => null);
      if (!votingPostRaw) {
        res.status(404).json({ status: "error", message: "Not a voting post" });
        return;
      }
      const { username: suggestionUsername, subredditName } = JSON.parse(votingPostRaw) as {
        username: string;
        subredditName: string;
      };

      const voterUsername = await reddit.getCurrentUsername();
      if (!voterUsername || voterUsername === "anonymous") {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }

      const config = await getConfig();

      const statusRaw = await redis.get(`voteStatus:${suggestionUsername}`).catch(() => null);
      if (statusRaw) {
        const statusData = JSON.parse(statusRaw) as VoteStatusData;
        if (statusData.status !== "active") {
          res
            .status(409)
            .json({ status: "error", message: "Voting is closed for this suggestion" });
          return;
        }
      }

      // Voter cannot be the suggestion author
      if (voterUsername === suggestionUsername) {
        res
          .status(403)
          .json({ status: "error", message: "You cannot vote on your own suggestion" });
        return;
      }

      // Check voter eligibility
      const eligible = await checkVoterEligibility(voterUsername, config);
      if (!eligible) {
        const parts: string[] = [];
        if (config.votingVoterMinKarma > 0)
          parts.push(`${config.votingVoterMinKarma.toLocaleString()} karma`);
        if (config.votingVoterMinAccountAgeDays > 0)
          parts.push(`account at least ${config.votingVoterMinAccountAgeDays} days old`);
        res.status(403).json({
          status: "error",
          message: `You don't meet the requirements to vote: ${parts.join(" and ")}.`,
        });
        return;
      }

      // Check ban
      try {
        const bannedList = await reddit
          .getBannedWikiContributors({ subredditName, username: voterUsername })
          .all()
          .catch(() => []);
        if (bannedList.length > 0) {
          res.status(403).json({ status: "error", message: "You are banned from this wiki." });
          return;
        }
      } catch {}

      // Check vote change rules
      const existingVoteRaw = await redis
        .hGet(`votes:${suggestionUsername}`, voterUsername)
        .catch(() => null);
      if (existingVoteRaw) {
        if (!config.votingAllowVoteChange) {
          res.status(403).json({ status: "error", message: "Vote changes are not allowed" });
          return;
        }
        if (config.votingChangeCooldownMinutes > 0) {
          const colonIdx = existingVoteRaw.indexOf(":");
          if (colonIdx >= 0) {
            const votedAt = parseInt(existingVoteRaw.slice(colonIdx + 1), 10);
            const elapsedMinutes = (Date.now() - votedAt) / 60000;
            if (elapsedMinutes < config.votingChangeCooldownMinutes) {
              const remaining = Math.ceil(config.votingChangeCooldownMinutes - elapsedMinutes);
              res.status(429).json({
                status: "error",
                message: `Vote change cooldown: ${remaining} minute${remaining !== 1 ? "s" : ""} remaining`,
              });
              return;
            }
          }
        }
      }

      const body = req.body as CastVoteRequest;
      const vote = body.vote;
      if (vote !== "accept" && vote !== "reject") {
        res.status(400).json({ status: "error", message: "Invalid vote value" });
        return;
      }

      await redis.hSet(`votes:${suggestionUsername}`, { [voterUsername]: `${vote}:${Date.now()}` });

      // Check thresholds
      await checkAndMaybeFinalize(suggestionUsername, config, postId, subredditName);

      // Return updated state
      const isMod = await checkIsMod(voterUsername);
      const voteStatus = await getVoteStatus(suggestionUsername, config, voterUsername, isMod);
      const newVoteRaw = await redis
        .hGet(`votes:${suggestionUsername}`, voterUsername)
        .catch(() => null);
      let myVote: VoteValue | null = null;
      if (newVoteRaw) {
        const colonIdx = newVoteRaw.indexOf(":");
        myVote = colonIdx >= 0 ? (newVoteRaw.slice(0, colonIdx) as VoteValue) : null;
      }

      res.json({ type: "vote-cast", voteStatus, myVote });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to cast vote: ${error.message}` : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.delete<Record<string, never>, CastVoteResponse | ErrorResponse>(
  "/api/vote",
  async (_req, res): Promise<void> => {
    try {
      const { postId } = context;
      if (!postId) {
        res.status(400).json({ status: "error", message: "No post context" });
        return;
      }
      const votingPostRaw = await redis.get(`votingPost:${postId}`).catch(() => null);
      if (!votingPostRaw) {
        res.status(404).json({ status: "error", message: "Not a voting post" });
        return;
      }
      const { username: suggestionUsername } = JSON.parse(votingPostRaw) as {
        username: string;
        subredditName: string;
      };
      const voterUsername = await reddit.getCurrentUsername();
      if (!voterUsername || voterUsername === "anonymous") {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const config = await getConfig();

      const statusRaw = await redis.get(`voteStatus:${suggestionUsername}`).catch(() => null);
      if (statusRaw) {
        const statusData = JSON.parse(statusRaw) as VoteStatusData;
        if (statusData.status !== "active") {
          res.status(409).json({ status: "error", message: "Voting is closed" });
          return;
        }
      }
      const existingVoteRaw = await redis
        .hGet(`votes:${suggestionUsername}`, voterUsername)
        .catch(() => null);
      if (!existingVoteRaw) {
        const isMod = await checkIsMod(voterUsername);
        const voteStatus = await getVoteStatus(suggestionUsername, config, voterUsername, isMod);
        res.json({ type: "vote-cast", voteStatus, myVote: null });
        return;
      }
      if (!config.votingAllowVoteChange) {
        res.status(403).json({ status: "error", message: "Vote changes are not allowed" });
        return;
      }
      if (config.votingChangeCooldownMinutes > 0) {
        const colonIdx = existingVoteRaw.indexOf(":");
        if (colonIdx >= 0) {
          const votedAt = parseInt(existingVoteRaw.slice(colonIdx + 1), 10);
          const elapsedMinutes = (Date.now() - votedAt) / 60000;
          if (elapsedMinutes < config.votingChangeCooldownMinutes) {
            const remaining = Math.ceil(config.votingChangeCooldownMinutes - elapsedMinutes);
            res.status(429).json({
              status: "error",
              message: `Vote change cooldown: ${remaining} minute${remaining !== 1 ? "s" : ""} remaining`,
            });
            return;
          }
        }
      }
      await redis.hDel(`votes:${suggestionUsername}`, [voterUsername]);
      const isMod = await checkIsMod(voterUsername);
      const voteStatus = await getVoteStatus(suggestionUsername, config, voterUsername, isMod);
      res.json({ type: "vote-cast", voteStatus, myVote: null });
    } catch (error) {
      const message =
        error instanceof Error ? `Failed to retract vote: ${error.message}` : "Unknown error";
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

router.post<Record<string, never>, TaskResponse, TaskRequest<{ username: string; postId: string }>>(
  "/internal/scheduler/vote-deadline",
  async (req, res): Promise<void> => {
    try {
      const body = req.body as TaskRequest<{ username: string; postId: string }>;
      const data = body.data;
      if (!data?.username || !data.postId) {
        res.status(200).json({ status: "ok" });
        return;
      }
      const { username, postId } = data;

      // Only finalize if still active
      const statusRaw = await redis.get(`voteStatus:${username}`).catch(() => null);
      if (statusRaw) {
        const statusData = JSON.parse(statusRaw) as VoteStatusData;
        if (statusData.status !== "active") {
          res.status(200).json({ status: "ok" });
          return;
        }
      }

      const config = await getConfig();
      const subreddit = context.subredditName ?? "";

      const votesRaw = await redis.hGetAll(`votes:${username}`).catch(() => null);
      const votes = votesRaw ?? {};
      let acceptCount = 0;
      let rejectCount = 0;
      for (const raw of Object.values(votes)) {
        const colonIdx = raw.indexOf(":");
        if (colonIdx < 0) continue;
        const voteType = raw.slice(0, colonIdx);
        if (voteType === "accept") acceptCount++;
        else if (voteType === "reject") rejectCount++;
      }
      const totalVoters = acceptCount + rejectCount;

      if (config.votingMinVotersForTiming > 0 && totalVoters < config.votingMinVotersForTiming) {
        await finalizeVote(username, "rejected", "percent_time", postId, subreddit);
      } else if (config.votingPercentThreshold > 0) {
        if (totalVoters > 0) {
          const acceptPct = (acceptCount / totalVoters) * 100;
          if (acceptPct >= config.votingPercentThreshold) {
            await finalizeVote(username, "accepted", "percent_time", postId, subreddit);
          } else {
            await finalizeVote(username, "rejected", "percent_time", postId, subreddit);
          }
        } else {
          await finalizeVote(username, "rejected", "percent_time", postId, subreddit);
        }
      } else {
        if (acceptCount > rejectCount) {
          await finalizeVote(username, "accepted", "percent_time", postId, subreddit);
        } else {
          await finalizeVote(username, "rejected", "percent_time", postId, subreddit);
        }
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("vote-deadline scheduler error:", err);
      res.status(200).json({ status: "ok" });
    }
  },
);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.listen(port);
