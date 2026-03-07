import {
  memo,
  lazy,
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  type MutableRefObject,
  type ChangeEvent,
} from "react";
import { showToast } from "@devvit/web/client";
import type {
  WikiFontSize,
  WikiResponse,
  WikiSuggestion,
  WikiSuggestionRequest,
  WikiSuggestionResponse,
  WikiUpdateRequest,
  ErrorResponse,
} from "../../../shared/types/api";
import { preloadPaths } from "../../lib/echo";
import { extractEchoPathsFromMarkdown } from "../echoRender";
import { WikiMarkdownContent } from "./WikiMarkdownContent";
import { SideBySideDiffView } from "./DiffView";
import {
  ConfirmDialog,
  WikiSaveDialog,
  WikiSuggestDialog,
  WikiExistingSuggestionDialog,
} from "./dialogs";

const WikiToolbar = lazy(() => import("./WikiEditorToolbar"));

export const WikiView = memo(function WikiView({
  subredditName,
  wikiFontSize,
  currentPage,
  onPageChange,
  isMod,
  isExpanded,
  username,
  onCopyEchoLink,
  targetAnchor,
  onAnchorConsumed,
  canSuggest,
  voteOnSaveAvailable,
  suggestionToLoad,
  onSuggestionLoaded,
  onNavigateToSuggestion,
  onInlineEditRequest,
  startInEditMode,
  onStartInEditModeConsumed,
}: {
  subredditName: string;
  wikiFontSize: WikiFontSize;
  currentPage: string;
  onPageChange: (page: string) => void;
  isMod: boolean;
  isExpanded: boolean;
  username: string;
  onCopyEchoLink: (link: string) => void;
  targetAnchor?: string | null | undefined;
  onAnchorConsumed?: (() => void) | undefined;
  canSuggest: boolean;
  voteOnSaveAvailable?: boolean | undefined;
  suggestionToLoad?: string | null | undefined;
  onSuggestionLoaded?: (() => void) | undefined;
  onNavigateToSuggestion?: ((page: string, content: string) => void) | undefined;
  onInlineEditRequest?: ((e: MouseEvent) => void) | undefined;
  startInEditMode?: string | null | undefined;
  onStartInEditModeConsumed?: (() => void) | undefined;
}) {
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const readScrollRef = useRef<HTMLDivElement>(null);
  const lastPageRef = useRef(currentPage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [isProposeMode, setIsProposeMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [suggestDescription, setSuggestDescription] = useState("");
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [showSuggestDialog, setShowSuggestDialog] = useState(false);
  const [existingSuggestion, setExistingSuggestion] = useState<WikiSuggestion | null>(null);
  const [isDeletingSuggestion, setIsDeletingSuggestion] = useState(false);
  const [proposeViewMode, setProposeViewMode] = useState<"normal" | "source" | "diff">("normal");
  const [proposeHiddenPane, setProposeHiddenPane] = useState<null | "left" | "right">(null);
  const [createVotePost, setCreateVotePost] = useState(true);

  useEffect(() => {
    if (proposeViewMode === "diff") setProposeHiddenPane(null);
  }, [proposeViewMode]);

  useEffect(() => {
    if (
      !startInEditMode ||
      startInEditMode !== currentPage ||
      loading ||
      content === undefined ||
      !isMod ||
      !isExpanded
    )
      return;
    setEditContent(content ?? "");
    setIsEditing(true);
    setIsProposeMode(false);
    onStartInEditModeConsumed?.();
  }, [
    startInEditMode,
    currentPage,
    loading,
    content,
    isMod,
    isExpanded,
    onStartInEditModeConsumed,
  ]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/wiki?page=${encodeURIComponent(currentPage)}`);
        if (res.ok) {
          const data: WikiResponse = await res.json();

          const echoPaths = data.content ? extractEchoPathsFromMarkdown(data.content) : [];
          if (echoPaths.length > 0) await preloadPaths(echoPaths);
          setContent(data.content);
        } else {
          setContent(null);
        }
      } catch {
        setContent(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [currentPage]);

  useLayoutEffect(() => {
    if (currentPage !== lastPageRef.current) {
      lastPageRef.current = currentPage;
      readScrollRef.current?.scrollTo(0, 0);
    }
  }, [currentPage]);

  useEffect(() => {
    setIsEditing(false);
    setIsProposeMode(false);
    setEditContent("");
    setSaveReason("");
    setSaveError(null);
    setShowSaveDialog(false);
    setShowCancelDialog(false);
    setSuggestDescription("");
    setSuggestError(null);
    setShowSuggestDialog(false);
    setExistingSuggestion(null);
    setProposeViewMode("normal");
  }, [currentPage]);

  useEffect(() => {
    if (suggestionToLoad != null) {
      setEditContent(suggestionToLoad);
      setIsEditing(true);
      setIsProposeMode(true);
      onSuggestionLoaded?.();
    }
  }, [suggestionToLoad, onSuggestionLoaded]);

  const handlePageChange = useCallback(
    (page: string) => {
      onPageChange(page);
    },
    [onPageChange],
  );

  const handleToolbarInsert = useCallback((newValue: string) => {
    setEditContent(newValue);
  }, []);

  const handleEditClick = useCallback(() => {
    setEditContent(content ?? "");
    setIsEditing(true);
    setIsProposeMode(false);
  }, [content]);

  const handleSuggestClick = useCallback(async () => {
    try {
      const res = await fetch("/api/wiki/suggestion");
      if (res.ok) {
        const data: WikiSuggestionResponse = await res.json();
        if (data.suggestion) {
          if (data.suggestion.page === currentPage) {
            setEditContent(data.suggestion.content);
            setIsEditing(true);
            setIsProposeMode(true);
          } else {
            setExistingSuggestion(data.suggestion);
          }
          return;
        }
      }
    } catch {}

    setEditContent(content ?? "");
    setIsEditing(true);
    setIsProposeMode(true);
  }, [currentPage, content]);

  const handleCancelConfirm = useCallback(() => {
    setIsEditing(false);
    setIsProposeMode(false);
    setEditContent("");
    setShowCancelDialog(false);
    setSaveError(null);
    setSuggestDescription("");
    setSuggestError(null);
    setShowSuggestDialog(false);
  }, []);

  const handleSaveConfirm = useCallback(async () => {
    if (saveReason.trim().length < 10) {
      setSaveError("Description must be at least 10 characters.");
      return;
    }
    const isVoteMode = (voteOnSaveAvailable ?? false) && createVotePost;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (isVoteMode) {
        const body: WikiSuggestionRequest = {
          page: currentPage,
          content: editContent,
          description: saveReason.trim(),
        };
        const res = await fetch("/api/wiki/suggestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json()) as ErrorResponse;
          setSaveError(err.message ?? "Failed to submit vote suggestion.");
          return;
        }
        setIsEditing(false);
        setShowSaveDialog(false);
        setSaveReason("");
        showToast("Vote suggestion submitted!");
      } else {
        const body: WikiUpdateRequest = {
          page: currentPage,
          content: editContent,
          reason: username ? `${username}: ${saveReason.trim()}` : saveReason.trim(),
        };
        const res = await fetch("/api/wiki/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json()) as ErrorResponse;
          setSaveError(err.message ?? "Failed to save changes.");
          return;
        }
        setContent(editContent);
        setIsEditing(false);
        setShowSaveDialog(false);
        setSaveReason("");
      }
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [createVotePost, currentPage, editContent, saveReason, username, voteOnSaveAvailable]);

  const handleSuggestConfirm = useCallback(async () => {
    if (!suggestDescription.trim()) {
      setSuggestError("Please describe your changes.");
      return;
    }
    setIsSaving(true);
    setSuggestError(null);
    try {
      const body: WikiSuggestionRequest = {
        page: currentPage,
        content: editContent,
        description: suggestDescription.trim(),
      };
      const res = await fetch("/api/wiki/suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as ErrorResponse;
        setSuggestError(err.message ?? "Failed to submit suggestion.");
        return;
      }
      setIsEditing(false);
      setIsProposeMode(false);
      setShowSuggestDialog(false);
      setSuggestDescription("");
      showToast("Suggestion submitted!");
    } catch {
      setSuggestError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [currentPage, editContent, suggestDescription]);

  const handleExistingSuggestionSee = useCallback(() => {
    if (!existingSuggestion) return;
    setExistingSuggestion(null);
    onNavigateToSuggestion?.(existingSuggestion.page, existingSuggestion.content);
  }, [existingSuggestion, onNavigateToSuggestion]);

  const handleExistingSuggestionDelete = useCallback(async () => {
    setIsDeletingSuggestion(true);
    try {
      await fetch("/api/wiki/suggestion", { method: "DELETE" });
      setExistingSuggestion(null);

      setEditContent(content ?? "");
      setIsEditing(true);
      setIsProposeMode(true);
    } catch {
    } finally {
      setIsDeletingSuggestion(false);
    }
  }, [content]);

  const canEdit = isMod && isExpanded && !loading;
  const canSuggestHere = canSuggest && isExpanded && !loading;
  const canInlineEdit = isMod && !isExpanded && !loading && content !== undefined;

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {canInlineEdit && (
        <button
          onClick={(e) => onInlineEditRequest?.(e.nativeEvent)}
          title="Edit page (opens expanded)"
          className="absolute top-2 right-2 z-10 p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--thumb-bg)] transition-colors cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
          </svg>
        </button>
      )}
      {canEdit && !isEditing && (
        <button
          onClick={handleEditClick}
          title="Edit page"
          className="absolute top-2 right-6 z-10 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--accent)] text-white hover:opacity-90 shadow-sm transition-opacity cursor-pointer"
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
          </svg>
          Edit page
        </button>
      )}

      {canSuggestHere && !isEditing && (
        <button
          onClick={() => void handleSuggestClick()}
          title="Suggest change"
          className="absolute top-2 right-6 z-10 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--thumb-bg)] text-[var(--text)] hover:opacity-80 shadow-sm transition-opacity cursor-pointer border border-gray-200"
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
          </svg>
          Suggest change
        </button>
      )}

      {loading ? (
        <div className="flex justify-center items-center min-h-64">
          <div className="w-10 h-10 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isEditing ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div
              style={{
                flexGrow: proposeHiddenPane === "left" ? 0 : 1,
                flexShrink: 1,
                flexBasis: "0%",
                minWidth: 0,
                overflow: "hidden",
                transition: "flex-grow 0.35s ease",
                borderRight: "1px solid var(--thumb-bg)",
              }}
              className="flex flex-col"
            >
              {isProposeMode && (
                <div className="px-3 py-1 bg-[var(--thumb-bg)] border-b border-gray-100 shrink-0 flex items-center gap-1">
                  {(["normal", "source", "diff"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setProposeViewMode(m)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer ${
                        proposeViewMode === m
                          ? m === "diff"
                            ? "bg-amber-500 text-white"
                            : "bg-[var(--accent)] text-white"
                          : "text-[var(--text-muted)] hover:bg-[var(--control-bg)]"
                      }`}
                    >
                      {m === "normal" ? "Normal" : m === "source" ? "Source" : "Diff"}
                    </button>
                  ))}
                </div>
              )}
              <div
                className="flex-1 overflow-hidden"
                style={{
                  zoom:
                    isProposeMode && proposeHiddenPane === null && proposeViewMode !== "diff"
                      ? 0.5
                      : 1,
                }}
              >
                {isProposeMode && proposeViewMode === "diff" ? (
                  <SideBySideDiffView original={content ?? ""} proposed={editContent} />
                ) : isProposeMode && proposeViewMode === "source" ? (
                  <div
                    className="h-full overflow-auto"
                    style={{ scrollbarGutter: "stable both-edges" }}
                  >
                    <pre
                      className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed"
                      style={{ color: "var(--text)" }}
                    >
                      {editContent || "(empty)"}
                    </pre>
                  </div>
                ) : (
                  <div
                    className="h-full overflow-auto"
                    style={{ scrollbarGutter: "stable both-edges" }}
                  >
                    <WikiMarkdownContent
                      content={editContent}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      wikiFontSize={wikiFontSize}
                      onPageChange={handlePageChange}
                      onCopyEchoLink={onCopyEchoLink}
                    />
                  </div>
                )}
              </div>
            </div>
            {}
            <div
              style={{
                flexGrow: proposeHiddenPane === "right" ? 0 : 1,
                flexShrink: 1,
                flexBasis: "0%",
                minWidth: 0,
                overflow: "hidden",
                transition: "flex-grow 0.35s ease",
              }}
              className="flex flex-col"
            >
              <div className="px-3 py-1.5 text-xs bg-[var(--thumb-bg)] border-b border-gray-100 shrink-0 select-none flex items-center justify-between sticky top-0 z-10">
                <span className="font-mono text-[var(--text-muted)]">
                  {isProposeMode ? "Suggesting changes" : "Source"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowCancelDialog(true)}
                    className="px-2 py-0.5 rounded border border-gray-300 text-[var(--text-muted)] hover:bg-[var(--control-bg)] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  {isProposeMode ? (
                    <button
                      onClick={() => {
                        setSuggestError(null);
                        setShowSuggestDialog(true);
                      }}
                      className="px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Submit
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setSaveError(null);
                        setCreateVotePost(true);
                        setShowSaveDialog(true);
                      }}
                      className="px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
              <Suspense fallback={null}>
                <WikiToolbar
                  onInsert={handleToolbarInsert}
                  textareaRef={textareaRef as MutableRefObject<HTMLTextAreaElement | null>}
                />
              </Suspense>
              <textarea
                ref={textareaRef}
                className="flex-1 resize-none p-4 font-mono text-sm bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                value={editContent}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditContent(e.target.value)}
                spellCheck={false}
                placeholder="Write wiki markdown here…"
              />
            </div>
          </div>
          {}
          {isProposeMode && (
            <div
              className="flex items-center shrink-0 border-t text-[10px]"
              style={{
                borderColor: "var(--thumb-bg)",
                backgroundColor: "var(--thumb-bg)",
                cursor: proposeHiddenPane !== null ? "pointer" : "default",
              }}
              onClick={proposeHiddenPane !== null ? () => setProposeHiddenPane(null) : undefined}
            >
              <div
                style={{
                  flexGrow: proposeHiddenPane === "left" ? 0 : 1,
                  flexShrink: 1,
                  flexBasis: "0%",
                  overflow: "hidden",
                  transition: "flex-grow 0.35s ease",
                }}
                className={`flex items-center justify-center px-3 py-0.5 select-none ${proposeHiddenPane === null && proposeViewMode !== "diff" ? "cursor-pointer" : ""}`}
                onClick={
                  proposeHiddenPane === null && proposeViewMode !== "diff"
                    ? (e) => {
                        e.stopPropagation();
                        setProposeHiddenPane("right");
                      }
                    : undefined
                }
              >
                <span
                  className="font-bold whitespace-nowrap"
                  style={{
                    color: "var(--text)",
                    opacity: proposeHiddenPane === "left" ? 0 : 1,
                    transition: "opacity 0.35s ease",
                  }}
                >
                  PROPOSED
                </span>
              </div>
              {proposeHiddenPane === null && (
                <div
                  className="shrink-0 px-2 flex items-center"
                  style={{ color: "var(--text-muted)" }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 8l4 4m0 0l-4 4m4-4H3"
                    />
                  </svg>
                </div>
              )}
              <div
                style={{
                  flexGrow: proposeHiddenPane === "right" ? 0 : 1,
                  flexShrink: 1,
                  flexBasis: "0%",
                  overflow: "hidden",
                  transition: "flex-grow 0.35s ease",
                }}
                className={`flex items-center justify-center px-3 py-0.5 select-none ${proposeHiddenPane === null && proposeViewMode !== "diff" ? "cursor-pointer" : ""}`}
                onClick={
                  proposeHiddenPane === null && proposeViewMode !== "diff"
                    ? (e) => {
                        e.stopPropagation();
                        setProposeHiddenPane("left");
                      }
                    : undefined
                }
              >
                <span
                  className="font-bold whitespace-nowrap"
                  style={{
                    color: "var(--text)",
                    opacity: proposeHiddenPane === "right" ? 0 : 1,
                    transition: "opacity 0.35s ease",
                  }}
                >
                  EDITOR
                </span>
              </div>
            </div>
          )}
        </div>
      ) : content === null || content === undefined ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <p className="text-[var(--text-muted)] text-sm">No wiki page yet</p>
          <a
            href={`https://www.reddit.com/r/${subredditName}/wiki/index`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Create the wiki index page
          </a>
        </div>
      ) : (
        <div
          ref={readScrollRef}
          data-wiki-scroll=""
          className="flex-1 overflow-auto"
          style={{ scrollbarGutter: "stable both-edges" }}
        >
          <WikiMarkdownContent
            content={content}
            subredditName={subredditName}
            currentPage={currentPage}
            wikiFontSize={wikiFontSize}
            onPageChange={handlePageChange}
            onCopyEchoLink={onCopyEchoLink}
            targetAnchor={targetAnchor}
            onAnchorConsumed={onAnchorConsumed}
          />
        </div>
      )}

      {showCancelDialog && (
        <ConfirmDialog
          title="Discard changes?"
          message="Your unsaved changes will be lost."
          confirmLabel="Discard"
          isDanger
          onConfirm={handleCancelConfirm}
          onDismiss={() => setShowCancelDialog(false)}
        />
      )}

      {showSaveDialog && (
        <WikiSaveDialog
          reason={saveReason}
          onReasonChange={setSaveReason}
          onConfirm={() => void handleSaveConfirm()}
          onDismiss={() => {
            setShowSaveDialog(false);
            setSaveError(null);
          }}
          isSaving={isSaving}
          error={saveError}
          voteOnSave={voteOnSaveAvailable}
          createVote={createVotePost}
          onCreateVoteChange={setCreateVotePost}
        />
      )}

      {showSuggestDialog && (
        <WikiSuggestDialog
          description={suggestDescription}
          onDescriptionChange={setSuggestDescription}
          onConfirm={() => void handleSuggestConfirm()}
          onDismiss={() => {
            setShowSuggestDialog(false);
            setSuggestError(null);
          }}
          isSaving={isSaving}
          error={suggestError}
        />
      )}

      {existingSuggestion !== null && (
        <WikiExistingSuggestionDialog
          existingPage={existingSuggestion.page}
          onSee={handleExistingSuggestionSee}
          onDelete={() => void handleExistingSuggestionDelete()}
          onCancel={() => setExistingSuggestion(null)}
          isDeleting={isDeletingSuggestion}
        />
      )}
    </div>
  );
});
