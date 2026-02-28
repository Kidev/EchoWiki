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
  engine: EngineType;
  encryptionKey: string;
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
};

export type ConfigResponse = {
  type: "config";
  config: GameConfig;
};

export type ConfigUpdateRequest = {
  gameName?: string;
  engine?: EngineType;
  encryptionKey?: string;
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
  isMod: boolean;
  config: GameConfig;
  appearance: SubredditAppearance;
  collaborativeMode: boolean;
  canSuggest: boolean;
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
  isMod: boolean;
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
