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
  DevSelfTestResponse,
  DevTestResult,
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
  WikiAllPagesResponse,
  WikiCreateRequest,
  WikiCreateResponse,
  WikiHistoryResponse,
  WikiRevisionInfo,
  WikiRevisionContentResponse,
  WikiHistoryEntry,
  WikiHistoryEvent,
  WikiContribHistoryResponse,
  WikiHistoryActionRequest,
  WikiHistoryActionResponse,
  WikiDeleteRequest,
  WikiDeleteResponse,
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
  WikiDraft,
  WikiDraftRequest,
  WikiDraftResponse,
  WikiDraftActionResponse,
  VersionResponse,
} from "../shared/types/api";
import type { UiResponse } from "@devvit/web/shared";
import type {
  TaskRequest,
  TaskResponse,
  ScheduledJob,
} from "@devvit/web/server";
import {
  redis,
  reddit,
  createServer,
  context,
  getServerPort,
  scheduler,
} from "@devvit/web/server";
import { createPost } from "./core/post";
import { threeWayMerge } from "./merge";
import { DEV_SUBREDDIT } from "../shared/types/api";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

const router = express.Router();

const DEFAULT_CONFIG: GameConfig = {
  gameName: "",
  engine: "auto",
  encryptionKey: "",
  customTransformCode: null,
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
  votingPostTitle:
    "[WIKI] Vote: %user% suggests changes to the page %shortPathPage%",
  votingFlairTemplateId: null,
  votingMinVotersForTiming: 0,
  votingMaxSuggestionEdits: 1,
  suggestionEditCooldownMinutes: 0,
};

const VALID_HOME_BACKGROUNDS = new Set<string>([
  "ripple",
  "banner",
  "both",
  "none",
]);
const VALID_HOME_LOGOS = new Set<string>(["echowiki", "subreddit"]);

const DEFAULT_MAPPING_TEXT = '"original_filename": "mapped_filename"';

async function getConfig(): Promise<GameConfig> {
  let raw: Record<string, string> | undefined;
  try {
    raw = await redis.hGetAll("config");
  } catch (err) {
    // Redis access is intermittently unreliable in some platform contexts
    // (notably /internal/menu/* form-building), failing with an empty gRPC
    // error (`undefined undefined: undefined`). Config is non-critical display
    // data with safe defaults: fail open so a Redis hiccup never blocks
    // moderators (e.g. from creating a post) or breaks read routes.
    console.error(
      "getConfig: redis.hGetAll failed, falling back to defaults",
      err,
    );
    return { ...DEFAULT_CONFIG };
  }
  if (!raw || Object.keys(raw).length === 0) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    gameName: raw["gameName"] ?? DEFAULT_CONFIG.gameName,
    engine: (raw["engine"] as GameConfig["engine"]) ?? DEFAULT_CONFIG.engine,
    encryptionKey: raw["encryptionKey"] ?? DEFAULT_CONFIG.encryptionKey,
    customTransformCode: raw["customTransformCode"] ?? null,
    wikiTitle: raw["wikiTitle"] ?? DEFAULT_CONFIG.wikiTitle,
    wikiDescription: raw["wikiDescription"] ?? DEFAULT_CONFIG.wikiDescription,
    homeBackground:
      raw["homeBackground"] &&
      VALID_HOME_BACKGROUNDS.has(raw["homeBackground"]!)
        ? (raw["homeBackground"] as HomeBackground)
        : DEFAULT_CONFIG.homeBackground,
    homeLogo:
      raw["homeLogo"] && VALID_HOME_LOGOS.has(raw["homeLogo"]!)
        ? (raw["homeLogo"] as HomeLogo)
        : DEFAULT_CONFIG.homeLogo,
    collaborativeMode: raw["collaborativeMode"] === "true",
    minKarma: Math.max(0, parseInt(raw["minKarma"] ?? "0", 10) || 0),
    minAccountAgeDays: Math.max(
      0,
      parseInt(raw["minAccountAgeDays"] ?? "0", 10) || 0,
    ),
    votingEnabled: raw["votingEnabled"] === "true",
    votingAcceptThreshold: Math.max(
      0,
      parseInt(raw["votingAcceptThreshold"] ?? "100", 10) || 100,
    ),
    votingRejectThreshold: Math.max(
      0,
      parseInt(raw["votingRejectThreshold"] ?? "0", 10) || 0,
    ),
    votingPercentThreshold: Math.min(
      100,
      Math.max(0, parseInt(raw["votingPercentThreshold"] ?? "0", 10) || 0),
    ),
    votingDurationDays: Math.max(
      0,
      parseInt(raw["votingDurationDays"] ?? "0", 10) || 0,
    ),
    votingAllowVoteChange: raw["votingAllowVoteChange"] !== "false",
    votingChangeCooldownMinutes: Math.max(
      0,
      parseInt(raw["votingChangeCooldownMinutes"] ?? "0", 10) || 0,
    ),
    votingShowVoterNames: raw["votingShowVoterNames"] !== "false",
    votingVoterMinKarma: Math.max(
      0,
      parseInt(raw["votingVoterMinKarma"] ?? "0", 10) || 0,
    ),
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

/**
 * Resolve the current user's username without the brittle `UserAbout` lookup
 * that `reddit.getCurrentUsername()` performs internally (getCurrentUser ->
 * User.getById -> User.getByUsername -> UserAbout). In menu/trigger contexts that
 * gRPC call can fail with an empty error ("undefined undefined: undefined"),
 * which crashed those handlers (e.g. the "Create EchoWiki" menu showing
 * "Failed to load form"). The platform already exposes the handle directly on
 * the request context, so prefer that and only fall back to the API call:
 * guarded: when the context handle is absent.
 */
async function getCurrentUsername(): Promise<string | undefined> {
  if (context.username) return context.username;
  if (!context.userId) return undefined;
  try {
    return await reddit.getCurrentUsername();
  } catch (err) {
    console.warn(
      "getCurrentUsername: context handle missing and fallback lookup failed",
      err,
    );
    return undefined;
  }
}

async function getModLevel(
  username: string,
): Promise<"config" | "wiki" | null> {
  if (!context.subredditName) return null;
  try {
    const mods = reddit.getModerators({
      subredditName: context.subredditName,
      username,
    });
    const modList = await mods.all();
    if (modList.length === 0) return null; // genuinely not a moderator
    const mod = modList[0]!;

    // Permission lookup is best-effort: isolate it so a failure here can never
    // demote a confirmed moderator to "not a mod".
    let perms: string[] = [];
    try {
      perms = await mod.getModPermissionsForSubreddit(context.subredditName);
    } catch (err) {
      console.warn(
        `getModLevel: permission lookup failed for "${username}"`,
        err,
      );
    }
    if (perms.includes("all") || perms.includes("config")) return "config";
    if (perms.includes("wiki")) return "wiki";

    // The user IS a confirmed moderator, but the platform did not report a
    // recognizable config/wiki permission. This happens for "everything" mods
    // whose perms come back empty, and for INACTIVE mods whose effective perms
    // Reddit reduces ("Inactive mods have limited permissions"). Rather than lock
    // a real moderator out entirely, fail open to full access: matching the
    // app's pre-granular-permissions behavior where any mod could do anything.
    console.warn(
      `getModLevel: moderator "${username}" reported perms [${perms.join(", ")}] for r/${context.subredditName}; defaulting to "config"`,
    );
    return "config";
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

function expandVotingTitle(
  template: string,
  username: string,
  page: string,
): string {
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

// Prefix of the synthetic voting-post ids minted by the dev self-test harness.
// These never correspond to a real Reddit post, so reddit-side effects keyed on
// them (commenting, locking) are skipped to avoid noisy gRPC errors during a
// self-test run. See runDevSelfTests.
const SELFTEST_POST_PREFIX = "t3_selftest";

async function appendBotComment(
  votingPostId: string,
  listEntry: string,
  newStatus?: string | undefined,
): Promise<void> {
  // Synthetic self-test post: there is no real post to comment on.
  if (votingPostId.startsWith(SELFTEST_POST_PREFIX)) return;
  const idKey = `votingBotCommentId:${votingPostId}`;
  const listKey = `votingBotCommentList:${votingPostId}`;
  const statusKey = `votingBotCommentStatus:${votingPostId}`;
  const [existingId, existingListRaw, existingStatus] = await Promise.all([
    redis.get(idKey).catch(() => null),
    redis.get(listKey).catch(() => null),
    redis.get(statusKey).catch(() => null),
  ]);
  const entries: string[] = existingListRaw
    ? (JSON.parse(existingListRaw) as string[])
    : [];
  entries.push(listEntry);
  const status = newStatus ?? existingStatus ?? "Active";
  const newText = `# [WIKI] Vote status: ${status}\n\n- ${entries.join("\n- ")}`;
  await Promise.all([
    redis.set(listKey, JSON.stringify(entries)),
    redis.set(statusKey, status),
  ]);
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
  if (
    config.votingVoterMinKarma === 0 &&
    config.votingVoterMinAccountAgeDays === 0
  ) {
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
    const ageDays = Math.floor(
      (Date.now() - user.createdAt.getTime()) / 86400000,
    );
    if (
      config.votingVoterMinAccountAgeDays > 0 &&
      ageDays < config.votingVoterMinAccountAgeDays
    ) {
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

async function checkVoterEligibility(
  username: string,
  config: GameConfig,
): Promise<boolean> {
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
    : { status: "active", decidedAt: null, deadlineAt: null, reason: null };

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
    const showVoter =
      config.votingShowVoterNames || isMod || callerUsername === username;
    voteEntries.push({
      username: showVoter ? voter : "",
      vote: voteType,
      votedAt,
    });
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

//
// Reddit deletes nothing here: we persist a record of every decided suggestion
// so the Contributions > History tab can show it (and mods can later revert /
// approve-post-mortem). `proposedContent` is the suggestion; `baseContent` is
// the page snapshot at decision time (the merge base for later revert actions).

type StoredHistoryEntry = WikiHistoryEntry & {
  proposedContent: string;
  baseContent: string;
};

const HISTORY_GLOBAL_KEY = "history:all";
const HISTORY_GLOBAL_CAP = 200;
const HISTORY_USER_CAP = 50;

async function loadHistoryEntry(
  id: string,
): Promise<StoredHistoryEntry | null> {
  try {
    const raw = await redis.get(`history:entry:${id}`);
    return raw ? (JSON.parse(raw) as StoredHistoryEntry) : null;
  } catch {
    return null;
  }
}

// Persist an entry and (re-)index it in the global and per-user history zsets,
// bumping it to the top (score = updatedAt). Trims old entries past the caps.
async function saveHistoryEntry(entry: StoredHistoryEntry): Promise<void> {
  const userKey = `history:user:${entry.author}`;
  await Promise.all([
    redis.set(`history:entry:${entry.id}`, JSON.stringify(entry)),
    redis.zAdd(HISTORY_GLOBAL_KEY, {
      member: entry.id,
      score: entry.updatedAt,
    }),
    redis.zAdd(userKey, { member: entry.id, score: entry.updatedAt }),
  ]);
  // Best-effort trim of the lowest-scored (oldest) entries beyond the caps.
  await trimHistoryZset(HISTORY_GLOBAL_KEY, HISTORY_GLOBAL_CAP, true).catch(
    () => {},
  );
  await trimHistoryZset(userKey, HISTORY_USER_CAP, false).catch(() => {});
}

async function trimHistoryZset(
  key: string,
  cap: number,
  deleteEntries: boolean,
): Promise<void> {
  const count = await redis.zCard(key);
  if (count <= cap) return;
  const removeCount = count - cap;
  const oldest = await redis.zRange(key, 0, removeCount - 1);
  const ids = oldest.map((o) => o.member);
  if (ids.length === 0) return;
  await redis.zRem(key, ids);
  if (deleteEntries) {
    // Only delete the underlying record when evicting from the GLOBAL index, so
    // it disappears for everyone. (Per-user trimming just unlists it.)
    await Promise.all(ids.map((id) => redis.del(`history:entry:${id}`)));
  }
}

function historyEntryId(author: string, createdAt: number): string {
  return `${author}:${createdAt}`;
}

// Record a decision (approve/deny, by a mod or by community vote) in the audit
// trail. `baseContent` is the page content captured at decision time.
async function recordDecision(
  suggestion: WikiSuggestion,
  baseContent: string,
  outcome: "approved" | "denied",
  by: string | null,
  viaVote: boolean,
  reason?: string | null,
): Promise<void> {
  const now = Date.now();
  const id = historyEntryId(suggestion.username, suggestion.createdAt);
  const trimmedReason = reason?.trim();
  // A denial the author performed on their own contribution is a self-
  // withdrawal, not a moderator decision; flag it so the audit trail reads
  // "Withdrawn by user" for both mods and the author (whose `by` is redacted).
  const isWithdrawal =
    outcome === "denied" &&
    !viaVote &&
    by != null &&
    by === suggestion.username;
  const decisionEvent: WikiHistoryEvent = {
    state: outcome,
    by: viaVote ? null : by,
    at: now,
    ...(viaVote ? { viaVote: true } : {}),
    ...(isWithdrawal ? { withdrawn: true } : {}),
    ...(trimmedReason ? { reason: trimmedReason } : {}),
  };
  // If this suggestion already has a history entry (e.g. it was re-opened via
  // "restart vote"), append the new decision so the full state log accumulates
  // instead of resetting; otherwise start a fresh entry.
  const existing = await loadHistoryEntry(id);
  let entry: StoredHistoryEntry;
  if (existing) {
    existing.events.push(decisionEvent);
    existing.status = outcome;
    existing.updatedAt = now;
    existing.proposedContent = suggestion.content;
    // Keep the ORIGINAL baseline. Re-deciding a re-opened suggestion would
    // otherwise clobber it with the current page (which already holds the
    // proposed change from the first approval), corrupting later reverts and
    // making a subsequent vote-restart diff empty. Prefer the suggestion's
    // carried baseline, then the entry's existing one, falling back to the
    // freshly-read page only for legacy entries that never stored a base.
    existing.baseContent =
      suggestion.baseContent ?? existing.baseContent ?? baseContent;
    existing.canRevert = true;
    existing.canRestartVote = true;
    entry = existing;
  } else {
    entry = {
      id,
      author: suggestion.username,
      page: suggestion.page,
      description: suggestion.description,
      status: outcome,
      events: [
        {
          state: "submitted",
          by: suggestion.username,
          at: suggestion.createdAt,
        },
        decisionEvent,
      ],
      updatedAt: now,
      canRevert: true,
      canRestartVote: true,
      proposedContent: suggestion.content,
      // Prefer the suggestion's authored baseline; fall back to the page read
      // at apply time for legacy suggestions submitted before baseContent existed.
      baseContent: suggestion.baseContent ?? baseContent,
    };
  }
  await saveHistoryEntry(entry).catch((err) =>
    console.warn("recordDecision: failed to save history entry", err),
  );
}

// Read the current content of a wiki page (empty string if unreadable).
async function readPageContent(
  subredditName: string,
  page: string,
): Promise<string> {
  try {
    const wp = await reddit.getWikiPage(subredditName, page);
    return wp.content ?? "";
  } catch {
    return "";
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
  // Snapshot the pre-apply page content as the merge base for any later revert.
  const baseContent = await readPageContent(subredditName, suggestion.page);
  await reddit.updateWikiPage({
    subredditName,
    page: suggestion.page,
    content: suggestion.content,
    reason: `${actorLabel} accepted suggestion by ${suggestion.username}: ${suggestion.description}`,
  });
  await recordDecision(
    suggestion,
    baseContent,
    "approved",
    actorLabel === "vote" ? null : actorLabel,
    actorLabel === "vote",
  );
  const [, , newCount, basicFlairId, advCountRaw, advFlairId] =
    await Promise.all([
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
    const earnedIds: string[] = rawEarned
      ? (JSON.parse(rawEarned) as string[])
      : [];
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

// Parse the raw `votes:<user>` hash (member = voter, value = `accept|reject:ts`)
// into structured entries. Shared by the live tally and the conclusion snapshot.
function parseVoteEntries(
  votesRaw: Record<string, string> | null | undefined,
): VoteEntry[] {
  const entries: VoteEntry[] = [];
  for (const [voter, raw] of Object.entries(votesRaw ?? {})) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx === -1) continue;
    const vote = raw.slice(0, colonIdx) as VoteValue;
    const votedAt = parseInt(raw.slice(colonIdx + 1), 10);
    entries.push({ username: voter, vote, votedAt });
  }
  return entries;
}

async function cleanupVotingPost(
  username: string,
  outcome: "accepted" | "rejected",
  reason: VoteStatusData["reason"],
  votingPostId: string,
  concludedSuggestion?: WikiSuggestion | null | undefined,
  concludedAcceptCount?: number | undefined,
  concludedRejectCount?: number | undefined,
  concludedVoters?: VoteEntry[] | undefined,
  decidedBy?: string | null,
  decisionNote?: string | null,
): Promise<void> {
  const decidedAt = Date.now();
  const trimmedNote = decisionNote?.trim() || null;
  await redis.set(
    `voteStatus:${username}`,
    JSON.stringify({
      status: outcome,
      decidedAt,
      deadlineAt: null,
      reason,
      decidedBy: decidedBy ?? null,
      decisionNote: trimmedNote,
    }),
  );

  const existingRaw = await redis
    .get(`votingPost:${votingPostId}`)
    .catch(() => null);
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
        decidedBy: decidedBy ?? null,
        decisionNote: trimmedNote,
        ...(concludedSuggestion
          ? {
              suggestion: {
                page: concludedSuggestion.page,
                content: concludedSuggestion.content,
                description: concludedSuggestion.description,
                createdAt: concludedSuggestion.createdAt,
                previousDescriptions: concludedSuggestion.previousDescriptions,
                baseContent: concludedSuggestion.baseContent,
              },
            }
          : {}),
        ...(concludedAcceptCount !== undefined
          ? { acceptCount: concludedAcceptCount }
          : {}),
        ...(concludedRejectCount !== undefined
          ? { rejectCount: concludedRejectCount }
          : {}),
        // Snapshot the full voter list (with names) before `votes:<user>` is
        // deleted below, so a concluded vote can still show who voted. The read
        // path redacts names when the config / caller isn't allowed to see them.
        ...(concludedVoters !== undefined ? { voters: concludedVoters } : {}),
      }),
    ),
    redis.del(`votingPostId:${username}`),
    redis.del(`votes:${username}`),
  ]);

  const outcomeText = outcome === "accepted" ? "**ACCEPTED**" : "**REJECTED**";
  const reasonText =
    decidedBy && reason === "mod_override"
      ? `decided by u/${decidedBy}`
      : getVoteReasonText(reason);
  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  await appendBotComment(
    votingPostId,
    `**Vote decided** on ${dateStr}: **${reasonText}**${
      trimmedNote ? `\n\n> ${trimmedNote}` : ""
    }`,
    outcomeText,
  );
  // Skip locking synthetic self-test posts, which don't exist on Reddit.
  if (!votingPostId.startsWith(SELFTEST_POST_PREFIX)) {
    try {
      const post = await reddit.getPostById(votingPostId as `t3_${string}`);
      await post.lock();
    } catch (err) {
      console.error("Failed to lock voting post:", err);
    }
  }
  const jobId = await redis.get(`voteJobId:${username}`).catch(() => null);
  if (jobId) {
    try {
      await scheduler.cancelJob(jobId);
    } catch {}
    await redis.del(`voteJobId:${username}`);
  }
}

// Create a fresh voting post for a suggestion: submit the custom post, apply the
// vote flair, seed the vote-tracking keys (votingPost/votingPostId/voteStatus),
// post the "Vote started" bot comment, and schedule the deadline job. Shared by
// the suggestion submit flow and the "restart vote" history action so a
// restarted vote is wired up identically to a brand-new one.
async function createVotingPost(
  username: string,
  suggestion: WikiSuggestion,
  config: GameConfig,
  subreddit: string,
  now: number,
): Promise<void> {
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
      title: expandVotingTitle(
        config.votingPostTitle,
        username,
        suggestion.page,
      ),
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
        JSON.stringify({
          status: "active",
          decidedAt: null,
          deadlineAt:
            config.votingDurationDays > 0
              ? now + config.votingDurationDays * 86400 * 1000
              : null,
          reason: null,
        }),
      ),
    ]);

    const startDateStr = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    await appendBotComment(
      newPostId,
      `**Vote started** on ${startDateStr}`,
      "Active",
    );

    if (config.votingDurationDays > 0) {
      const jobId = await scheduler.runJob({
        id: `vote-deadline-${username}-${Date.now()}`,
        name: "vote-deadline",
        data: { username, postId: newPostId },
        runAt: new Date(now + config.votingDurationDays * 86400 * 1000),
      } as ScheduledJob);
      await redis.set(`voteJobId:${username}`, jobId);
    }
  } catch (err) {
    console.error("Failed to create voting post:", err);
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
  const concludedSuggestion = suggestionRaw
    ? (JSON.parse(suggestionRaw) as WikiSuggestion)
    : null;
  const concludedVoters = parseVoteEntries(votesRaw);
  const concludedAcceptCount = concludedVoters.filter(
    (v) => v.vote === "accept",
  ).length;
  const concludedRejectCount = concludedVoters.filter(
    (v) => v.vote === "reject",
  ).length;

  if (outcome === "accepted") {
    await performAcceptCore(username, subredditName, "vote");
  } else {
    if (concludedSuggestion) {
      const base = await readPageContent(
        subredditName,
        concludedSuggestion.page,
      );
      await recordDecision(concludedSuggestion, base, "denied", null, true);
    }
    await Promise.all([
      redis.del(`suggestion:${username}`),
      redis.zRem("suggestions", [username]),
    ]);
  }
  await cleanupVotingPost(
    username,
    outcome,
    reason,
    votingPostId,
    concludedSuggestion,
    concludedAcceptCount,
    concludedRejectCount,
    concludedVoters,
  );
}

// Tally the current votes and conclude a time-based vote ("voting deadline
// reached"). Shared by the scheduler job and the read-time deadline fallback so
// both apply the identical accept/reject rules.
async function finalizeVoteByDeadline(
  username: string,
  config: GameConfig,
  votingPostId: string,
  subredditName: string,
): Promise<void> {
  const votesRaw = await redis.hGetAll(`votes:${username}`).catch(() => null);
  let acceptCount = 0;
  let rejectCount = 0;
  for (const raw of Object.values(votesRaw ?? {})) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx < 0) continue;
    const voteType = raw.slice(0, colonIdx);
    if (voteType === "accept") acceptCount++;
    else if (voteType === "reject") rejectCount++;
  }
  const totalVoters = acceptCount + rejectCount;

  let outcome: "accepted" | "rejected";
  if (
    config.votingMinVotersForTiming > 0 &&
    totalVoters < config.votingMinVotersForTiming
  ) {
    outcome = "rejected";
  } else if (config.votingPercentThreshold > 0) {
    outcome =
      totalVoters > 0 &&
      (acceptCount / totalVoters) * 100 >= config.votingPercentThreshold
        ? "accepted"
        : "rejected";
  } else {
    outcome = acceptCount > rejectCount ? "accepted" : "rejected";
  }

  await finalizeVote(
    username,
    outcome,
    "percent_time",
    votingPostId,
    subredditName,
  );
}

