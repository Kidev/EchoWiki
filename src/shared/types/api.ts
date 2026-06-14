import devvitConfig from "../../../devvit.json";

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
  | "unity"
  | "unreal"
  | "godot"
  | "generic"
  | "custom"
  | "auto";

export type GameConfig = {
  gameName: string;
  engine: EngineType;
  encryptionKey: string;
  customTransformCode: string | null;
  wikiTitle: string;
  wikiDescription: string;
  homeBackground: HomeBackground;
  homeLogo: HomeLogo;
  collaborativeMode: boolean;
  minKarma: number;
  minAccountAgeDays: number;
  votingEnabled: boolean;
  votingAcceptThreshold: number;
  votingRejectThreshold: number;
  votingPercentThreshold: number;
  votingDurationDays: number;
  votingAllowVoteChange: boolean;
  votingChangeCooldownMinutes: number;
  votingShowVoterNames: boolean;
  votingVoterMinKarma: number;
  votingVoterMinAccountAgeDays: number;
  votingPostTitle: string;
  votingFlairTemplateId: string | null;
  votingMinVotersForTiming: number;
  votingMaxSuggestionEdits: number;
  suggestionEditCooldownMinutes: number;
};

export type ConfigResponse = {
  type: "config";
  config: GameConfig;
};

export type ConfigUpdateRequest = {
  gameName?: string;
  engine?: EngineType;
  encryptionKey?: string;
  customTransformCode?: string | null | undefined;
  wikiTitle?: string;
  wikiDescription?: string;
  homeBackground?: HomeBackground;
  homeLogo?: HomeLogo;
  collaborativeMode?: boolean;
  minKarma?: number;
  minAccountAgeDays?: number;
  votingEnabled?: boolean;
  votingAcceptThreshold?: number;
  votingRejectThreshold?: number;
  votingPercentThreshold?: number;
  votingDurationDays?: number;
  votingAllowVoteChange?: boolean;
  votingChangeCooldownMinutes?: number;
  votingShowVoterNames?: boolean;
  votingVoterMinKarma?: number;
  votingVoterMinAccountAgeDays?: number;
  votingPostTitle?: string | undefined;
  votingFlairTemplateId?: string | null | undefined;
  votingMinVotersForTiming?: number | undefined;
  votingMaxSuggestionEdits?: number | undefined;
  suggestionEditCooldownMinutes?: number | undefined;
};

export type ConfigUpdateResponse = {
  type: "config-updated";
  config: GameConfig;
};

export type SubredditAppearance = {
  bannerUrl: string | null;
  iconUrl: string | null;
  keyColor: string | null;
  primaryColor: string | null;
  bgColor: string | null;
  highlightColor: string | null;
  font: string | null;
};

export type InitResponse = {
  type: "init";
  postId: string;
  subredditName: string;
  username: string;
  modLevel: "config" | "wiki" | null;
  config: GameConfig;
  appearance: SubredditAppearance;
  collaborativeMode: boolean;
  canSuggest: boolean;
};

export type WikiResponse = {
  type: "wiki";
  content: string | null;
};

export type VersionResponse = {
  type: "version";
  /** The version of the app currently running, from the Devvit context. */
  current: string;
  /**
   * The latest published version parsed from the app's developer-portal
   * versions page, or null when it could not be determined.
   */
  latest: string | null;
  /** True when {@link latest} is strictly newer than {@link current}. */
  updateAvailable: boolean;
};

export type WikiPagesResponse = {
  type: "wiki-pages";
  pages: string[];
};

/** Full wiki page list (including orphaned/unlisted pages); moderators only. */
export type WikiAllPagesResponse = {
  type: "wiki-all-pages";
  pages: string[];
};

export type WikiCreateRequest = {
  /** The page the new page is created as a child of. */
  parentPage: string;
  /** Human title; the slug is derived from it. */
  title: string;
};

export type WikiCreateResponse = {
  type: "wiki-created";
  /** Full path of the created page (e.g. "characters/alice"). */
  page: string;
  title: string;
};

export type WikiRevisionInfo = {
  id: string;
  author: string;
  /** Revision timestamp in epoch milliseconds. */
  timestamp: number;
  reason: string;
  hidden: boolean;
};

export type WikiHistoryResponse = {
  type: "wiki-history";
  page: string;
  revisions: WikiRevisionInfo[];
};

/** Page content at a specific revision (or null if it couldn't be read). */
export type WikiRevisionContentResponse = {
  type: "wiki-revision-content";
  content: string | null;
};

export type WikiDeleteRequest = {
  page: string;
};

