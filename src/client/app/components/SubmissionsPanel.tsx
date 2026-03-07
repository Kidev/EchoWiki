import { useState, useEffect, useCallback } from "react";
import type {
  WikiSuggestion,
  WikiSuggestionActionRequest,
  WikiSuggestionRequest,
  WikiSuggestionResponse,
  WikiSuggestionsResponse,
  WikiSuggestionWithVoting,
  WikiResponse,
  ErrorResponse,
  WikiFontSize,
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
  onAccept: () => void;
  onDeny: () => void;
  onClose: () => void;
  isActing: boolean;
  actError: string | null;
}) {
  const pageLabel = suggestion.page.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const dateStr = new Date(suggestion.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-[var(--text)] truncate">
            Suggestion by <span className="text-[var(--accent)]">u/{suggestion.username}</span> on{" "}
            <span className="italic">{pageLabel}</span>
          </span>
          <span className="text-xs text-[var(--text-muted)] truncate">
            &ldquo;{suggestion.description}&rdquo; &middot; {dateStr}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {actError && <span className="text-xs text-red-500">{actError}</span>}
          <button
            onClick={onDeny}
            disabled={isActing}
            className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            Deny
          </button>
          <button
            onClick={onAccept}
            disabled={isActing}
            className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            {isActing ? "Applying…" : "Accept"}
          </button>
          <button
            onClick={onClose}
            disabled={isActing}
            className="text-xs px-2 py-1.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer disabled:opacity-50"
            title="Close"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

function SubmissionsPanel({
  subredditName,
  isMod,
  username,
  wikiFontSize,
}: {
  subredditName: string;
  isMod: boolean;
  username: string;
  wikiFontSize: WikiFontSize;
}) {
  const [suggestions, setSuggestions] = useState<WikiSuggestionWithVoting[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewSuggestion, setReviewSuggestion] = useState<WikiSuggestionWithVoting | null>(null);
  const [reviewCurrentContent, setReviewCurrentContent] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  const [editSuggestion, setEditSuggestion] = useState<WikiSuggestionWithVoting | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wiki/suggestions");
      if (res.ok) {
        const data: WikiSuggestionsResponse = await res.json();
        setSuggestions(data.suggestions);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const handleReview = useCallback(async (suggestion: WikiSuggestionWithVoting) => {
    setReviewSuggestion(suggestion);
    setActError(null);
    try {
      const res = await fetch(`/api/wiki?page=${encodeURIComponent(suggestion.page)}`);
      if (res.ok) {
        const data: WikiResponse = await res.json();
        setReviewCurrentContent(data.content);
      } else {
        setReviewCurrentContent(null);
      }
    } catch {
      setReviewCurrentContent(null);
    }
  }, []);

  const handleAccept = useCallback(async () => {
    if (!reviewSuggestion) return;
    setIsActing(true);
    setActError(null);
    try {
      const body: WikiSuggestionActionRequest = { username: reviewSuggestion.username };
      const res = await fetch("/api/wiki/suggestion/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as ErrorResponse;
        setActError(err.message ?? "Failed to accept");
        return;
      }
      setReviewSuggestion(null);
      setSuggestions((prev) => prev.filter((s) => s.username !== reviewSuggestion.username));
    } catch {
      setActError("Network error");
    } finally {
      setIsActing(false);
    }
  }, [reviewSuggestion]);

  const handleDeny = useCallback(async () => {
    if (!reviewSuggestion) return;
    setIsActing(true);
    setActError(null);
    try {
      const body: WikiSuggestionActionRequest = { username: reviewSuggestion.username };
      const res = await fetch("/api/wiki/suggestion/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as ErrorResponse;
        setActError(err.message ?? "Failed to deny");
        return;
      }
      setReviewSuggestion(null);
      setSuggestions((prev) => prev.filter((s) => s.username !== reviewSuggestion.username));
    } catch {
      setActError("Network error");
    } finally {
      setIsActing(false);
    }
  }, [reviewSuggestion]);

  const handleQuickDeny = useCallback(async (denyUsername: string) => {
    try {
      const body: WikiSuggestionActionRequest = { username: denyUsername };
      await fetch("/api/wiki/suggestion/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSuggestions((prev) => prev.filter((s) => s.username !== denyUsername));
    } catch {}
  }, []);

  const handleOpenEdit = useCallback((s: WikiSuggestionWithVoting) => {
    setEditSuggestion(s);
    setEditContent(s.content);
    setEditDescription(s.description);
    setEditError(null);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editSuggestion) return;
    if (!editDescription.trim()) {
      setEditError("Please provide a description.");
      return;
    }
    setIsSubmittingEdit(true);
    setEditError(null);
    try {
      const body: WikiSuggestionRequest = {
        page: editSuggestion.page,
        content: editContent,
        description: editDescription.trim(),
      };
      const res = await fetch("/api/wiki/suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as ErrorResponse;
        setEditError(err.message ?? "Failed to update suggestion.");
        return;
      }
      const data: WikiSuggestionResponse = await res.json();
      if (data.suggestion) {
        setSuggestions((prev) =>
          prev.map((s) =>
            s.username === editSuggestion.username
              ? { ...s, ...data.suggestion!, voteStatus: s.voteStatus }
              : s,
          ),
        );
      }
      setEditSuggestion(null);
      showToast("Suggestion updated!");
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setIsSubmittingEdit(false);
    }
  }, [editSuggestion, editContent, editDescription]);

  return (
    <>
      {editSuggestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            className="flex flex-col w-full max-w-2xl max-h-[90vh] rounded-xl shadow-2xl overflow-hidden"
            style={{ backgroundColor: "var(--bg)", border: "1px solid var(--thumb-bg)" }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: "var(--thumb-bg)" }}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-[var(--text)]">Edit suggestion</span>
                <span className="text-xs text-[var(--text-muted)] truncate">
                  {editSuggestion.page.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              </div>
              <button
                onClick={() => setEditSuggestion(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-3 px-4 py-3 overflow-auto flex-1">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">Description</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Describe your changes (min 10 characters)"
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
                  style={{ backgroundColor: "var(--control-bg)", color: "var(--control-text)" }}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-h-0">
                <label className="text-xs font-medium text-[var(--text-muted)]">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)] resize-none flex-1 font-mono min-h-60"
                  style={{ backgroundColor: "var(--control-bg)", color: "var(--control-text)" }}
                />
              </div>
              {editError && <p className="text-xs text-red-500">{editError}</p>}
            </div>
            <div
              className="flex items-center justify-end gap-2 px-4 py-3 border-t"
              style={{ borderColor: "var(--thumb-bg)" }}
            >
              <button
                onClick={() => setEditSuggestion(null)}
                disabled={isSubmittingEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleEditSave()}
                disabled={isSubmittingEdit}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50 transition-opacity"
              >
                {isSubmittingEdit ? "Saving…" : "Update suggestion"}
              </button>
            </div>
          </div>
        </div>
      )}
      {reviewSuggestion && (
        <SuggestionReviewModal
          suggestion={reviewSuggestion}
          currentContent={reviewCurrentContent}
          subredditName={subredditName}
          wikiFontSize={wikiFontSize}
          onAccept={() => void handleAccept()}
          onDeny={() => void handleDeny()}
          onClose={() => setReviewSuggestion(null)}
          isActing={isActing}
          actError={actError}
        />
      )}

      <div
        className="flex-1 overflow-auto px-4 py-4"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-[var(--text)]">
            Pending submissions{suggestions.length > 0 ? ` (${suggestions.length})` : ""}
          </span>
          <button
            onClick={() => void loadSuggestions()}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
            <div className="w-3.5 h-3.5 border border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-sm text-[var(--text-muted)]">No pending submissions.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-2xl">
            {suggestions.map((p) => {
              const pageLabel = p.page.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              const dateStr = new Date(p.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
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
                          navigateTo({ url: `https://www.reddit.com/u/${p.username}` })
                        }
                      >
                        u/{p.username}
                      </button>
                      <span className="text-xs text-[var(--text-muted)]">
                        &rarr; <em>{pageLabel}</em>
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">&middot; {dateStr}</span>
                      {p.voteStatus && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                          {p.voteStatus.acceptCount}✓ {p.voteStatus.rejectCount}✗ voting
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
                        onClick={() => handleOpenEdit(p)}
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
                          onClick={() => void handleQuickDeny(p.username)}
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