// Read-time fallback: the Devvit scheduler one-off job is the primary driver of
// time-based conclusion, but it can be delayed or fail to fire, leaving a vote
// shown as "deadline passed" yet still active. Whenever a voting post is loaded
// we re-check the deadline here and conclude it on the spot if it has elapsed,
// so the UI is self-healing regardless of scheduler reliability.
async function maybeFinalizeExpiredVote(
  username: string,
  config: GameConfig,
  votingPostId: string,
  subredditName: string,
): Promise<boolean> {
  const statusRaw = await redis.get(`voteStatus:${username}`).catch(() => null);
  if (!statusRaw) return false;
  let statusData: VoteStatusData;
  try {
    statusData = JSON.parse(statusRaw) as VoteStatusData;
  } catch {
    return false;
  }
  if (statusData.status !== "active") return false;

  let deadlineAt = statusData.deadlineAt ?? null;
  if (deadlineAt == null) {
    // Legacy votes stored before deadlineAt existed: derive it from the
    // suggestion creation time, matching the historical client countdown.
    if (config.votingDurationDays <= 0) return false;
    const suggestionRaw = await redis
      .get(`suggestion:${username}`)
      .catch(() => null);
    if (!suggestionRaw) return false;
    try {
      const suggestion = JSON.parse(suggestionRaw) as WikiSuggestion;
      deadlineAt =
        suggestion.createdAt + config.votingDurationDays * 86400 * 1000;
    } catch {
      return false;
    }
  }
  if (Date.now() < deadlineAt) return false;

  await finalizeVoteByDeadline(username, config, votingPostId, subredditName);
  return true;
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

  if (
    config.votingRejectThreshold > 0 &&
    rejectCount >= config.votingRejectThreshold
  ) {
    await finalizeVote(
      username,
      "rejected",
      "threshold_reject",
      votingPostId,
      subredditName,
    );
    return;
  }
  if (
    config.votingAcceptThreshold > 0 &&
    acceptCount >= config.votingAcceptThreshold
  ) {
    await finalizeVote(
      username,
      "accepted",
      "threshold_accept",
      votingPostId,
      subredditName,
    );
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

function entriesFromPairs(
  entries: Array<[string, string]>,
): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    const k = key.toLowerCase();
    const v = value.toLowerCase();
    if (!ALLOWED_MAPPING_CHARS.test(k) || !ALLOWED_MAPPING_CHARS.test(v))
      continue;
    result[k] = v;
  }
  return Object.keys(result).length > 0 ? result : null;
}

