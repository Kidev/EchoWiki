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

export type HomeLogo = "echowiki" | "subreddit";

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
  reason:
    | "threshold_accept"
    | "threshold_reject"
    | "percent_time"
    | "mod_override"
    | "cancelled"
    | null;
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
  /** Free-form note, e.g. "auto-merged" or "merge conflict". */
  note?: string;
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
