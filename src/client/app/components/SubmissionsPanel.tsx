import { useState, useEffect, useCallback } from "react";
import type {
  WikiSuggestion,
  WikiSuggestionActionRequest,
  WikiSuggestionsResponse,
  WikiSuggestionWithVoting,
  WikiResponse,
  ErrorResponse,
  WikiFontSize,
  WikiContribHistoryResponse,
  WikiHistoryEntry,
  WikiHistoryEvent,
  WikiHistoryActionRequest,
  WikiHistoryActionResponse,
} from "../../../shared/types/api";
import { navigateTo, showToast } from "@devvit/web/client";
import { CompareView } from "./DiffView";

function SuggestionReviewModal({
  suggestion,
  currentContent,
  subredditName,
  wikiFontSize,
  onAccept,
  onDeny,
  onClose,
  isActing,
  actError,
}: {
  suggestion: WikiSuggestion;
  currentContent: string | null;
  subredditName: string;
  wikiFontSize: WikiFontSize;
  onAccept: (reason: string) => void;
  onDeny: (reason: string) => void;
  onClose: () => void;
  isActing: boolean;
  actError: string | null;
}) {
  const [reason, setReason] = useState("");
  const canDeny = reason.trim().length > 0;
  const pageLabel = suggestion.page
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const dateStr = new Date(suggestion.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
      <div className="flex flex-col gap-2 px-4 py-2 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-[var(--text)] truncate">
              Suggestion by{" "}
              <span className="text-[var(--accent)]">
                u/{suggestion.username}
              </span>{" "}
              on <span className="italic">{pageLabel}</span>
            </span>
            <span className="text-xs text-[var(--text-muted)] truncate">
              &ldquo;{suggestion.description}&rdquo; &middot; {dateStr}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {actError && (
              <span className="text-xs text-red-500">{actError}</span>
            )}
            <button
              onClick={() => onDeny(reason)}
              disabled={isActing || !canDeny}
              title={canDeny ? undefined : "A reason is required to deny"}
              className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Deny
            </button>
            <button
              onClick={() => onAccept(reason)}
              disabled={isActing}
              className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {isActing ? "Applying..." : "Accept"}
            </button>
            <button
              onClick={onClose}
              disabled={isActing}
              className="text-xs px-2 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer disabled:opacity-50"
              title="Close"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required to deny, optional to accept)..."
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
          style={{
            backgroundColor: "var(--control-bg)",
            color: "var(--control-text)",
          }}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        <CompareView
          original={currentContent ?? ""}
          proposed={suggestion.content}
          subredditName={subredditName}
          currentPage={suggestion.page}
          wikiFontSize={wikiFontSize}
          leftLabel="Current"
          rightLabel="Suggested"
        />
      </div>
    </div>
  );
}