router.get<
  Record<string, never>,
  InitResponse | VotingInitResponse | ErrorResponse
>("/api/init", async (_req, res): Promise<void> => {
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
      getCurrentUsername(),
      getSubredditAppearance(),
    ]);

    let modLevel: "config" | "wiki" | null = null;
    if (username) {
      modLevel = await getModLevel(username);
    }
    const isMod = modLevel !== null;

    // Check if this is a voting post
    const votingPostRaw = await redis
      .get(`votingPost:${postId}`)
      .catch(() => null);
    if (votingPostRaw) {
      type VotingPostData = {
        username: string;
        subredditName: string;
        concluded?: boolean;
        status?: "accepted" | "rejected" | "cancelled";
        decidedAt?: number;
        reason?: VoteStatusData["reason"];
        decidedBy?: string | null;
        decisionNote?: string | null;
        suggestion?: {
          page: string;
          content: string;
          description: string;
          createdAt: number;
          previousDescriptions?: string[];
          baseContent?: string;
        };
        acceptCount?: number;
        rejectCount?: number;
        voters?: VoteEntry[];
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
              (Date.now() - authorUser.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
            acceptedContributions: acceptedRaw
              ? parseInt(acceptedRaw, 10) || 0
              : 0,
          };
        }
      } catch {}

      const raw = await redis.get(`suggestion:${suggestionUsername}`);
      if (!raw) {
        let voteStatus: VoteStatus;
        if (votingPostData.concluded && votingPostData.status) {
          const storedAccept = votingPostData.acceptCount ?? 0;
          const storedReject = votingPostData.rejectCount ?? 0;
          // Surface the snapshotted voter list when names are allowed; otherwise
          // keep the entries (for counts/anonymity) but strip the usernames,
          // mirroring the live `getVoteStatus` redaction rule.
          const showVoter =
            config.votingShowVoterNames ||
            isMod ||
            (!!username && username === suggestionUsername);
          const storedVotes: VoteEntry[] = (votingPostData.voters ?? []).map(
            (v) => ({ ...v, username: showVoter ? v.username : "" }),
          );
          voteStatus = {
            status: votingPostData.status,
            decidedAt: votingPostData.decidedAt ?? null,
            reason: votingPostData.reason ?? null,
            decidedBy: votingPostData.decidedBy ?? null,
            decisionNote: votingPostData.decisionNote ?? null,
            acceptCount: storedAccept,
            rejectCount: storedReject,
            totalVoters: storedAccept + storedReject,
            votes: storedVotes,
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
              ? {
                  previousDescriptions:
                    votingPostData.suggestion.previousDescriptions,
                }
              : {}),
          };
          // Diff baseline: prefer the suggestion's authored baseline (snapshot
          // at conclusion) so the change shows even when already applied to the
          // live page; fall back to the live page for legacy snapshots.
          if (votingPostData.suggestion.baseContent !== undefined) {
            concludedContent = votingPostData.suggestion.baseContent;
          } else {
            try {
              const wikiPage = await reddit.getWikiPage(
                subreddit,
                placeholder.page,
              );
              concludedContent = wikiPage.content;
            } catch {}
          }
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

      // Self-heal an expired-but-undecided vote before reading its status, so a
      // simple reload concludes it even if the scheduler job never fired.
      await maybeFinalizeExpiredVote(
        suggestionUsername,
        config,
        postId,
        subreddit,
      ).catch(() => {});

      // Diff baseline: prefer the suggestion's authored baseline so the change
      // is shown relative to its original base even when it's already live on
      // the page (e.g. a restarted vote on a previously-applied contribution).
      // Fall back to the live page for legacy suggestions without a stored base.
      let currentContent = suggestion.baseContent ?? "";
      if (suggestion.baseContent === undefined) {
        try {
          const wikiPage = await reddit.getWikiPage(subreddit, suggestion.page);
          currentContent = wikiPage.content;
        } catch {}
      }

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
          myVote =
            colonIdx >= 0 ? (voteRaw.slice(0, colonIdx) as VoteValue) : null;
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
    if (
      config.collaborativeMode &&
      username &&
      username !== "anonymous" &&
      !isMod
    ) {
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
      error instanceof Error
        ? `Initialization failed: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.get<Record<string, never>, ConfigResponse | ErrorResponse>(
  "/api/config",
  async (_req, res): Promise<void> => {
    try {
      const config = await getConfig();
      res.json({ type: "config", config });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to get config: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<
  Record<string, never>,
  ConfigUpdateResponse | ErrorResponse,
  ConfigUpdateRequest
>("/api/config", async (req, res): Promise<void> => {
  try {
    const configUsername = await getCurrentUsername();
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
    if (body.customTransformCode !== undefined) {
      fields["customTransformCode"] = body.customTransformCode ?? "";
    }
    if (body.wikiTitle !== undefined) {
      fields["wikiTitle"] = body.wikiTitle;
    }
    if (body.wikiDescription !== undefined) {
      fields["wikiDescription"] = body.wikiDescription;
    }
    if (
      body.homeBackground &&
      VALID_HOME_BACKGROUNDS.has(body.homeBackground)
    ) {
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
      fields["minAccountAgeDays"] = String(
        Math.max(0, Math.floor(body.minAccountAgeDays)),
      );
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
      fields["votingDurationDays"] = String(
        Math.max(0, Math.floor(body.votingDurationDays)),
      );
    }
    if (body.votingAllowVoteChange !== undefined) {
      fields["votingAllowVoteChange"] = body.votingAllowVoteChange
        ? "true"
        : "false";
    }
    if (body.votingChangeCooldownMinutes !== undefined) {
      fields["votingChangeCooldownMinutes"] = String(
        Math.max(0, Math.floor(body.votingChangeCooldownMinutes)),
      );
    }
    if (body.votingShowVoterNames !== undefined) {
      fields["votingShowVoterNames"] = body.votingShowVoterNames
        ? "true"
        : "false";
    }
    if (body.votingVoterMinKarma !== undefined) {
      fields["votingVoterMinKarma"] = String(
        Math.max(0, Math.floor(body.votingVoterMinKarma)),
      );
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
      await Promise.all(
        entries.map(([k, v]) => redis.hSet("config", { [k]: v })),
      );
    }

    const config = await getConfig();
    res.json({ type: "config-updated", config });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to update config: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

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

router.post<
  Record<string, never>,
  MappingResponse | ErrorResponse,
  MappingUpdateRequest
>("/api/mapping", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    if (!(await checkIsAllMod(username))) {
      res.status(403).json({ status: "error", message: "Not authorized" });
      return;
    }
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
      error instanceof Error
        ? `Failed to save mapping: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

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
const VALID_FONT_FAMILIES = new Set<string>([
  "system",
  "serif",
  "mono",
  "subreddit",
]);

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
  const r = Math.max(
    0,
    parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount),
  );
  const g = Math.max(
    0,
    parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount),
  );
  const b = Math.max(
    0,
    parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount),
  );
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function parseColorTheme(
  raw: Record<string, string>,
  defaults: ColorTheme,
): ColorTheme {
  return {
    accentColor:
      raw["accentColor"] && VALID_HEX.test(raw["accentColor"])
        ? raw["accentColor"]!
        : defaults.accentColor,
    linkColor:
      raw["linkColor"] && VALID_HEX.test(raw["linkColor"])
        ? raw["linkColor"]!
        : defaults.linkColor,
    bgColor:
      raw["bgColor"] && VALID_HEX.test(raw["bgColor"])
        ? raw["bgColor"]!
        : defaults.bgColor,
    textColor:
      raw["textColor"] && VALID_HEX.test(raw["textColor"])
        ? raw["textColor"]!
        : defaults.textColor,
    textMuted:
      raw["textMuted"] && VALID_HEX.test(raw["textMuted"])
        ? raw["textMuted"]!
        : defaults.textMuted,
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

async function getStyle(
  appearance?: SubredditAppearance | undefined,
): Promise<StyleConfig> {
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

/**
 * Compares two dotted numeric version strings (e.g. "0.0.42.1").
 * Returns -1 if a < b, 1 if a > b, 0 if equal. Non-numeric / missing
 * components are treated as 0, so "1.2" and "1.2.0" compare equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? "0", 10) || 0;
    const nb = parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

const LATEST_VERSION_CACHE_KEY = "appLatestVersion";
const LATEST_VERSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches the app's developer-portal versions page and extracts the version
 * tagged "(latest)". The page is a public listing of the form
 * "0.0.42 (latest)"; we match the version token immediately preceding that
 * marker. Result is cached in Redis to avoid hitting the portal on every load.
 * Returns null when the page is unreachable or the marker is absent.
 */
async function fetchLatestVersion(slug: string): Promise<string | null> {
  const cached = await redis.get(LATEST_VERSION_CACHE_KEY).catch(() => null);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://developers.reddit.com/apps/${slug}/app-versions`,
      { headers: { accept: "text/html" } },
    );
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/([0-9]+(?:\.[0-9]+)+)\s*\(latest\)/i);
    const latest = match?.[1] ?? null;
    if (latest) {
      await redis
        .set(LATEST_VERSION_CACHE_KEY, latest, {
          expiration: new Date(Date.now() + LATEST_VERSION_TTL_MS),
        })
        .catch(() => {});
    }
    return latest;
  } catch {
    return null;
  }
}

router.get<Record<string, never>, VersionResponse>(
  "/api/version",
  async (_req, res): Promise<void> => {
    const current = context.appVersion ?? "";
    const slug = context.appSlug || context.appName || "echo-wiki";
    const latest = await fetchLatestVersion(slug);
    const updateAvailable =
      latest != null &&
      current.length > 0 &&
      compareVersions(latest, current) > 0;
    res.json({ type: "version", current, latest, updateAvailable });
  },
);

router.post<
  Record<string, never>,
  StyleResponse | ErrorResponse,
  StyleUpdateRequest
>("/api/style", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    if (!(await checkIsAllMod(username))) {
      res.status(403).json({ status: "error", message: "Not authorized" });
      return;
    }
    const body = req.body as StyleUpdateRequest;
    const appearance = await getSubredditAppearance();

    if (body.reset) {
      await Promise.all([
        redis.del("style"),
        redis.del("style:light"),
        redis.del("style:dark"),
      ]);
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
      await Promise.all(
        entries.map(([k, v]) => redis.hSet("style", { [k]: v })),
      );
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
      error instanceof Error
        ? `Failed to update style: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

// Pages the app reserves for its own use and must never surface in user-facing
// page lists: the `config/` namespace holds app configuration, and `echowiki/`
// is the internal namespace (e.g. the dev self-test target `echowiki/selftest`,
// which Reddit wikis can't truly delete once written).
function isListableWikiPage(page: string): boolean {
  return !page.startsWith("config/") && !page.startsWith("echowiki/");
}

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
      const filtered = allPages.filter(isListableWikiPage);
      const toCheck = filtered.slice(0, 50);
      const results = await Promise.allSettled(
        toCheck.map((page) =>
          reddit.getWikiPage(subreddit, page).then(() => page),
        ),
      );
      const pages = results
        .filter(
          (r): r is PromiseFulfilledResult<string> => r.status === "fulfilled",
        )
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

router.post<
  Record<string, never>,
  WikiUpdateResponse | ErrorResponse,
  WikiUpdateRequest
>("/api/wiki/update", async (req, res): Promise<void> => {
  try {
    const updatingUsername = await getCurrentUsername();
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
      error instanceof Error
        ? `Failed to update wiki: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

// Drop any index list line whose link targets `page` (our created-page link
// format). Used when a page is deleted so it disappears from navigation.
async function removePageFromIndex(
  subreddit: string,
  page: string,
  username: string,
): Promise<void> {
  let indexContent = "";
  try {
    const idx = await reddit.getWikiPage(subreddit, "index");
    indexContent = idx.content ?? "";
  } catch {
    return;
  }
  if (!indexContent.includes(`/wiki/${page})`)) return;
  const lines = indexContent.split("\n");
  const kept = lines.filter((l) => !l.includes(`/wiki/${page})`));
  if (kept.length === lines.length) return;
  await reddit.updateWikiPage({
    subredditName: subreddit,
    page: "index",
    content: kept.join("\n"),
    reason: `${username}: unlinked ${page} via EchoWiki`,
  });
}

// Full wiki page list (including orphaned/unlisted pages) for the "all pages"
// dropdown. Unlike /api/wiki/pages this skips the existence probe and 50-item
// cap so everyone can reach every page.
router.get<Record<string, never>, WikiAllPagesResponse | ErrorResponse>(
  "/api/wiki/all-pages",
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
      const pages = allPages.filter(isListableWikiPage).sort();
      res.json({ type: "wiki-all-pages", pages });
    } catch {
      res.json({ type: "wiki-all-pages", pages: [] });
    }
  },
);

