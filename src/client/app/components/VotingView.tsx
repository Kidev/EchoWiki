import { useState, useEffect, useCallback } from "react";
import type {
  VotingInitResponse,
  CastVoteRequest,
  CastVoteResponse,
  VoteStatus,
  VoteValue,
  ErrorResponse,
  WikiFontSize,
} from "../../../shared/types/api";
import { requestExpandedMode, navigateTo } from "@devvit/web/client";
import { CompareView } from "./DiffView";

export function formatAuthorKarma(karma: number): string {
  if (karma >= 1_000_000) return `${(karma / 1_000_000).toFixed(1)}M`;
  if (karma >= 1_000) return `${(karma / 1_000).toFixed(1)}k`;
  return String(karma);
}

export function formatAuthorAge(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) {
    const mo = Math.floor(days / 30);
    return `${mo}mo`;
  }
  const yr = Math.floor(days / 365);
  const mo = Math.floor((days % 365) / 30);
  return mo > 0 ? `${yr}y ${mo}mo` : `${yr}y`;
}

export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "deadline passed";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m left`;
  return "< 1m left";
}

export function voteReasonLabel(reason: VoteStatus["reason"]): string {
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

function VotingView({
  data,
  wikiFontSize,
  isInline,
  onVoteCast,
}: {
  data: VotingInitResponse;
  wikiFontSize: WikiFontSize;
  isInline: boolean;
  onVoteCast: (updated: VoteStatus, myVote: VoteValue | null) => void;
}) {
  const { suggestion, currentContent, canVote, config } = data;
  const [voteStatus, setVoteStatus] = useState<VoteStatus>(data.voteStatus);
  const [myVote, setMyVote] = useState<VoteValue | null>(data.myVote);
  const [isCasting, setIsCasting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [mode, setMode] = useState<"normal" | "source" | "diff">("normal");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (voteStatus.status !== "active" || config.votingDurationDays <= 0) return;
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [voteStatus.status, config.votingDurationDays]);

  const pageLabel = suggestion.page
    ? suggestion.page.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
  const decidedDateStr = voteStatus.decidedAt
    ? new Date(voteStatus.decidedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";

  const isActive = voteStatus.status === "active";

  const handleVote = useCallback(
    async (vote: VoteValue) => {
      if (isCasting) return;
      setIsCasting(true);
      setVoteError(null);
      try {
        const body: CastVoteRequest = { vote };
        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json()) as ErrorResponse;
          setVoteError(err.message ?? "Failed to cast vote");
          return;
        }
        const responseData = (await res.json()) as CastVoteResponse;
        setVoteStatus(responseData.voteStatus);
        setMyVote(responseData.myVote);
        onVoteCast(responseData.voteStatus, responseData.myVote);
      } catch {
        setVoteError("Network error");
      } finally {
        setIsCasting(false);
      }
    },
    [isCasting, onVoteCast],
  );

  const handleRetract = useCallback(async () => {
    if (isCasting) return;
    setIsCasting(true);
    setVoteError(null);
    try {
      const res = await fetch("/api/vote", { method: "DELETE" });
      if (!res.ok) {
        const err = (await res.json()) as ErrorResponse;
        setVoteError(err.message ?? "Failed to retract vote");
        return;
      }
      const responseData = (await res.json()) as CastVoteResponse;
      setVoteStatus(responseData.voteStatus);
      setMyVote(responseData.myVote);
      onVoteCast(responseData.voteStatus, responseData.myVote);
    } catch {
      setVoteError("Network error");
    } finally {
      setIsCasting(false);
    }
  }, [isCasting, onVoteCast]);

  const resultBannerBg =
    voteStatus.status === "accepted"
      ? "bg-green-50 border-green-200 text-green-800"
      : voteStatus.status === "rejected"
        ? "bg-red-50 border-red-200 text-red-700"
        : voteStatus.status === "cancelled"
          ? "bg-amber-50 border-amber-200 text-amber-700"
          : "";

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ color: "var(--text)" }}>
      {}
      {!isActive && (
        <div className={`px-4 py-2 border-b shrink-0 text-sm ${resultBannerBg}`}>
          <span className="font-bold">
            {voteStatus.status === "accepted"
              ? "✓ ACCEPTED"
              : voteStatus.status === "rejected"
                ? "✗ REJECTED"
                : "⊘ WITHDRAWN"}
          </span>
          {decidedDateStr && (
            <span className="text-xs ml-2">
              on {decidedDateStr}
              {voteStatus.reason ? `: ${voteReasonLabel(voteStatus.reason)}` : ""}
            </span>
          )}
        </div>
      )}

      {}
      <div
        className="flex items-center justify-between gap-3 px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: "var(--thumb-bg)", backgroundColor: "var(--thumb-bg)" }}
      >
        {}
        <div className="flex items-center gap-1">
          {(["normal", "source", "diff"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-[10px] px-2.5 py-1 rounded transition-colors cursor-pointer ${
                mode === m
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--control-bg)]"
              }`}
            >
              {m === "normal" ? "Normal" : m === "source" ? "Source" : "Diff"}
            </button>
          ))}
        </div>
        {}
        <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
          {}
          <div className="relative group cursor-default select-none">
            <span className="text-xs text-green-600 font-medium">
              {config.votingAcceptThreshold > 0
                ? `${voteStatus.acceptCount}/${config.votingAcceptThreshold} ✓`
                : `${voteStatus.acceptCount} ✓`}
            </span>
            {config.votingShowVoterNames && voteStatus.acceptCount > 0 && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 hidden group-hover:block rounded-md shadow-lg p-2 text-[10px] whitespace-nowrap"
                style={{
                  backgroundColor: "var(--control-bg)",
                  border: "1px solid var(--thumb-bg)",
                  color: "var(--text-muted)",
                }}
              >
                {voteStatus.votes
                  .filter((v) => v.vote === "accept" && v.username)
                  .map((v, i) => (
                    <div key={i}>u/{v.username}</div>
                  ))}
              </div>
            )}
          </div>
          {}
          <div className="relative group cursor-default select-none">
            <span className="text-xs text-red-500 font-medium">
              {config.votingRejectThreshold > 0
                ? `${voteStatus.rejectCount}/${config.votingRejectThreshold} ✗`
                : `${voteStatus.rejectCount} ✗`}
            </span>
            {config.votingShowVoterNames && voteStatus.rejectCount > 0 && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 hidden group-hover:block rounded-md shadow-lg p-2 text-[10px] whitespace-nowrap"
                style={{
                  backgroundColor: "var(--control-bg)",
                  border: "1px solid var(--thumb-bg)",
                  color: "var(--text-muted)",
                }}
              >
                {voteStatus.votes
                  .filter((v) => v.vote === "reject" && v.username)
                  .map((v, i) => (
                    <div key={i}>u/{v.username}</div>
                  ))}
              </div>
            )}
          </div>
          {}
          <div className="relative group cursor-default select-none">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {voteStatus.totalVoters} voter{voteStatus.totalVoters !== 1 ? "s" : ""}
            </span>
            {config.votingShowVoterNames && voteStatus.totalVoters > 0 && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 hidden group-hover:block rounded-md shadow-lg p-2 text-[10px] whitespace-nowrap"
                style={{
                  backgroundColor: "var(--control-bg)",
                  border: "1px solid var(--thumb-bg)",
                  color: "var(--text-muted)",
                }}
              >
                {voteStatus.votes
                  .filter((v) => v.username)
                  .map((v, i) => (
                    <div key={i}>
                      <span className={v.vote === "accept" ? "text-green-600" : "text-red-500"}>
                        {v.vote === "accept" ? "✓" : "✗"}
                      </span>{" "}
                      u/{v.username}
                    </div>
                  ))}
              </div>
            )}
          </div>
          {}
          {isActive && config.votingDurationDays > 0 && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {formatTimeRemaining(
                suggestion.createdAt + config.votingDurationDays * 86400000 - now,
              )}
            </span>
          )}
          {isInline && (
            <button
              title="Pop out"
              onClick={(e) => {
                void requestExpandedMode(e.nativeEvent, "app");
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {}
      <div className="flex-1 overflow-hidden min-h-0 relative">
        <CompareView
          original={currentContent}
          proposed={suggestion.content}
          subredditName={data.subredditName}
          currentPage={suggestion.page}
          wikiFontSize={wikiFontSize}
          leftLabel="Current"
          rightLabel="Suggested"
          mode={mode}
        />
        {isCasting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 z-10">
            <div className="w-10 h-10 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {}
      <div
        className="px-4 py-2.5 border-t shrink-0 flex items-center justify-between gap-4"
        style={{ borderColor: "var(--thumb-bg)", backgroundColor: "var(--control-bg)" }}
      >
        {}
        <div className="flex flex-col gap-0.5 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            <button
              className="font-medium cursor-pointer hover:underline"
              style={{ color: "var(--accent)" }}
              onClick={() => navigateTo({ url: `https://www.reddit.com/u/${suggestion.username}` })}
            >
              u/{suggestion.username}
            </button>
            {pageLabel && (
              <>
                <span style={{ color: "var(--text-muted)" }}>→</span>
                <span className="font-medium italic" style={{ color: "var(--text)" }}>
                  {pageLabel}
                </span>
              </>
            )}
          </div>
          {data.suggestionAuthorInfo && (
            <div
              className="flex items-center gap-2 text-[10px] flex-wrap"
              style={{ color: "var(--text-muted)" }}
            >
              <span>{formatAuthorKarma(data.suggestionAuthorInfo.karma)} karma</span>
              <span>·</span>
              <span>{formatAuthorAge(data.suggestionAuthorInfo.accountAgeDays)} old</span>
              <span>·</span>
              {data.suggestionAuthorInfo.acceptedContributions > 0 ? (
                <span>
                  {data.suggestionAuthorInfo.acceptedContributions} accepted contribution
                  {data.suggestionAuthorInfo.acceptedContributions !== 1 ? "s" : ""}
                </span>
              ) : (
                <span>no previous contributions</span>
              )}
            </div>
          )}
          {suggestion.description && (
            <div className="relative group">
              <p className="text-[10px] truncate font-bold" style={{ color: "var(--text)" }}>
                {suggestion.description}
              </p>
              {suggestion.previousDescriptions && suggestion.previousDescriptions.length > 0 && (
                <div
                  className="absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover:block rounded-md shadow-lg p-2 text-[10px] max-w-64"
                  style={{
                    backgroundColor: "var(--control-bg)",
                    border: "1px solid var(--thumb-bg)",
                    color: "var(--text-muted)",
                  }}
                >
                  <div className="font-medium mb-1" style={{ color: "var(--text)" }}>
                    Previous reasons:
                  </div>
                  {suggestion.previousDescriptions.map((d, i) => (
                    <div key={i} className="truncate">
                      · {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {}
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {canVote && isActive ? (
            <>
              {}
              <div
                style={{
                  maxWidth: myVote === "reject" ? "0px" : "180px",
                  opacity: myVote === "reject" ? 0 : 1,
                  overflow: "hidden",
                  flexShrink: 0,
                  transition: "max-width 0.3s ease, opacity 0.25s ease",
                }}
              >
                <button
                  onClick={() =>
                    void (myVote === "accept" ? handleRetract() : handleVote("accept"))
                  }
                  disabled={isCasting}
                  className="whitespace-nowrap text-sm px-5 py-2 rounded-lg font-bold cursor-pointer disabled:opacity-50 bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  {isCasting && myVote !== "reject" ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block align-middle" />
                  ) : (
                    "✓ FOR"
                  )}
                </button>
              </div>
              {}
              <div
                style={{
                  maxWidth: myVote === "accept" ? "0px" : "180px",
                  opacity: myVote === "accept" ? 0 : 1,
                  overflow: "hidden",
                  flexShrink: 0,
                  transition: "max-width 0.3s ease, opacity 0.25s ease",
                }}
              >
                <button
                  onClick={() =>
                    void (myVote === "reject" ? handleRetract() : handleVote("reject"))
                  }
                  disabled={isCasting}
                  className="whitespace-nowrap text-sm px-5 py-2 rounded-lg font-bold cursor-pointer disabled:opacity-50 bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  {isCasting && myVote !== "accept" ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block align-middle" />
                  ) : (
                    "✗ AGAINST"
                  )}
                </button>
              </div>
              {voteError && <span className="text-xs text-red-500">{voteError}</span>}
            </>
          ) : !canVote && isActive ? (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {data.voteIneligibleReason ??
                (data.username === suggestion.username
                  ? "You cannot vote on your own suggestion."
                  : "You are not eligible to vote.")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default VotingView;