function pageLabelOf(page: string): string {
  return page
    .replace(/_/g, " ")
    .replace(/\//g, " / ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function historyEventLine(e: WikiHistoryEvent): string {
  const label =
    e.state === "submitted"
      ? "Submitted"
      : e.state === "approved"
        ? "Approved"
        : e.state === "denied"
          ? "Denied"
          : e.state === "approved-postmortem"
            ? "Approved (post-mortem)"
            : e.state === "reverted"
              ? "Reverted"
              : "Vote restarted";
  const who = e.by
    ? `u/${e.by}`
    : e.viaVote
      ? "community vote"
      : e.state === "submitted"
        ? ""
        : "a moderator";
  const date = new Date(e.at).toLocaleString();
  return `${label}${who ? `. ${who}` : ""}. ${date}${e.note ? `. ${e.note}` : ""}`;
}

const STATUS_STYLE: Record<WikiHistoryEntry["status"], string> = {
  approved: "bg-green-50 text-green-700 border-green-200",
  denied: "bg-red-50 text-red-600 border-red-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

// Contributions > History: the audit trail. Mods see everything with full
// detail and revert/restart actions; users see only their own decided
// suggestions (moderator identities redacted server-side).
function ContribHistoryView() {
  const [entries, setEntries] = useState<WikiHistoryEntry[] | null>(null);
  const [isMod, setIsMod] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    action: WikiHistoryActionRequest["action"];
  } | null>(null);

  const load = useCallback(async () => {
    setEntries(null);
    try {
      const res = await fetch("/api/wiki/contrib-history");
      if (res.ok) {
        const data: WikiContribHistoryResponse = await res.json();
        setEntries(data.entries);
        setIsMod(data.isMod);
        setHasMore(data.hasMore);
      } else {
        setEntries([]);
      }
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (
      id: string,
      action: WikiHistoryActionRequest["action"],
      force?: boolean,
    ) => {
      setActingId(id);
      try {
        const body: WikiHistoryActionRequest = {
          id,
          action,
          ...(force ? { force: true } : {}),
        };
        const res = await fetch("/api/wiki/contrib-history/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json()) as ErrorResponse;
          showToast(err.message ?? "Action failed");
          return;
        }
        const data = (await res.json()) as WikiHistoryActionResponse;
        if (data.conflict && !force) {
          setConfirm({ id, action });
          return;
        }
        showToast(data.merged ? "Applied (auto-merged)" : "Done");
        setConfirm(null);
        await load();
      } catch {
        showToast("Network error");
      } finally {
        setActingId(null);
      }
    },
    [load],
  );

  return (
    <div className="flex flex-col gap-2 max-w-2xl">
      {entries === null ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
          <div className="w-3.5 h-3.5 border border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <span className="text-sm text-[var(--text-muted)]">
            {isMod
              ? "No decided contributions yet."
              : "None of your contributions have been decided yet."}
          </span>
        </div>
      ) : (
        <>
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-1.5 p-3 rounded-lg border border-gray-200"
              style={{ backgroundColor: "var(--control-bg)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      className="text-sm font-medium cursor-pointer hover:underline"
                      style={{ color: "var(--accent)" }}
                      onClick={() =>
                        navigateTo({
                          url: `https://www.reddit.com/u/${e.author}`,
                        })
                      }
                    >
                      u/{e.author}
                    </button>
                    <span className="text-xs text-[var(--text-muted)]">
                      &rarr; <em>{pageLabelOf(e.page)}</em>
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[e.status]}`}
                    >
                      {e.status}
                    </span>
                  </div>
                  {e.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">
                      {e.description}
                    </p>
                  )}
                </div>
                {isMod && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {e.status === "denied" && e.canRevert && (
                      <button
                        disabled={actingId === e.id}
                        onClick={() => void act(e.id, "approve-postmortem")}
                        className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
                      >
                        Approve
                      </button>
                    )}
                    {e.status === "approved" && e.canRevert && (
                      <button
                        disabled={actingId === e.id}
                        onClick={() => void act(e.id, "revert")}
                        className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                      >
                        Revert
                      </button>
                    )}
                    {e.canRestartVote && (
                      <button
                        disabled={actingId === e.id}
                        onClick={() => void act(e.id, "restart-vote")}
                        className="text-xs px-2 py-1 rounded border border-gray-300 text-[var(--text)] hover:bg-[var(--thumb-bg)] cursor-pointer disabled:opacity-50"
                      >
                        Restart vote
                      </button>
                    )}
                  </div>
                )}
              </div>
              <ul className="flex flex-col gap-0.5 border-t border-gray-100 pt-1.5">
                {e.events.map((ev, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-[var(--text-muted)] flex flex-col gap-0.5"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[var(--text-muted)] shrink-0" />
                      {historyEventLine(ev)}
                    </span>
                    {ev.reason && (
                      <span className="ml-2.5 pl-2 border-l-2 border-gray-200 italic text-[var(--text-muted)]">
                        &ldquo;{ev.reason}&rdquo;
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hasMore && (
            <p className="text-[11px] text-[var(--text-muted)] text-center py-1">
              Showing the 10 most recent.
            </p>
          )}
        </>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setConfirm(null)}
        >
          <div
            className="bg-[var(--bg)] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="font-semibold text-amber-600 mb-1">
              The page changed since
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              This page was edited after that decision. Applying will auto-merge
              the change and may leave Git-style conflict markers (
              <span className="font-mono text-xs">
                &lt;&lt;&lt;&lt;&lt;&lt;&lt;
              </span>
              ) you&apos;ll need to resolve by editing the page. Proceed?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => void act(confirm.id, confirm.action, true)}
                disabled={actingId === confirm.id}
                className="text-sm px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                Apply with merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubmissionsPanel({
  subredditName,
  isMod,
  username,
  wikiFontSize,
  onPendingCountChange,
  onEditSuggestion,
}: {
  subredditName: string;
  isMod: boolean;
  username: string;
  wikiFontSize: WikiFontSize;
  onPendingCountChange?: (count: number) => void;
  // Open one of the user's own contributions in the full split suggestion
  // editor (preview + source) on the Wiki tab, rather than a bare textarea.
  onEditSuggestion: (page: string, content: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<WikiSuggestionWithVoting[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [reviewSuggestion, setReviewSuggestion] =
    useState<WikiSuggestionWithVoting | null>(null);
  const [reviewCurrentContent, setReviewCurrentContent] = useState<
    string | null
  >(null);
  const [isActing, setIsActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  // Quick-deny prompt: deny straight from the list, but still collect the
  // mandatory reason via a compact dialog.
  const [denyPromptUser, setDenyPromptUser] = useState<string | null>(null);
  const [denyPromptReason, setDenyPromptReason] = useState("");
  const [denyPromptError, setDenyPromptError] = useState<string | null>(null);
  const [denyPromptBusy, setDenyPromptBusy] = useState(false);

  const [tab, setTab] = useState<"pending" | "history">("pending");

  // Every load reports the fresh count to the parent so the Contributions tab
  // badge always matches the Pending list. The badge is seeded from a snapshot
  // at app load; opening the panel (this mount load) reconciles it with the
  // current data without needing the Refresh button.
  const loadSuggestions = useCallback(
    async (report = true) => {
      setLoading(true);
      try {
        const res = await fetch("/api/wiki/suggestions");
        if (res.ok) {
          const data: WikiSuggestionsResponse = await res.json();
          setSuggestions(data.suggestions);
          if (report) onPendingCountChange?.(data.suggestions.length);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [onPendingCountChange],
  );

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const handleReview = useCallback(
    async (suggestion: WikiSuggestionWithVoting) => {
      setReviewSuggestion(suggestion);
      setActError(null);
      // Prefer the suggestion's authored baseline so the diff reflects the
      // proposed change even when it's already live on the page (e.g. a
      // restarted vote on a previously-applied contribution). Fall back to the
      // live page for legacy suggestions submitted before baseContent existed.
      if (suggestion.baseContent !== undefined) {
        setReviewCurrentContent(suggestion.baseContent);
        return;
      }
      try {
        const res = await fetch(
          `/api/wiki?page=${encodeURIComponent(suggestion.page)}`,
        );
        if (res.ok) {
          const data: WikiResponse = await res.json();
          setReviewCurrentContent(data.content);
        } else {
          setReviewCurrentContent(null);
        }
      } catch {
        setReviewCurrentContent(null);
      }
    },
    [],
  );

  // Shared decision call for both the review modal and the quick-deny prompt.
  // `reason` is mandatory for deny (enforced by the server) and optional for
  // accept. Returns the error message on failure, or null on success.
  const submitDecision = useCallback(
    async (
      decision: "accept" | "deny",
      decisionUsername: string,
      reason: string,
    ): Promise<string | null> => {
      try {
        const body: WikiSuggestionActionRequest = {
          username: decisionUsername,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        };
        const res = await fetch(`/api/wiki/suggestion/${decision}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json()) as ErrorResponse;
          return err.message ?? `Failed to ${decision}`;
        }
        setSuggestions((prev) => {
          const next = prev.filter((s) => s.username !== decisionUsername);
          onPendingCountChange?.(next.length);
          return next;
        });
        return null;
      } catch {
        return "Network error";
      }
    },
    [onPendingCountChange],
  );

  const handleAccept = useCallback(
    async (reason: string) => {
      if (!reviewSuggestion) return;
      setIsActing(true);
      setActError(null);
      const err = await submitDecision(
        "accept",
        reviewSuggestion.username,
        reason,
      );
      if (err) setActError(err);
      else setReviewSuggestion(null);
      setIsActing(false);
    },
    [reviewSuggestion, submitDecision],
  );

  const handleDeny = useCallback(
    async (reason: string) => {
      if (!reviewSuggestion) return;
      if (!reason.trim()) {
        setActError("A reason is required to deny.");
        return;
      }
      setIsActing(true);
      setActError(null);
      const err = await submitDecision(
        "deny",
        reviewSuggestion.username,
        reason,
      );
      if (err) setActError(err);
      else setReviewSuggestion(null);
      setIsActing(false);
    },
    [reviewSuggestion, submitDecision],
  );

  const confirmQuickDeny = useCallback(async () => {
    if (!denyPromptUser) return;
    if (!denyPromptReason.trim()) {
      setDenyPromptError("A reason is required to deny.");
      return;
    }
    setDenyPromptBusy(true);
    setDenyPromptError(null);
    const err = await submitDecision("deny", denyPromptUser, denyPromptReason);
    setDenyPromptBusy(false);
    if (err) {
      setDenyPromptError(err);
      return;
    }
    setDenyPromptUser(null);
    setDenyPromptReason("");
  }, [denyPromptUser, denyPromptReason, submitDecision]);

  return (
    <>
      {reviewSuggestion && (
        <SuggestionReviewModal
          suggestion={reviewSuggestion}
          currentContent={reviewCurrentContent}
          subredditName={subredditName}
          wikiFontSize={wikiFontSize}
          onAccept={(reason) => void handleAccept(reason)}
          onDeny={(reason) => void handleDeny(reason)}
          onClose={() => setReviewSuggestion(null)}
          isActing={isActing}
          actError={actError}
        />
      )}
      {denyPromptUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !denyPromptBusy && setDenyPromptUser(null)}
        >
          <div
            className="bg-[var(--bg)] rounded-lg shadow-2xl p-5 max-w-sm w-full mx-4"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="font-semibold text-[var(--text)] mb-1">
              Deny u/{denyPromptUser}&apos;s contribution
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              A reason is required. It&apos;s shown to the contributor and other
              moderators in the history.
            </p>
            <textarea
              value={denyPromptReason}
              onChange={(e) => setDenyPromptReason(e.target.value)}
              autoFocus
              rows={3}
              placeholder="Reason for denial..."
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] resize-none font-mono"
              style={{
                backgroundColor: "var(--control-bg)",
                color: "var(--control-text)",
              }}
            />
            {denyPromptError && (
              <p className="text-xs text-red-500 mt-1">{denyPromptError}</p>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setDenyPromptUser(null)}
                disabled={denyPromptBusy}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmQuickDeny()}
                disabled={denyPromptBusy || !denyPromptReason.trim()}
                className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {denyPromptBusy ? "Denying..." : "Deny"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2 border-b border-gray-100">
        <div className="flex flex-wrap gap-1 min-w-0">
          {(["pending", "history"] as const).map((t) => (
            <button
              key={t}
              className={`text-xs px-[10px] py-[4px] rounded-full transition-colors cursor-pointer ${
                tab === t
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)]"
              }`}
              style={tab !== t ? { backgroundColor: "transparent" } : undefined}
              onMouseEnter={(e) => {
                if (tab !== t)
                  e.currentTarget.style.backgroundColor = "var(--thumb-bg)";
              }}
              onMouseLeave={(e) => {
                if (tab !== t)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
              onClick={() => setTab(t)}
            >
              {t === "pending" ? "Pending" : "History"}
              {t === "pending" && suggestions.length > 0
                ? ` (${suggestions.length})`
                : ""}
            </button>
          ))}
        </div>
        {tab === "pending" && (
          <button
            onClick={() => void loadSuggestions(true)}
            disabled={loading}
            className="shrink-0 ml-auto text-xs px-[10px] py-[4px] rounded-full bg-[var(--accent)] text-white transition-colors cursor-pointer disabled:opacity-30"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </div>

      <div
        className="flex-1 overflow-auto px-4 py-4"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        {tab === "history" ? (
          <ContribHistoryView />
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
            <div className="w-3.5 h-3.5 border border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            Loading...
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-sm text-[var(--text-muted)]">
              No pending submissions.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-2xl">
            {suggestions.map((p) => {
              const pageLabel = p.page
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
              const dateStr = new Date(p.createdAt).toLocaleDateString(
                undefined,
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                },
              );
              return (
                <div
                  key={p.username}
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-200"
                  style={{ backgroundColor: "var(--control-bg)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        className="text-sm font-medium cursor-pointer hover:underline"
                        style={{ color: "var(--accent)" }}
                        onClick={() =>
                          navigateTo({
                            url: `https://www.reddit.com/u/${p.username}`,
                          })
                        }
                      >
                        u/{p.username}
                      </button>
                      <span className="text-xs text-[var(--text-muted)]">
                        &rarr; <em>{pageLabel}</em>
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        &middot; {dateStr}
                      </span>
                      {p.voteStatus && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                          {p.voteStatus.acceptCount}✓ {p.voteStatus.rejectCount}
                          ✗ voting
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">
                      {p.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.votingPostId && (
                      <button
                        onClick={() =>
                          navigateTo({
                            url: `https://www.reddit.com/comments/${p.votingPostId!.replace("t3_", "")}`,
                          })
                        }
                        className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 cursor-pointer"
                      >
                        Vote post ↗
                      </button>
                    )}
                    {p.username === username && (
                      <button
                        onClick={() => onEditSuggestion(p.page, p.content)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 text-[var(--text)] hover:bg-[var(--thumb-bg)] cursor-pointer"
                      >
                        Edit
                      </button>
                    )}
                    {isMod && (
                      <>
                        <button
                          onClick={() => void handleReview(p)}
                          className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer"
                        >
                          Review
                        </button>
                        <button
                          onClick={() => {
                            setDenyPromptUser(p.username);
                            setDenyPromptReason("");
                            setDenyPromptError(null);
                          }}
                          className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          Deny
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default SubmissionsPanel;