// Create a child page of `parentPage` and link it from the index. Moderators
// only. The slug is derived from the title; index children become top-level.
router.post<
  Record<string, never>,
  WikiCreateResponse | ErrorResponse,
  WikiCreateRequest
>("/api/wiki/create", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    if (!(await checkIsMod(username))) {
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
    const body = req.body as WikiCreateRequest;
    const title = (body.title ?? "").trim();
    if (!title) {
      res.status(400).json({ status: "error", message: "Title is required" });
      return;
    }
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!slug) {
      res.status(400).json({
        status: "error",
        message: "Title must contain letters or numbers.",
      });
      return;
    }
    const parent = (body.parentPage ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
    const parentPrefix = parent && parent !== "index" ? `${parent}/` : "";
    const page = `${parentPrefix}${slug}`;

    let exists = false;
    try {
      await reddit.getWikiPage(subreddit, page);
      exists = true;
    } catch {}
    if (exists) {
      res.status(409).json({
        status: "error",
        message: `A page already exists at "${page}".`,
      });
      return;
    }

    await reddit.createWikiPage({
      subredditName: subreddit,
      page,
      content: `# ${title}\n`,
      reason: `${username}: created via EchoWiki`,
    });
    res.json({ type: "wiki-created", page, title });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to create page: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

// Revision history for a page (moderators only).
router.get<Record<string, never>, WikiHistoryResponse | ErrorResponse>(
  "/api/wiki/history",
  async (req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
      if (!username || !(await checkIsMod(username))) {
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
      const page = (req.query["page"] as string) || "index";
      const listing = reddit.getWikiPageRevisions({
        subredditName: subreddit,
        page,
        limit: 25,
      });
      const revs = await listing.get(25);
      const revisions: WikiRevisionInfo[] = revs.map((r) => {
        let author = "[unknown]";
        try {
          author = r.author?.username ?? "[unknown]";
        } catch {}
        return {
          id: r.id,
          author,
          timestamp: r.date instanceof Date ? r.date.getTime() : 0,
          reason: r.reason ?? "",
          hidden: r.hidden,
        };
      });
      res.json({ type: "wiki-history", page, revisions });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to load history: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

// Page content at a specific revision (for the history diff view). Moderators
// only, matching /api/wiki/history. An empty `id` returns null so the caller can
// diff a page's first revision against an empty baseline.
router.get<Record<string, never>, WikiRevisionContentResponse | ErrorResponse>(
  "/api/wiki/revision",
  async (req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
      if (!username || !(await checkIsMod(username))) {
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
      const page = (req.query["page"] as string) || "index";
      const id = (req.query["id"] as string) || "";
      if (!id) {
        res.json({ type: "wiki-revision-content", content: null });
        return;
      }
      const wp = await reddit.getWikiPage(
        subreddit,
        page,
        id as `${string}-${string}-${string}-${string}-${string}`,
      );
      res.json({ type: "wiki-revision-content", content: wp.content });
    } catch {
      res.json({ type: "wiki-revision-content", content: null });
    }
  },
);

// "Delete" a page: Reddit has no hard delete, so we tombstone the content,
// unlist it, and remove its index link. Moderators only; the index is protected.
router.post<
  Record<string, never>,
  WikiDeleteResponse | ErrorResponse,
  WikiDeleteRequest
>("/api/wiki/delete", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    if (!(await checkIsMod(username))) {
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
    const body = req.body as WikiDeleteRequest;
    const page = (body.page ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (!page || page === "index") {
      res
        .status(400)
        .json({ status: "error", message: "This page cannot be deleted." });
      return;
    }
    await reddit.updateWikiPage({
      subredditName: subreddit,
      page,
      content: "_This page has been deleted._",
      reason: `${username}: deleted via EchoWiki`,
    });
    try {
      const settings = await reddit.getWikiPageSettings(subreddit, page);
      await reddit.updateWikiPageSettings({
        subredditName: subreddit,
        page,
        listed: false,
        permLevel: settings.permLevel,
      });
    } catch {}
    await removePageFromIndex(subreddit, page, username);
    res.json({ type: "wiki-deleted", page });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to delete page: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.get<Record<string, never>, WikiSuggestionResponse | ErrorResponse>(
  "/api/wiki/suggestion",
  async (_req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
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

router.post<
  Record<string, never>,
  WikiSuggestionResponse | ErrorResponse,
  WikiSuggestionRequest
>("/api/wiki/suggestion", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const config = await getConfig();
    if (!config.collaborativeMode) {
      res.status(403).json({
        status: "error",
        message: "Collaborative mode is not enabled.",
      });
      return;
    }

    const subreddit = context.subredditName;
    if (!subreddit) {
      res
        .status(400)
        .json({ status: "error", message: "Subreddit context not available" });
      return;
    }

    const body = req.body as WikiSuggestionRequest;

    if (!body.description || body.description.trim().length < 10) {
      res.status(400).json({
        status: "error",
        message: "Description must be at least 10 characters.",
      });
      return;
    }

    const isMod = await checkIsMod(username);

    if (!isMod) {
      const bannedList = await reddit
        .getBannedWikiContributors({ subredditName: subreddit, username })
        .all()
        .catch(() => []);

      if (bannedList.length > 0) {
        res.status(403).json({
          status: "error",
          message: "You are banned from editing this wiki.",
        });
        return;
      }

      const eligible = await checkEligibility(
        username,
        config.minKarma,
        config.minAccountAgeDays,
      );
      if (!eligible) {
        const parts: string[] = [];
        if (config.minKarma > 0)
          parts.push(`${config.minKarma.toLocaleString()} karma`);
        if (config.minAccountAgeDays > 0)
          parts.push(`account at least ${config.minAccountAgeDays} days old`);
        res.status(403).json({
          status: "error",
          message: `You don't meet the requirements to suggest changes: ${parts.join(" and ")}.`,
        });
        return;
      }
    }

    const existingRaw = await redis
      .get(`suggestion:${username}`)
      .catch(() => null);
    const existingSuggestion = existingRaw
      ? (JSON.parse(existingRaw) as WikiSuggestion)
      : null;

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
      const lastEditAt =
        existingSuggestion.lastEditAt ?? existingSuggestion.createdAt;
      const elapsedMinutes = (now - lastEditAt) / 60000;
      if (elapsedMinutes < config.suggestionEditCooldownMinutes) {
        const remaining = Math.ceil(
          config.suggestionEditCooldownMinutes - elapsedMinutes,
        );
        res.status(429).json({
          status: "error",
          message: `Edit cooldown: ${remaining} minute${remaining !== 1 ? "s" : ""} remaining before you can update your suggestion.`,
        });
        return;
      }
    }
    // Capture the diff baseline once, when the suggestion is first authored.
    // On edits the change hasn't been applied yet, so the original baseline
    // still holds: preserve it rather than re-reading the live page.
    const baseContent =
      existingSuggestion?.baseContent ??
      (await readPageContent(subreddit, body.page));
    const suggestion: WikiSuggestion = {
      username,
      page: body.page,
      content: body.content,
      description: body.description,
      createdAt: existingSuggestion ? existingSuggestion.createdAt : now,
      baseContent,
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
      const existingVotingPostId = await redis
        .get(`votingPostId:${username}`)
        .catch(() => null);
      if (existingVotingPostId) {
        // Updating suggestion: reset votes and status
        await Promise.all([
          redis.del(`votes:${username}`),
          redis.set(
            `voteStatus:${username}`,
            JSON.stringify({
              status: "active",
              decidedAt: null,
              deadlineAt:
                config.votingDurationDays > 0
                  ? now + config.votingDurationDays * 86400 * 1000
                  : null,
              reason: null,
            }),
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
          const oldJobId = await redis
            .get(`voteJobId:${username}`)
            .catch(() => null);
          if (oldJobId) {
            try {
              await scheduler.cancelJob(oldJobId);
            } catch {}
          }
          const jobId = await scheduler.runJob({
            id: `vote-deadline-${username}-${Date.now()}`,
            name: "vote-deadline",
            data: { username, postId: existingVotingPostId },
            runAt: new Date(now + config.votingDurationDays * 86400 * 1000),
          } as ScheduledJob);
          await redis.set(`voteJobId:${username}`, jobId);
        }
      } else {
        // New suggestion: create voting post
        await createVotingPost(username, suggestion, config, subreddit, now);
      }
    }

    res.json({ type: "wiki-suggestion", suggestion });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to submit suggestion: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.delete<
  Record<string, never>,
  WikiSuggestionActionResponse | ErrorResponse
>("/api/wiki/suggestion", async (_req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const votingPostId = await redis
      .get(`votingPostId:${username}`)
      .catch(() => null);

    const [withdrawnRaw, withdrawnVotesRaw] = await Promise.all([
      redis.get(`suggestion:${username}`).catch(() => null),
      votingPostId
        ? redis.hGetAll(`votes:${username}`).catch(() => null)
        : Promise.resolve(null),
    ]);
    const withdrawnSuggestion = withdrawnRaw
      ? (JSON.parse(withdrawnRaw) as WikiSuggestion)
      : null;
    const withdrawnVoters = parseVoteEntries(withdrawnVotesRaw);
    const withdrawnAcceptCount = withdrawnVoters.filter(
      (v) => v.vote === "accept",
    ).length;
    const withdrawnRejectCount = withdrawnVoters.filter(
      (v) => v.vote === "reject",
    ).length;

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
      const existingRaw = await redis
        .get(`votingPost:${votingPostId}`)
        .catch(() => null);
      const baseData = existingRaw
        ? (JSON.parse(existingRaw) as {
            username: string;
            subredditName: string;
          })
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
                    previousDescriptions:
                      withdrawnSuggestion.previousDescriptions,
                  },
                }
              : {}),
            acceptCount: withdrawnAcceptCount,
            rejectCount: withdrawnRejectCount,
            voters: withdrawnVoters,
          }),
        ),
        redis.del(`votingPostId:${username}`),
        redis.del(`votes:${username}`),
        redis.set(
          `voteStatus:${username}`,
          JSON.stringify({
            status: "cancelled",
            decidedAt,
            reason: "cancelled",
          }),
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
      error instanceof Error
        ? `Failed to delete suggestion: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

// Per-user in-progress edit draft. Only one draft per user is kept (the latest
// overwrites any previous one), so a user is warned before starting a new edit
// elsewhere. Drafts expire after 30 days of inactivity.
const DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;

router.get<Record<string, never>, WikiDraftResponse | ErrorResponse>(
  "/api/wiki/draft",
  async (_req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
      if (!username) {
        res.json({ type: "wiki-draft", draft: null });
        return;
      }
      const raw = await redis.get(`draft:${username}`);
      const draft = raw ? (JSON.parse(raw) as WikiDraft) : null;
      res.json({ type: "wiki-draft", draft });
    } catch {
      res.json({ type: "wiki-draft", draft: null });
    }
  },
);

router.post<
  Record<string, never>,
  WikiDraftActionResponse | ErrorResponse,
  WikiDraftRequest
>("/api/wiki/draft", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const body = req.body as WikiDraftRequest;
    if (typeof body.page !== "string" || typeof body.content !== "string") {
      res.status(400).json({ status: "error", message: "Invalid draft." });
      return;
    }
    const draft: WikiDraft = {
      page: body.page,
      content: body.content,
      mode: body.mode === "edit" ? "edit" : "suggest",
      updatedAt: Date.now(),
    };
    await redis.set(`draft:${username}`, JSON.stringify(draft), {
      expiration: new Date(Date.now() + DRAFT_TTL_SECONDS * 1000),
    });
    res.json({ type: "wiki-draft-action" });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to save draft: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.delete<Record<string, never>, WikiDraftActionResponse | ErrorResponse>(
  "/api/wiki/draft",
  async (_req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
      if (!username) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      await redis.del(`draft:${username}`);
      res.json({ type: "wiki-draft-action" });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to discard draft: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, WikiSuggestionsResponse | ErrorResponse>(
  "/api/wiki/suggestions",
  async (_req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
      if (!username) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const [isMod, config] = await Promise.all([
        checkIsMod(username),
        getConfig(),
      ]);
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
            const votingPostId = await redis
              .get(`votingPostId:${username}`)
              .catch(() => null);
            let voteStatus: VoteStatus | null = null;
            if (votingPostId) {
              voteStatus = await getVoteStatus(
                username,
                config,
                username,
                false,
              );
            }
            suggestions.push({
              ...suggestion,
              votingPostId: votingPostId ?? null,
              voteStatus,
            });
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
            const votingPostId = await redis
              .get(`votingPostId:${m.member}`)
              .catch(() => null);
            let voteStatus: VoteStatus | null = null;
            if (votingPostId) {
              voteStatus = await getVoteStatus(
                m.member,
                config,
                username,
                isMod,
              );
            }
            suggestions.push({
              ...suggestion,
              votingPostId: votingPostId ?? null,
              voteStatus,
            });
          } catch {}
        }
      }
      res.json({ type: "wiki-suggestions", suggestions });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to list suggestions: ${error.message}`
          : "Unknown error";
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
    const modUsername = await getCurrentUsername();
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
      res
        .status(400)
        .json({ status: "error", message: "Subreddit context not available" });
      return;
    }
    const body = req.body as WikiSuggestionActionRequest;
    const raw = await redis.get(`suggestion:${body.username}`);
    if (!raw) {
      res
        .status(404)
        .json({ status: "error", message: "Suggestion not found" });
      return;
    }
    const suggestion = JSON.parse(raw) as WikiSuggestion;
    // Reason is optional for an approval.
    const acceptReason = body.reason?.trim() || null;
    const acceptBaseContent = await readPageContent(subreddit, suggestion.page);
    await reddit.updateWikiPage({
      subredditName: subreddit,
      page: suggestion.page,
      content: suggestion.content,
      reason: `${modUsername} accepted suggestion by ${suggestion.username}: ${suggestion.description}`,
    });
    await recordDecision(
      suggestion,
      acceptBaseContent,
      "approved",
      modUsername,
      false,
      acceptReason,
    );
    const [, , newCount, basicFlairId, advCountRaw, advFlairId] =
      await Promise.all([
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
      const earnedIds: string[] = rawEarned
        ? (JSON.parse(rawEarned) as string[])
        : [];

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
    const votingPostId = await redis
      .get(`votingPostId:${body.username}`)
      .catch(() => null);
    if (votingPostId) {
      const modVotesRaw = await redis
        .hGetAll(`votes:${body.username}`)
        .catch(() => null);
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
        undefined,
        modUsername,
        acceptReason,
      );
    }

    res.json({ type: "wiki-suggestion-action" });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to accept suggestion: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.post<
  Record<string, never>,
  WikiSuggestionActionResponse | ErrorResponse,
  WikiSuggestionActionRequest
>("/api/wiki/suggestion/deny", async (req, res): Promise<void> => {
  try {
    const modUsername = await getCurrentUsername();
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
      res
        .status(400)
        .json({ status: "error", message: "Subreddit context not available" });
      return;
    }
    const body = req.body as WikiSuggestionActionRequest;

    // A reason is mandatory when denying a contribution.
    const denyReason = body.reason?.trim();
    if (!denyReason) {
      res.status(400).json({
        status: "error",
        message: "A reason is required to deny a contribution.",
      });
      return;
    }

    const denyVotingPostId = await redis
      .get(`votingPostId:${body.username}`)
      .catch(() => null);
    const [deniedRaw, deniedVotesRaw] = await Promise.all([
      redis.get(`suggestion:${body.username}`).catch(() => null),
      denyVotingPostId
        ? redis.hGetAll(`votes:${body.username}`).catch(() => null)
        : Promise.resolve(null),
    ]);
    const deniedSuggestion = deniedRaw
      ? (JSON.parse(deniedRaw) as WikiSuggestion)
      : null;
    let denyAcceptCount = 0;
    let denyRejectCount = 0;
    for (const v of Object.values(deniedVotesRaw ?? {})) {
      const colonIdx = v.indexOf(":");
      if (colonIdx < 0) continue;
      const voteType = v.slice(0, colonIdx);
      if (voteType === "accept") denyAcceptCount++;
      else if (voteType === "reject") denyRejectCount++;
    }

    if (deniedSuggestion) {
      const base = await readPageContent(subreddit, deniedSuggestion.page);
      await recordDecision(
        deniedSuggestion,
        base,
        "denied",
        modUsername,
        false,
        denyReason,
      );
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
        undefined,
        modUsername,
        denyReason,
      );
    }

    res.json({ type: "wiki-suggestion-action" });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to deny suggestion: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

// Strip server-only fields and (for non-mods) redact moderator identity.
function toClientHistoryEntry(
  entry: StoredHistoryEntry,
  isMod: boolean,
  votingEnabled: boolean,
): WikiHistoryEntry {
  const events: WikiHistoryEvent[] = entry.events.map((e) =>
    isMod ? e : { ...e, by: null },
  );
  return {
    id: entry.id,
    author: entry.author,
    page: entry.page,
    description: entry.description,
    status: entry.status,
    events,
    updatedAt: entry.updatedAt,
    canRevert: isMod && entry.status !== "pending",
    canRestartVote: isMod && votingEnabled && entry.status !== "pending",
  };
}

// Contributions > History. Mods see every entry with full detail; a regular user
// sees only their own decided suggestions, with moderator identities redacted
// ("a moderator acted"). Capped at the 10 most recent (newest first).
router.get<Record<string, never>, WikiContribHistoryResponse | ErrorResponse>(
  "/api/wiki/contrib-history",
  async (_req, res): Promise<void> => {
    try {
      const username = await getCurrentUsername();
      if (!username) {
        res.json({
          type: "wiki-contrib-history",
          entries: [],
          isMod: false,
          hasMore: false,
        });
        return;
      }
      const [isMod, config] = await Promise.all([
        checkIsMod(username),
        getConfig(),
      ]);
      const key = isMod ? HISTORY_GLOBAL_KEY : `history:user:${username}`;
      const all = await redis.zRange(key, 0, -1).catch(() => []);
      // zRange is ascending by score; newest (highest score) first.
      const idsNewestFirst = all.map((m) => m.member).reverse();
      const top = idsNewestFirst.slice(0, 10);
      const loaded = await Promise.all(top.map((id) => loadHistoryEntry(id)));
      const entries = loaded
        .filter((e): e is StoredHistoryEntry => e !== null)
        .map((e) =>
          toClientHistoryEntry(e, isMod, config.votingEnabled ?? false),
        );
      res.json({
        type: "wiki-contrib-history",
        entries,
        isMod,
        hasMore: idsNewestFirst.length > top.length,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to load history: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

// Moderator actions on a history entry: post-mortem approve a denied suggestion,
// revert an approved one, or restart its vote. Page-content actions auto-merge
// (git-style) against the live page; a conflict is reported (unless `force`) so
// the client can warn before applying the marked merge.
router.post<
  Record<string, never>,
  WikiHistoryActionResponse | ErrorResponse,
  WikiHistoryActionRequest
>("/api/wiki/contrib-history/action", async (req, res): Promise<void> => {
  try {
    const modUsername = await getCurrentUsername();
    if (!modUsername || !(await checkIsMod(modUsername))) {
      res.status(403).json({ status: "error", message: "Not authorized" });
      return;
    }
    const subreddit = context.subredditName;
    if (!subreddit) {
      res
        .status(400)
        .json({ status: "error", message: "Subreddit context not available" });
      return;
    }
    const body = req.body as WikiHistoryActionRequest;
    const entry = await loadHistoryEntry(body.id);
    if (!entry) {
      res
        .status(404)
        .json({ status: "error", message: "History entry not found" });
      return;
    }
    const now = Date.now();

    if (body.action === "restart-vote") {
      if (entry.status === "pending") {
        res
          .status(400)
          .json({ status: "error", message: "This suggestion is still open." });
        return;
      }
      const existing = await redis
        .get(`suggestion:${entry.author}`)
        .catch(() => null);
      if (existing) {
        res.status(409).json({
          status: "error",
          message: `${entry.author} already has an open suggestion; resolve it first.`,
        });
        return;
      }
      // If the contribution is currently APPROVED, its change is live on the
      // page. Re-voting on something that's already applied is contradictory, so
      // first revert the page back to the pre-suggestion baseline; the fresh
      // vote then decides whether to (re-)apply it. A DENIED contribution isn't
      // applied, so there's nothing to revert: just reopen the vote.
      let revertedOnRestart = false;
      if (entry.status === "approved") {
        const ours = await readPageContent(subreddit, entry.page);
        const { merged } = threeWayMerge(
          entry.proposedContent,
          ours,
          entry.baseContent,
          { ours: "current page", theirs: "pre-suggestion" },
        );
        if (merged !== ours) {
          await reddit.updateWikiPage({
            subredditName: subreddit,
            page: entry.page,
            content: merged,
            reason: `${modUsername} reverted ${entry.author}'s suggestion to restart its vote`,
          });
          revertedOnRestart = true;
        }
      }
      // Keep the original createdAt so the eventual re-decision appends to THIS
      // history entry (id = `author:createdAt`) rather than starting a new one.
      const sepIdx = entry.id.lastIndexOf(":");
      const originalCreatedAt = Number(entry.id.slice(sepIdx + 1)) || now;
      const reopened: WikiSuggestion = {
        username: entry.author,
        page: entry.page,
        content: entry.proposedContent,
        description: entry.description,
        createdAt: originalCreatedAt,
        // Preserve the original pre-suggestion baseline so the re-opened vote
        // diffs proposed-vs-base, not proposed-vs-live-page. The change may
        // already be applied to the page (e.g. a previously-approved
        // contribution being re-voted), which would otherwise show an empty diff.
        baseContent: entry.baseContent,
      };
      await Promise.all([
        redis.set(`suggestion:${entry.author}`, JSON.stringify(reopened)),
        redis.zAdd("suggestions", { member: entry.author, score: now }),
      ]);
      // Re-open the actual vote: when voting is enabled in collaborative mode a
      // restarted suggestion needs a fresh voting post (and "Go to vote" link),
      // just like a newly submitted one. Without this the suggestion only
      // reappears in the mod pending list with no vote attached.
      const config = await getConfig();
      if (config.votingEnabled && config.collaborativeMode) {
        await createVotingPost(entry.author, reopened, config, subreddit, now);
      }
      entry.status = "pending";
      entry.events.push({
        state: "vote-restarted",
        by: modUsername,
        at: now,
        ...(revertedOnRestart ? { note: "reverted prior approval" } : {}),
      });
      entry.updatedAt = now;
      await saveHistoryEntry(entry);
      res.json({ type: "wiki-history-action" });
      return;
    }

    if (body.action === "approve-postmortem" && entry.status !== "denied") {
      res.status(400).json({
        status: "error",
        message: "Only a denied suggestion can be approved post-mortem.",
      });
      return;
    }
    if (body.action === "revert" && entry.status !== "approved") {
      res.status(400).json({
        status: "error",
        message: "Only an approved suggestion can be reverted.",
      });
      return;
    }

    const ours = await readPageContent(subreddit, entry.page);
    // approve-postmortem replays the suggestion's change (baseContent ->
    // proposedContent); revert undoes it (proposedContent -> baseContent).
    const mergeBase =
      body.action === "approve-postmortem"
        ? entry.baseContent
        : entry.proposedContent;
    const theirs =
      body.action === "approve-postmortem"
        ? entry.proposedContent
        : entry.baseContent;
    const { merged, conflict } = threeWayMerge(mergeBase, ours, theirs, {
      ours: "current page",
      theirs: body.action === "revert" ? "pre-suggestion" : "suggestion",
    });
    const changedSince = ours !== mergeBase;

    if (conflict && !body.force) {
      res.json({ type: "wiki-history-action", conflict: true });
      return;
    }

    await reddit.updateWikiPage({
      subredditName: subreddit,
      page: entry.page,
      content: merged,
      reason: `${modUsername} ${
        body.action === "revert" ? "reverted" : "post-mortem approved"
      } ${entry.author}'s suggestion${conflict ? " (merge conflict)" : ""}`,
    });

    const note = conflict
      ? "merge conflict"
      : changedSince
        ? "auto-merged"
        : undefined;
    // A post-mortem approval is a decision and may carry the mod's reason
    // (optional, like a regular approval); a revert is an undo and carries none.
    const postMortemReason =
      body.action === "approve-postmortem" ? body.reason?.trim() : undefined;
    entry.status = body.action === "revert" ? "denied" : "approved";
    entry.events.push({
      state: body.action === "revert" ? "reverted" : "approved-postmortem",
      by: modUsername,
      at: now,
      ...(note ? { note } : {}),
      ...(postMortemReason ? { reason: postMortemReason } : {}),
    });
    entry.updatedAt = now;
    await saveHistoryEntry(entry);

    res.json({
      type: "wiki-history-action",
      merged: changedSince && !conflict,
      ...(conflict ? { conflict: true } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to apply action: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.get<Record<string, never>, CollabInfoResponse | ErrorResponse>(
  "/api/wiki/collab-info",
  async (_req, res): Promise<void> => {
    try {
      const modUsername = await getCurrentUsername();
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
        res.status(400).json({
          status: "error",
          message: "Subreddit context not available",
        });
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
      const flairTemplates: FlairTemplateInfo[] = userFlairTemplatesRaw.map(
        (t) => ({
          id: t.id,
          text: t.text,
          textColor: t.textColor,
          backgroundColor: t.backgroundColor,
        }),
      );
      const linkFlairTemplates: FlairTemplateInfo[] = linkFlairTemplatesRaw.map(
        (t) => ({
          id: t.id,
          text: t.text,
          textColor: t.textColor,
          backgroundColor: t.backgroundColor,
        }),
      );
      const wikiEditMode = subInfo?.wikiSettings?.wikiEditMode ?? null;

      res.json({
        type: "collab-info",
        wikiEditMode,
        banned,
        flairTemplateId: storedFlairId ?? null,
        flairTemplates,
        linkFlairTemplates,
        advancedContributorCount: Math.max(
          0,
          parseInt(advCountRaw ?? "0", 10) || 0,
        ),
        advancedContributorFlairTemplateId: advFlairId ?? null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to get collab info: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<
  Record<string, never>,
  SuggestionFlairResponse | ErrorResponse,
  SuggestionFlairRequest
>("/api/wiki/suggestion-flair", async (req, res): Promise<void> => {
  try {
    const modUsername = await getCurrentUsername();
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
    res.json({
      type: "suggestion-flair",
      flairTemplateId: body.flairTemplateId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to save flair setting: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.post<
  Record<string, never>,
  AdvancedContributorResponse | ErrorResponse,
  AdvancedContributorRequest
>("/api/wiki/advanced-contributor", async (req, res): Promise<void> => {
  try {
    const modUsername = await getCurrentUsername();
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
      await redis.set(
        "advancedContributorFlairTemplateId",
        body.flairTemplateId,
      );
    } else {
      await redis.del("advancedContributorFlairTemplateId");
    }
    res.json({
      type: "advanced-contributor",
      count,
      flairTemplateId: body.flairTemplateId,
    });
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
      const username = await getCurrentUsername();
      if (!username || username === "anonymous") {
        res.json({ type: "my-flairs", earned: [], equipped: null });
        return;
      }
      const [rawEarned, equipped, flairTemplatesRaw] = await Promise.all([
        redis.get(`earnedFlairIds:${username}`).catch(() => null),
        redis.get(`equippedFlairId:${username}`).catch(() => null),
        reddit
          .getUserFlairTemplates(context.subredditName ?? "")
          .catch(() => []),
      ]);
      const earnedIds: string[] = rawEarned
        ? (JSON.parse(rawEarned) as string[])
        : [];
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
        error instanceof Error
          ? `Failed to get flairs: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<
  Record<string, never>,
  EquipFlairResponse | ErrorResponse,
  EquipFlairRequest
>("/api/wiki/equip-flair", async (req, res): Promise<void> => {
  try {
    const username = await getCurrentUsername();
    if (!username || username === "anonymous") {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }
    const subreddit = context.subredditName;
    if (!subreddit) {
      res
        .status(400)
        .json({ status: "error", message: "Subreddit context not available" });
      return;
    }
    const body = req.body as EquipFlairRequest;
    if (body.flairTemplateId !== null) {
      const rawEarned = await redis
        .get(`earnedFlairIds:${username}`)
        .catch(() => null);
      const earnedIds: string[] = rawEarned
        ? (JSON.parse(rawEarned) as string[])
        : [];
      if (!earnedIds.includes(body.flairTemplateId)) {
        res.status(403).json({
          status: "error",
          message: "You have not earned this flair.",
        });
        return;
      }
      await reddit.setUserFlair({
        subredditName: subreddit,
        username,
        flairTemplateId: body.flairTemplateId,
      });
      await redis.set(`equippedFlairId:${username}`, body.flairTemplateId);
    } else {
      await reddit.setUserFlair({
        subredditName: subreddit,
        username,
        flairTemplateId: "",
      });
      await redis.del(`equippedFlairId:${username}`);
    }
    res.json({ type: "equip-flair", flairTemplateId: body.flairTemplateId });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to equip flair: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.post<
  Record<string, never>,
  WikiBanResponse | ErrorResponse,
  WikiBanRequest
>("/api/wiki/ban", async (req, res): Promise<void> => {
  try {
    const modUsername = await getCurrentUsername();
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
      res
        .status(400)
        .json({ status: "error", message: "Subreddit context not available" });
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
      error instanceof Error
        ? `Failed to ban user: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.delete<Record<string, never>, WikiBanResponse | ErrorResponse>(
  "/api/wiki/ban",
  async (req, res): Promise<void> => {
    try {
      const modUsername = await getCurrentUsername();
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
        res.status(400).json({
          status: "error",
          message: "Subreddit context not available",
        });
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
        error instanceof Error
          ? `Failed to unban user: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.get<Record<string, never>, WikiBansResponse | ErrorResponse>(
  "/api/wiki/bans",
  async (_req, res): Promise<void> => {
    try {
      const modUsername = await getCurrentUsername();
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
        res.status(400).json({
          status: "error",
          message: "Subreddit context not available",
        });
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
        error instanceof Error
          ? `Failed to list wiki bans: ${error.message}`
          : "Unknown error";
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
      const votingPostRaw = await redis
        .get(`votingPost:${postId}`)
        .catch(() => null);
      if (!votingPostRaw) {
        res.status(404).json({ status: "error", message: "Not a voting post" });
        return;
      }
      const { username: suggestionUsername, subredditName } = JSON.parse(
        votingPostRaw,
      ) as {
        username: string;
        subredditName: string;
      };
      const voterUsername = await getCurrentUsername();
      const config = await getConfig();
      // Polling the status is the natural place to self-heal an expired vote
      // that the scheduler failed to conclude.
      await maybeFinalizeExpiredVote(
        suggestionUsername,
        config,
        postId,
        subredditName || (context.subredditName ?? ""),
      ).catch(() => {});
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
        error instanceof Error
          ? `Failed to get vote: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

router.post<
  Record<string, never>,
  CastVoteResponse | ErrorResponse,
  CastVoteRequest
>("/api/vote", async (req, res): Promise<void> => {
  try {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({ status: "error", message: "No post context" });
      return;
    }
    const votingPostRaw = await redis
      .get(`votingPost:${postId}`)
      .catch(() => null);
    if (!votingPostRaw) {
      res.status(404).json({ status: "error", message: "Not a voting post" });
      return;
    }
    const { username: suggestionUsername, subredditName } = JSON.parse(
      votingPostRaw,
    ) as {
      username: string;
      subredditName: string;
    };

    const voterUsername = await getCurrentUsername();
    if (!voterUsername || voterUsername === "anonymous") {
      res.status(401).json({ status: "error", message: "Not logged in" });
      return;
    }

    const config = await getConfig();

    const statusRaw = await redis
      .get(`voteStatus:${suggestionUsername}`)
      .catch(() => null);
    if (statusRaw) {
      const statusData = JSON.parse(statusRaw) as VoteStatusData;
      if (statusData.status !== "active") {
        res.status(409).json({
          status: "error",
          message: "Voting is closed for this suggestion",
        });
        return;
      }
    }

    // Voter cannot be the suggestion author
    if (voterUsername === suggestionUsername) {
      res.status(403).json({
        status: "error",
        message: "You cannot vote on your own suggestion",
      });
      return;
    }

    // Check voter eligibility
    const eligible = await checkVoterEligibility(voterUsername, config);
    if (!eligible) {
      const parts: string[] = [];
      if (config.votingVoterMinKarma > 0)
        parts.push(`${config.votingVoterMinKarma.toLocaleString()} karma`);
      if (config.votingVoterMinAccountAgeDays > 0)
        parts.push(
          `account at least ${config.votingVoterMinAccountAgeDays} days old`,
        );
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
        res
          .status(403)
          .json({ status: "error", message: "You are banned from this wiki." });
        return;
      }
    } catch {}

    // Check vote change rules
    const existingVoteRaw = await redis
      .hGet(`votes:${suggestionUsername}`, voterUsername)
      .catch(() => null);
    if (existingVoteRaw) {
      if (!config.votingAllowVoteChange) {
        res
          .status(403)
          .json({ status: "error", message: "Vote changes are not allowed" });
        return;
      }
      if (config.votingChangeCooldownMinutes > 0) {
        const colonIdx = existingVoteRaw.indexOf(":");
        if (colonIdx >= 0) {
          const votedAt = parseInt(existingVoteRaw.slice(colonIdx + 1), 10);
          const elapsedMinutes = (Date.now() - votedAt) / 60000;
          if (elapsedMinutes < config.votingChangeCooldownMinutes) {
            const remaining = Math.ceil(
              config.votingChangeCooldownMinutes - elapsedMinutes,
            );
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

    await redis.hSet(`votes:${suggestionUsername}`, {
      [voterUsername]: `${vote}:${Date.now()}`,
    });

    // Check thresholds
    await checkAndMaybeFinalize(
      suggestionUsername,
      config,
      postId,
      subredditName,
    );

    // Return updated state
    const isMod = await checkIsMod(voterUsername);
    const voteStatus = await getVoteStatus(
      suggestionUsername,
      config,
      voterUsername,
      isMod,
    );
    const newVoteRaw = await redis
      .hGet(`votes:${suggestionUsername}`, voterUsername)
      .catch(() => null);
    let myVote: VoteValue | null = null;
    if (newVoteRaw) {
      const colonIdx = newVoteRaw.indexOf(":");
      myVote =
        colonIdx >= 0 ? (newVoteRaw.slice(0, colonIdx) as VoteValue) : null;
    }

    res.json({ type: "vote-cast", voteStatus, myVote });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to cast vote: ${error.message}`
        : "Unknown error";
    res.status(400).json({ status: "error", message });
  }
});

router.delete<Record<string, never>, CastVoteResponse | ErrorResponse>(
  "/api/vote",
  async (_req, res): Promise<void> => {
    try {
      const { postId } = context;
      if (!postId) {
        res.status(400).json({ status: "error", message: "No post context" });
        return;
      }
      const votingPostRaw = await redis
        .get(`votingPost:${postId}`)
        .catch(() => null);
      if (!votingPostRaw) {
        res.status(404).json({ status: "error", message: "Not a voting post" });
        return;
      }
      const { username: suggestionUsername } = JSON.parse(votingPostRaw) as {
        username: string;
        subredditName: string;
      };
      const voterUsername = await getCurrentUsername();
      if (!voterUsername || voterUsername === "anonymous") {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      const config = await getConfig();

      const statusRaw = await redis
        .get(`voteStatus:${suggestionUsername}`)
        .catch(() => null);
      if (statusRaw) {
        const statusData = JSON.parse(statusRaw) as VoteStatusData;
        if (statusData.status !== "active") {
          res
            .status(409)
            .json({ status: "error", message: "Voting is closed" });
          return;
        }
      }
      const existingVoteRaw = await redis
        .hGet(`votes:${suggestionUsername}`, voterUsername)
        .catch(() => null);
      if (!existingVoteRaw) {
        const isMod = await checkIsMod(voterUsername);
        const voteStatus = await getVoteStatus(
          suggestionUsername,
          config,
          voterUsername,
          isMod,
        );
        res.json({ type: "vote-cast", voteStatus, myVote: null });
        return;
      }
      if (!config.votingAllowVoteChange) {
        res
          .status(403)
          .json({ status: "error", message: "Vote changes are not allowed" });
        return;
      }
      if (config.votingChangeCooldownMinutes > 0) {
        const colonIdx = existingVoteRaw.indexOf(":");
        if (colonIdx >= 0) {
          const votedAt = parseInt(existingVoteRaw.slice(colonIdx + 1), 10);
          const elapsedMinutes = (Date.now() - votedAt) / 60000;
          if (elapsedMinutes < config.votingChangeCooldownMinutes) {
            const remaining = Math.ceil(
              config.votingChangeCooldownMinutes - elapsedMinutes,
            );
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
      const voteStatus = await getVoteStatus(
        suggestionUsername,
        config,
        voterUsername,
        isMod,
      );
      res.json({ type: "vote-cast", voteStatus, myVote: null });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to retract vote: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

function normalizePostId(id: string): string {
  return id.startsWith("t3_") ? id : `t3_${id}`;
}

async function getPostIds(): Promise<string[]> {
  let entries: { member: string }[];
  try {
    const legacy = await redis.get("postId");
    if (legacy) {
      const normalized = normalizePostId(legacy);
      await redis.zAdd("postIds", { member: normalized, score: Date.now() });
      await redis.del("postId");
    }
    entries = await redis.zRange("postIds", 0, -1);
  } catch (err) {
    // See getConfig: Redis can fail with an empty gRPC error in menu/trigger
    // contexts. Tracked post ids only gate the optional "delete existing
    // posts" form option: fail open with none rather than block the form.
    console.error("getPostIds: redis read failed, returning none", err);
    return [];
  }

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

async function trackPost(postId: string): Promise<boolean> {
  // Best-effort: Redis can fail with an empty gRPC error in menu/trigger
  // contexts (see getConfig). The post is already created at this point:
  // a tracking failure must not fail the whole operation. Returns whether
  // tracking persisted, so callers can surface a warning.
  try {
    await redis.zAdd("postIds", {
      member: normalizePostId(postId),
      score: Date.now(),
    });
    return true;
  } catch (err) {
    console.error("trackPost: redis.zAdd failed, post not tracked", err);
    return false;
  }
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
      // The "Create EchoWiki" menu is gated to moderators by `forUserType: "moderator"`
      // in devvit.json, and /internal/* endpoints are platform-only: so the caller is
      // already guaranteed to be a moderator. We intentionally do NOT re-resolve and
      // re-check the user here: in menu/trigger contexts the acting user often cannot be
      // resolved (context.username is unset and getCurrentUsername's UserAbout fallback
      // fails with an empty gRPC error), which blocked legitimate moderators: including
      // inactive "everything" mods: from creating posts.
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
                helpText:
                  "Shown on import. Warns if imported game doesn't match",
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
    } catch (err) {
      console.error("post-create menu: failed to build form", err);
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
      // The "Create EchoWiki" menu is gated to moderators by `forUserType: "moderator"`
      // in devvit.json, and /internal/* endpoints are platform-only: so the caller is
      // already guaranteed to be a moderator. We intentionally do NOT re-resolve and
      // re-check the user here: in menu/trigger contexts the acting user often cannot be
      // resolved (context.username is unset and getCurrentUsername's UserAbout fallback
      // fails with an empty gRPC error), which blocked legitimate moderators, including
      // inactive "everything" mods from creating posts.
      const body = req.body as PostCreateFormData;

      const warnings: string[] = [];

      if (body.deleteExisting) {
        const existingIds = await getPostIds();
        for (const id of existingIds) {
          try {
            const fullId = id.startsWith("t3_") ? id : `t3_${id}`;
            const existingPost = await reddit.getPostById(
              fullId as `t3_${string}`,
            );
            await existingPost.delete();
          } catch {
            try {
              const fullId = id.startsWith("t3_") ? id : `t3_${id}`;
              const existingPost = await reddit.getPostById(
                fullId as `t3_${string}`,
              );
              await existingPost.remove();
            } catch {}
          }
        }
        try {
          await redis.del("postIds");
        } catch (err) {
          console.error("post-title-submit: redis.del(postIds) failed", err);
        }
      }

      // The essential action: everything below is best-effort and must not
      // fail post creation if Redis (tracking, config) is unavailable.
      const post = await createPost(body.postTitle);
      const tracked = await trackPost(post.id);
      if (!tracked) warnings.push("Post not tracked (storage unavailable)");

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

      const configFields: Record<string, string> = {
        wikiTitle: body.postTitle,
      };
      if (body.subtitle !== undefined)
        configFields["wikiDescription"] = body.subtitle;
      if (body.gameName !== undefined) configFields["gameName"] = body.gameName;
      try {
        await Promise.all(
          Object.entries(configFields).map(([k, v]) =>
            redis.hSet("config", { [k]: v }),
          ),
        );
      } catch (err) {
        console.error("post-title-submit: redis.hSet(config) failed", err);
        warnings.push("Settings not saved (storage unavailable)");
      }

      const parts = [
        body.deleteExisting ? "Old posts deleted." : "",
        "EchoWiki post created!",
      ];
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

router.post<
  Record<string, never>,
  TaskResponse,
  TaskRequest<{ username: string; postId: string }>
>("/internal/scheduler/vote-deadline", async (req, res): Promise<void> => {
  try {
    const body = req.body as TaskRequest<{ username: string; postId: string }>;
    const data = body.data;
    if (!data?.username || !data.postId) {
      res.status(200).json({ status: "ok" });
      return;
    }
    const { username, postId } = data;

    // Only finalize if still active
    const statusRaw = await redis
      .get(`voteStatus:${username}`)
      .catch(() => null);
    if (statusRaw) {
      const statusData = JSON.parse(statusRaw) as VoteStatusData;
      if (statusData.status !== "active") {
        res.status(200).json({ status: "ok" });
        return;
      }
    }

    const config = await getConfig();
    const subreddit = context.subredditName ?? "";

    await finalizeVoteByDeadline(username, config, postId, subreddit);

    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("vote-deadline scheduler error:", err);
    res.status(200).json({ status: "ok" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dev-only self-test harness
//
// Exercises the contribution / voting / wiki logic end-to-end against the live
// dev subreddit so regressions that are tedious to reproduce by hand (author a
// suggestion, cast / change / withdraw votes, trip a threshold, apply the
// accepted change to the wiki, gate by permissions) can be caught with a single
// button press. The endpoint is gated to the dev subreddit and to moderators.
//
// Isolation: every run uses a unique synthetic author and a dedicated throwaway
// wiki page, and tears down every key it may have written in a `finally` block,
// so a self-test never collides with or leaks into real contribution data.
// ─────────────────────────────────────────────────────────────────────────────

const SELFTEST_WIKI_PAGE = "echowiki/selftest";

async function runDevSelfTests(caller: string): Promise<DevSelfTestResponse> {
  const results: DevTestResult[] = [];
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const u = `__selftest_${nonce}`;
  const fakePostId = `${SELFTEST_POST_PREFIX}${nonce}`;
  const subreddit = context.subredditName ?? "";
  const baseConfig = await getConfig();

  // Per-test execution context. `log`/`step` record the real actions taken;
  // `ok`/`eq` record the real observed value alongside the PASS/FAIL verdict and
  // throw on failure. Every line is produced from live runtime data, so the
  // expandable log is an honest trace of what actually happened: not a script.
  type TestCtx = {
    /** Free-form trace line (an action taken, or a value observed). */
    step: (line: string) => void;
    /** Assert a boolean; logs PASS/FAIL with the claim. Throws on failure. */
    ok: (cond: boolean, claim: string) => void;
    /** Assert equality; logs PASS/FAIL with expected-vs-got. Throws on failure. */
    eq: (actual: unknown, expected: unknown, claim: string) => void;
  };

  const show = (v: unknown): string => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s == null) return String(v);
    return s.length > 200 ? `${s.slice(0, 200)}... (${s.length} chars)` : s;
  };

  const run = async (
    group: string,
    name: string,
    fn: (t: TestCtx) => Promise<void> | void,
  ): Promise<void> => {
    const started = Date.now();
    const log: string[] = [];
    const t: TestCtx = {
      step: (line) => log.push(line),
      ok: (cond, claim) => {
        log.push(`${cond ? "✓ PASS" : "✗ FAIL"}: ${claim}`);
        if (!cond) throw new Error(claim);
      },
      eq: (actual, expected, claim) => {
        const cond = actual === expected;
        log.push(
          `${cond ? "✓ PASS" : "✗ FAIL"}: ${claim}. expected ${show(expected)}, got ${show(actual)}`,
        );
        if (!cond)
          throw new Error(
            `${claim} (expected ${show(expected)}, got ${show(actual)})`,
          );
      },
    };
    try {
      await fn(t);
      results.push({
        group,
        name,
        passed: true,
        detail: "ok",
        durationMs: Date.now() - started,
        log,
      });
    } catch (err) {
      results.push({
        group,
        name,
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
        log,
      });
    }
  };

  const activeStatus = () =>
    JSON.stringify({
      status: "active",
      decidedAt: null,
      deadlineAt: null,
      reason: null,
    });

  try {
    // ── Permissions ──────────────────────────────────────────────────────────
    await run("Permissions", "Caller resolves as a moderator", async (t) => {
      t.step(
        `Calling getModLevel("${caller}") against r/${subreddit}: this hits the live Reddit moderator list + permission API.`,
      );
      const level = await getModLevel(caller);
      t.step(`Reddit reported moderator level: ${show(level)}`);
      t.ok(
        level !== null,
        `u/${caller} is recognised as a moderator (level must be non-null)`,
      );
    });
    await run(
      "Permissions",
      "Open eligibility passes with no requirements",
      async (t) => {
        t.step(
          "checkEligibility(caller, minKarma=0, minAccountAgeDays=0): with no gate, it must short-circuit to eligible.",
        );
        const ok = await checkEligibility(caller, 0, 0);
        t.eq(ok, true, "no requirements => eligible");
      },
    );
    await run(
      "Permissions",
      "Impossible karma requirement blocks a voter",
      async (t) => {
        t.step(
          `getVoterEligibilityInfo("${caller}", { votingVoterMinKarma: ${Number.MAX_SAFE_INTEGER} }): reads the caller's real karma from Reddit and compares.`,
        );
        const info = await getVoterEligibilityInfo(caller, {
          ...baseConfig,
          votingVoterMinKarma: Number.MAX_SAFE_INTEGER,
          votingVoterMinAccountAgeDays: 0,
        });
        t.step(
          `Result: eligible=${info.eligible}, reason=${show(info.reason)}`,
        );
        t.eq(
          info.eligible,
          false,
          "a karma floor of MAX_SAFE_INTEGER rejects any real account",
        );
        t.ok(!!info.reason, "the rejection carries a human-readable reason");
      },
    );

    // ── Storage ──────────────────────────────────────────────────────────────
    await run("Storage", "Redis string round-trips", async (t) => {
      const k = `__selftest_kv_${nonce}`;
      t.step(`redis.set("${k}", "pong")`);
      await redis.set(k, "pong");
      const v = await redis.get(k);
      t.step(`redis.get("${k}") -> ${show(v)}`);
      await redis.del(k);
      t.step(`redis.del("${k}") (cleaned up)`);
      t.eq(v, "pong", "the value read back equals the value written");
    });
    await run("Storage", "Suggestions index add / remove", async (t) => {
      t.step(`redis.zAdd("suggestions", { member: "${u}" })`);
      await redis.zAdd("suggestions", { member: u, score: Date.now() });
      const present = (await redis.zRange("suggestions", 0, -1)).map(
        (e) => e.member,
      );
      t.step(
        `Index holds ${present.length} member(s); contains "${u}": ${present.includes(u)}`,
      );
      t.ok(present.includes(u), "the new suggestion appears in the index");
      t.step(`redis.zRem("suggestions", ["${u}"])`);
      await redis.zRem("suggestions", [u]);
      const absent = (await redis.zRange("suggestions", 0, -1)).map(
        (e) => e.member,
      );
      t.step(`After removal, contains "${u}": ${absent.includes(u)}`);
      t.ok(!absent.includes(u), "the withdrawn suggestion leaves the index");
    });

    // ── Voting tally ─────────────────────────────────────────────────────────
    await run("Voting", "Vote is created", async (t) => {
      await redis.del(`votes:${u}`);
      t.step(`redis.hSet votes:${u} { alice: "accept:<ts>" }`);
      await redis.hSet(`votes:${u}`, { alice: `accept:${Date.now()}` });
      const raw = await redis.hGetAll(`votes:${u}`);
      t.step(`Raw vote hash from Redis: ${show(raw)}`);
      const entries = parseVoteEntries(raw);
      t.step(`parseVoteEntries() -> ${show(entries)}`);
      t.eq(entries.length, 1, "exactly one parsed vote");
      t.eq(entries[0]?.vote, "accept", "the parsed vote type is accept");
    });
    await run(
      "Voting",
      "Vote is updated in place (same voter, accept->reject)",
      async (t) => {
        t.step(
          `redis.hSet votes:${u} { alice: "reject:<ts>" }: same hash field, so it overwrites rather than appends.`,
        );
        await redis.hSet(`votes:${u}`, { alice: `reject:${Date.now()}` });
        const entries = parseVoteEntries(await redis.hGetAll(`votes:${u}`));
        t.step(`parseVoteEntries() -> ${show(entries)}`);
        t.eq(entries.length, 1, "changing a vote does not add a second voter");
        t.eq(entries[0]?.vote, "reject", "the vote now reads reject");
      },
    );
    await run("Voting", "Vote is removed", async (t) => {
      t.step(`redis.hDel votes:${u} ["alice"]`);
      await redis.hDel(`votes:${u}`, ["alice"]);
      const entries = parseVoteEntries(await redis.hGetAll(`votes:${u}`));
      t.step(`parseVoteEntries() -> ${show(entries)}`);
      t.eq(entries.length, 0, "no votes remain after removal");
    });
    await run("Voting", "Tally counts multiple voters", async (t) => {
      await redis.del(`votes:${u}`);
      const ts = Date.now();
      t.step("Seeding votes: alice=accept, bob=accept, carol=reject");
      await redis.hSet(`votes:${u}`, {
        alice: `accept:${ts}`,
        bob: `accept:${ts}`,
        carol: `reject:${ts}`,
      });
      await redis.set(`voteStatus:${u}`, activeStatus());
      const status = await getVoteStatus(u, baseConfig, caller, true);
      t.step(
        `getVoteStatus() -> accept=${status.acceptCount}, reject=${status.rejectCount}, total=${status.totalVoters}`,
      );
      t.eq(status.acceptCount, 2, "accept tally");
      t.eq(status.rejectCount, 1, "reject tally");
      t.eq(status.totalVoters, 3, "total voters");
    });
    await run(
      "Voting",
      "Voter names are redacted when not permitted",
      async (t) => {
        t.step(
          "getVoteStatus(votingShowVoterNames=false, caller=outsider, isMod=false): names must be stripped.",
        );
        const hidden = await getVoteStatus(
          u,
          { ...baseConfig, votingShowVoterNames: false },
          "outsider",
          false,
        );
        t.step(
          `Usernames returned to the outsider: ${show(hidden.votes.map((v) => v.username))}`,
        );
        t.ok(
          hidden.votes.length > 0 &&
            hidden.votes.every((v) => v.username === ""),
          "every voter name is blank for a non-mod outsider",
        );
        t.step("Same config but isMod=true: names must be visible again.");
        const shown = await getVoteStatus(
          u,
          { ...baseConfig, votingShowVoterNames: false },
          "outsider",
          true,
        );
        t.step(
          `Usernames returned to a moderator: ${show(shown.votes.map((v) => v.username))}`,
        );
        t.ok(
          shown.votes.some((v) => v.username !== ""),
          "a moderator still sees the real voter names",
        );
      },
    );

    // ── Threshold conclusion + wiki apply ────────────────────────────────────
    await run(
      "Voting + Wiki",
      "Accept threshold applies the suggestion to the wiki page",
      async (t) => {
        const baseText = `EchoWiki self-test base ${nonce}`;
        const proposed = `EchoWiki self-test applied ${nonce}`;
        t.step(
          `Writing baseline to the real wiki page "${SELFTEST_WIKI_PAGE}": ${show(baseText)}`,
        );
        await reddit.updateWikiPage({
          subredditName: subreddit,
          page: SELFTEST_WIKI_PAGE,
          content: baseText,
          reason: "echowiki self-test setup",
        });
        const before = await readPageContent(subreddit, SELFTEST_WIKI_PAGE);
        t.step(`Re-read page from Reddit before voting: ${show(before)}`);
        t.eq(before, baseText, "the baseline actually landed on the wiki page");

        const suggestion: WikiSuggestion = {
          username: u,
          page: SELFTEST_WIKI_PAGE,
          content: proposed,
          description: "self-test accept",
          createdAt: Date.now(),
          baseContent: baseText,
        };
        const ts = Date.now();
        t.step(
          `Storing a pending suggestion (proposes ${show(proposed)}) and seeding 2 accept votes.`,
        );
        await Promise.all([
          redis.set(`suggestion:${u}`, JSON.stringify(suggestion)),
          redis.set(`votingPostId:${u}`, fakePostId),
          redis.del(`votes:${u}`),
          redis.set(`voteStatus:${u}`, activeStatus()),
        ]);
        await redis.hSet(`votes:${u}`, {
          alice: `accept:${ts}`,
          bob: `accept:${ts}`,
        });
        t.step(
          "Calling the real checkAndMaybeFinalize() with votingAcceptThreshold=2: the same engine the live vote route uses.",
        );
        await checkAndMaybeFinalize(
          u,
          { ...baseConfig, votingAcceptThreshold: 2, votingRejectThreshold: 0 },
          fakePostId,
          subreddit,
        );
        const statusRaw = await redis.get(`voteStatus:${u}`);
        const concluded = statusRaw
          ? (JSON.parse(statusRaw) as VoteStatusData).status
          : null;
        t.step(`voteStatus:${u} after finalize -> ${show(concluded)}`);
        t.eq(concluded, "accepted", "the vote concluded as accepted");

        const after = await readPageContent(subreddit, SELFTEST_WIKI_PAGE);
        t.step(
          `Re-read the wiki page from Reddit after accept: ${show(after)}`,
        );
        t.eq(
          after,
          proposed,
          "the real wiki page now holds the proposed content (proves the full vote->apply path)",
        );
        const leftover = await redis.get(`suggestion:${u}`);
        t.step(`suggestion:${u} after accept -> ${show(leftover)}`);
        t.ok(
          leftover == null,
          "the accepted suggestion was cleared from the queue",
        );
      },
    );
    await run(
      "Voting + Wiki",
      "Reject threshold concludes without changing the page",
      async (t) => {
        const baseText = `EchoWiki self-test reject-base ${nonce}`;
        const proposed = `EchoWiki self-test should-not-apply ${nonce}`;
        t.step(
          `Writing baseline to "${SELFTEST_WIKI_PAGE}": ${show(baseText)}`,
        );
        await reddit.updateWikiPage({
          subredditName: subreddit,
          page: SELFTEST_WIKI_PAGE,
          content: baseText,
          reason: "echowiki self-test setup",
        });
        const suggestion: WikiSuggestion = {
          username: u,
          page: SELFTEST_WIKI_PAGE,
          content: proposed,
          description: "self-test reject",
          createdAt: Date.now(),
          baseContent: baseText,
        };
        const ts = Date.now();
        t.step(
          `Storing a pending suggestion (proposes ${show(proposed)}) and seeding 2 reject votes.`,
        );
        await Promise.all([
          redis.set(`suggestion:${u}`, JSON.stringify(suggestion)),
          redis.set(`votingPostId:${u}`, fakePostId),
          redis.del(`votes:${u}`),
          redis.set(`voteStatus:${u}`, activeStatus()),
        ]);
        await redis.hSet(`votes:${u}`, {
          alice: `reject:${ts}`,
          bob: `reject:${ts}`,
        });
        t.step("Calling checkAndMaybeFinalize() with votingRejectThreshold=2.");
        await checkAndMaybeFinalize(
          u,
          { ...baseConfig, votingAcceptThreshold: 0, votingRejectThreshold: 2 },
          fakePostId,
          subreddit,
        );
        const statusRaw = await redis.get(`voteStatus:${u}`);
        const concluded = statusRaw
          ? (JSON.parse(statusRaw) as VoteStatusData).status
          : null;
        t.step(`voteStatus:${u} after finalize -> ${show(concluded)}`);
        t.eq(concluded, "rejected", "the vote concluded as rejected");
        const after = await readPageContent(subreddit, SELFTEST_WIKI_PAGE);
        t.step(
          `Re-read the wiki page from Reddit after reject: ${show(after)}`,
        );
        t.eq(
          after,
          baseText,
          "a rejected suggestion left the real wiki page unchanged",
        );
      },
    );

    // ── History audit trail ──────────────────────────────────────────────────
    await run("History", "Decision is recorded and retrievable", async (t) => {
      const createdAt = Date.now();
      const id = historyEntryId(u, createdAt);
      const suggestion: WikiSuggestion = {
        username: u,
        page: SELFTEST_WIKI_PAGE,
        content: "x",
        description: "self-test audit",
        createdAt,
        baseContent: "base",
      };
      t.step(
        `recordDecision(approved, by=${caller}) for history id "${id}": writes the audit entry + indexes it.`,
      );
      await recordDecision(
        suggestion,
        "base",
        "approved",
        caller,
        false,
        "self-test",
      );
      const entry = await loadHistoryEntry(id);
      t.step(
        `loadHistoryEntry("${id}") -> ${
          entry
            ? `status=${entry.status}, author=${entry.author}, ${entry.events.length} event(s)`
            : "null"
        }`,
      );
      t.ok(entry != null, "the entry is retrievable from the audit trail");
      t.eq(entry?.status, "approved", "the recorded status is approved");
    });

    // ── Merge engine ─────────────────────────────────────────────────────────
    await run("Merge", "Non-overlapping edits merge cleanly", (t) => {
      const base = "a\nb\nc";
      const ours = "A\nb\nc";
      const theirs = "a\nb\nC";
      t.step(
        `threeWayMerge(base=${show(base)}, ours=${show(ours)}, theirs=${show(theirs)})`,
      );
      const r = threeWayMerge(base, ours, theirs);
      t.step(`-> conflict=${r.conflict}, merged=${show(r.merged)}`);
      t.eq(r.conflict, false, "disjoint edits merge without a conflict");
      t.ok(
        r.merged.includes("A") && r.merged.includes("C"),
        "both sides' edits survive in the merged output",
      );
    });
    await run("Merge", "Conflicting edits are flagged", (t) => {
      const base = "a\nb\nc";
      const ours = "a\nX\nc";
      const theirs = "a\nY\nc";
      t.step(
        `threeWayMerge(base=${show(base)}, ours=${show(ours)}, theirs=${show(theirs)}): both change the same line differently.`,
      );
      const r = threeWayMerge(base, ours, theirs);
      t.step(`-> conflict=${r.conflict}, merged=${show(r.merged)}`);
      t.eq(r.conflict, true, "divergent edits to the same line conflict");
      t.ok(
        r.merged.includes("<<<<<<<"),
        "git-style conflict markers are emitted",
      );
    });
    await run("Merge", "Identical sides are a no-op", (t) => {
      const r = threeWayMerge("a\nb", "a\nb", "a\nb");
      t.step(`threeWayMerge of identical sides -> ${show(r)}`);
      t.eq(r.conflict, false, "identical content never conflicts");
      t.eq(r.merged, "a\nb", "identical content passes straight through");
    });
  } finally {
    // Best-effort teardown of everything the suite may have written.
    await Promise.all(
      [
        redis.del(`suggestion:${u}`),
        redis.del(`votes:${u}`),
        redis.del(`voteStatus:${u}`),
        redis.del(`votingPostId:${u}`),
        redis.del(`voteJobId:${u}`),
        redis.del(`acceptedCount:${u}`),
        redis.del(`earnedFlairIds:${u}`),
        redis.del(`votingPost:${fakePostId}`),
        redis.del(`votingBotCommentId:${fakePostId}`),
        redis.del(`votingBotCommentList:${fakePostId}`),
        redis.del(`votingBotCommentStatus:${fakePostId}`),
        redis.zRem("suggestions", [u]),
      ].map((p) => Promise.resolve(p).catch(() => {})),
    );
    // History: drop the per-user index plus every entry it referenced, and
    // un-list those entries from the global index.
    try {
      const userKey = `history:user:${u}`;
      const ids = (await redis.zRange(userKey, 0, -1)).map((e) => e.member);
      await Promise.all(
        ids.map((id) => redis.del(`history:entry:${id}`).catch(() => {})),
      );
      if (ids.length > 0)
        await redis.zRem(HISTORY_GLOBAL_KEY, ids).catch(() => {});
      await redis.del(userKey).catch(() => {});
    } catch {}
    // Leave the throwaway wiki page in a clearly-labelled idle state.
    try {
      await reddit.updateWikiPage({
        subredditName: subreddit,
        page: SELFTEST_WIKI_PAGE,
        content: `EchoWiki self-test scratch page: safe to ignore. Overwritten on each run.\n\nLast run: ${new Date().toISOString()}`,
        reason: "echowiki self-test teardown",
      });
    } catch {}
  }

  const failed = results.filter((r) => !r.passed).length;
  return {
    type: "dev-selftest",
    ranAt: Date.now(),
    passed: results.length - failed,
    failed,
    results,
  };
}

// Run the dev-only self-test suite. Gated twice: the running subreddit must be
// the configured dev subreddit, and the caller must be a moderator there.
router.post<Record<string, never>, DevSelfTestResponse | ErrorResponse>(
  "/api/dev/selftest",
  async (_req, res): Promise<void> => {
    try {
      if (context.subredditName !== DEV_SUBREDDIT) {
        res.status(403).json({
          status: "error",
          message:
            "Self-tests are only available on the development subreddit.",
        });
        return;
      }
      const username = await getCurrentUsername();
      if (!username) {
        res.status(401).json({ status: "error", message: "Not logged in" });
        return;
      }
      if (!(await checkIsMod(username))) {
        res.status(403).json({ status: "error", message: "Not authorized" });
        return;
      }
      res.json(await runDevSelfTests(username));
    } catch (error) {
      const message =
        error instanceof Error
          ? `Self-test run failed: ${error.message}`
          : "Unknown error";
      res.status(400).json({ status: "error", message });
    }
  },
);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.listen(port);