export type WikiDeleteResponse = {
  type: "wiki-deleted";
  page: string;
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

export type FontFamily = "system" | "serif" | "mono" | "subreddit";

export type HomeBackground = "ripple" | "banner" | "both" | "none";

export type HomeLogo = "echowiki-animated" | "echowiki" | "subreddit";

export type ColorTheme = {
  accentColor: string;
  linkColor: string;
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
  linkColor?: string | undefined;
  bgColor?: string | undefined;
  textColor?: string | undefined;
  textMuted?: string | undefined;
  thumbBgColor?: string | undefined;
  controlBgColor?: string | undefined;
  controlTextColor?: string | undefined;
  cardSize?: CardSize | undefined;
  wikiFontSize?: WikiFontSize | undefined;
  fontFamily?: FontFamily | undefined;
  reset?: boolean | undefined;
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

export type WikiSuggestion = {
  username: string;
  page: string;
  content: string;
  description: string;
  createdAt: number;
  editCount?: number;
  lastEditAt?: number;
  previousDescriptions?: string[];
  // Page content this suggestion was authored against, captured at submit time
  // and preserved across vote restarts. Used as the diff baseline so the
  // proposed change is always shown relative to its original base: even when
  // the change is already live on the page (e.g. a restarted vote on a
  // previously-applied contribution), where diffing the live page would yield
  // an empty diff.
  baseContent?: string;
};

export type WikiSuggestionRequest = {
  page: string;
  content: string;
  description: string;
};

export type WikiSuggestionResponse = {
  type: "wiki-suggestion";
  suggestion: WikiSuggestion | null;
};

export type WikiDraftMode = "edit" | "suggest";

export type WikiDraft = {
  page: string;
  content: string;
  mode: WikiDraftMode;
  updatedAt: number;
};

export type WikiDraftRequest = {
  page: string;
  content: string;
  mode: WikiDraftMode;
};

export type WikiDraftResponse = {
  type: "wiki-draft";
  draft: WikiDraft | null;
};

export type WikiDraftActionResponse = {
  type: "wiki-draft-action";
};

export type VoteValue = "accept" | "reject";

export type VoteEntry = {
  username: string;
  vote: VoteValue;
  votedAt: number;
};

export type VoteStatusData = {
  status: "active" | "accepted" | "rejected" | "cancelled";
  decidedAt: number | null;
  // Epoch ms at which a time-based vote concludes, or null when the vote has no
  // duration (threshold-only). Set when the vote starts/restarts so the client
  // countdown and the server-side deadline fallback agree on a single instant.
  deadlineAt?: number | null;
  reason:
    | "threshold_accept"
    | "threshold_reject"
    | "percent_time"
    | "mod_override"
    | "cancelled"
    | null;
  // When a vote is concluded by a moderator override (accept/deny), the mod who
  // decided and their free-form justification. Surfaced on the voting post so
  // voters see why the moderator stepped in. Null/absent for automatic outcomes.
  decidedBy?: string | null;
  decisionNote?: string | null;
};

export type VoteStatus = VoteStatusData & {
  acceptCount: number;
  rejectCount: number;
  totalVoters: number;
  votes: VoteEntry[];
};

export type WikiSuggestionWithVoting = WikiSuggestion & {
  votingPostId: string | null;
  voteStatus: VoteStatus | null;
};

export type WikiSuggestionsResponse = {
  type: "wiki-suggestions";
  suggestions: WikiSuggestionWithVoting[];
};

export type SuggestionAuthorInfo = {
  karma: number;
  accountAgeDays: number;
  acceptedContributions: number;
};

export type VotingInitResponse = {
  type: "voting-init";
  postId: string;
  subredditName: string;
  username: string;
  modLevel: "config" | "wiki" | null;
  config: GameConfig;
  appearance: SubredditAppearance;
  suggestion: WikiSuggestion;
  currentContent: string;
  voteStatus: VoteStatus;
  canVote: boolean;
  myVote: VoteValue | null;
  voteIneligibleReason: string | null;
  suggestionAuthorInfo: SuggestionAuthorInfo | null;
};

export type CastVoteRequest = {
  vote: VoteValue;
};

export type CastVoteResponse = {
  type: "vote-cast";
  voteStatus: VoteStatus;
  myVote: VoteValue | null;
};

export type WikiSuggestionActionRequest = {
  username: string;
  /** Moderator's justification. Required when denying, optional when accepting. */
  reason?: string;
};

export type WikiHistoryState =
  | "submitted"
  | "approved"
  | "denied"
  | "approved-postmortem"
  | "reverted"
  | "vote-restarted";

export type WikiHistoryEvent = {
  state: WikiHistoryState;
  /** Moderator who performed it, or null for community-vote / redacted-for-user. */
  by: string | null;
  at: number;
  /** Decided by public vote (mod identity may legitimately be absent). */
  viaVote?: boolean;
  /**
   * A denial the author performed on their own contribution: a self-withdrawal
   * rather than a moderator decision. Survives `by` redaction so non-mod
   * viewers also see it as a withdrawal.
   */
  withdrawn?: boolean;
  /** Free-form note, e.g. "auto-merged" or "merge conflict". */
  note?: string;
  /**
   * Moderator's justification for an approve/deny decision. Mandatory for
   * denials, optional for approvals. Shown in the history to other mods and to
   * the contribution's author (never redacted, unlike `by`).
   */
  reason?: string;
};

export type WikiHistoryEntry = {
  id: string;
  author: string;
  page: string;
  description: string;
  status: "approved" | "denied" | "pending";
  events: WikiHistoryEvent[];
  updatedAt: number;
  /** Mod hint: a denied entry can be approved post-mortem / an approved one reverted. */
  canRevert: boolean;
  canRestartVote: boolean;
};

export type WikiContribHistoryResponse = {
  type: "wiki-contrib-history";
  entries: WikiHistoryEntry[];
  isMod: boolean;
  /** More entries exist beyond the returned (capped at 10) window. */
  hasMore: boolean;
};

export type WikiHistoryActionRequest = {
  id: string;
  action: "approve-postmortem" | "revert" | "restart-vote";
  /** Proceed despite a merge-conflict warning (applies the auto-merged content). */
  force?: boolean;
  /** Moderator's justification, recorded on the post-mortem approval event. */
  reason?: string;
};

export type WikiHistoryActionResponse = {
  type: "wiki-history-action";
  /** True when the page changed since and a clean auto-merge was applied. */
  merged?: boolean;
  /**
   * True when !force and the auto-merge hit a conflict: nothing was applied, the
   * client should warn and re-submit with force to apply the marked merge.
   */
  conflict?: boolean;
};

export type WikiSuggestionActionResponse = {
  type: "wiki-suggestion-action";
};

export type WikiBanRequest = {
  username: string;
};

export type WikiBanResponse = {
  type: "wiki-ban";
};

export type WikiBansResponse = {
  type: "wiki-bans";
  banned: string[];
};

export type FlairTemplateInfo = {
  id: string;
  text: string;
  textColor: string;
  backgroundColor: string;
};

export type CollabInfoResponse = {
  type: "collab-info";
  wikiEditMode: "disabled" | "modonly" | "anyone" | null;
  banned: string[];
  flairTemplateId: string | null;
  flairTemplates: FlairTemplateInfo[];
  linkFlairTemplates: FlairTemplateInfo[];
  advancedContributorCount: number;
  advancedContributorFlairTemplateId: string | null;
};

export type SuggestionFlairRequest = {
  flairTemplateId: string | null;
};

export type SuggestionFlairResponse = {
  type: "suggestion-flair";
  flairTemplateId: string | null;
};

export type AdvancedContributorRequest = {
  count: number;
  flairTemplateId: string | null;
};

export type AdvancedContributorResponse = {
  type: "advanced-contributor";
  count: number;
  flairTemplateId: string | null;
};

export type MyFlairsResponse = {
  type: "my-flairs";
  earned: FlairTemplateInfo[];
  equipped: string | null;
};

export type EquipFlairRequest = {
  flairTemplateId: string | null;
};

export type EquipFlairResponse = {
  type: "equip-flair";
  flairTemplateId: string | null;
};

export type ErrorResponse = {
  status: "error";
  message: string;
};

/**
 * The development subreddit, sourced directly from `dev.subreddit` in
 * devvit.json so the two never drift. Dev-only affordances (e.g. the in-app
 * self-test harness, the TCOAAL model importer) are gated on the running
 * subreddit matching this value, on both the client (to decide whether to
 * surface the UI) and the server (to authorize the endpoint).
 */
export const DEV_SUBREDDIT = devvitConfig.dev.subreddit;

/** Outcome of a single self-test assertion in the dev-only test harness. */
export type DevTestResult = {
  /** Logical grouping shown as a section header (e.g. "Voting", "Permissions"). */
  group: string;
  /** Human-readable description of what the test verifies. */
  name: string;
  passed: boolean;
  /** "ok" on success, or the failure message / thrown error on failure. */
  detail: string;
  durationMs: number;
  /**
   * Ordered, real runtime trace of the test: the actual actions performed and
   * the actual values observed (Redis reads/writes, wiki page contents, API
   * returns, and each PASS/FAIL assertion with its expected-vs-got values).
   * Captured live during execution: never canned text.
   */
  log: string[];
};

export type DevSelfTestResponse = {
  type: "dev-selftest";
  ranAt: number;
  passed: number;
  failed: number;
  results: DevTestResult[];
};
