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
  WikiDraft,
  WikiDraftRequest,
  WikiDraftResponse,
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
  WikiResumeDraftDialog,
  WikiDraftElsewhereDialog,
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
  startInEditMode,
  onStartInEditModeConsumed,
  startInSuggestMode,
  onStartInSuggestModeConsumed,
  onEditingChange,
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
  onNavigateToSuggestion?:
    | ((page: string, content: string) => void)
    | undefined;
  startInEditMode?: string | null | undefined;
  onStartInEditModeConsumed?: (() => void) | undefined;
  startInSuggestMode?: string | null | undefined;
  onStartInSuggestModeConsumed?: (() => void) | undefined;
  onEditingChange?: ((editing: boolean) => void) | undefined;
}) {
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const readScrollRef = useRef<HTMLDivElement>(null);
  const lastPageRef = useRef(currentPage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The user's single in-progress edit draft (persisted server-side, survives
  // app close/restart). `draftRef` is the always-current source of truth read
  // by the edit gate; `draft` state drives the proactive "Resume draft?" prompt.
  const [draft, setDraft] = useState<WikiDraft | null>(null);
  const draftRef = useRef<WikiDraft | null>(null);
  // Baseline (saved page content) the current edit started from, used to detect
  // whether there are unsaved changes worth persisting as a draft.
  const baselineRef = useRef("");
  // When true, auto-save is suppressed (no editor open, or the draft was just
  // saved/submitted/discarded). Reset to false whenever an editor is opened.
  const draftFinalizedRef = useRef(true);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [elsewhereDraft, setElsewhereDraft] = useState<WikiDraft | null>(null);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const [pendingDraftOpen, setPendingDraftOpen] = useState<WikiDraft | null>(
    null,
  );
  // Pages we've already prompted to resume this session (avoids re-nagging).
  const resumeHandledRef = useRef<Set<string>>(new Set());
  // Editor-open continuation deferred behind a draft prompt (resume/elsewhere).
  const pendingProceedRef = useRef<(() => void) | null>(null);

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
  const [existingSuggestion, setExistingSuggestion] =
    useState<WikiSuggestion | null>(null);
  const [isDeletingSuggestion, setIsDeletingSuggestion] = useState(false);
  const [proposeViewMode, setProposeViewMode] = useState<
    "normal" | "source" | "diff"
  >("normal");
  const [proposeHiddenPane, setProposeHiddenPane] = useState<
    null | "left" | "right"
  >(null);
  const [createVotePost, setCreateVotePost] = useState(true);

  useEffect(() => {
    if (proposeViewMode === "diff") setProposeHiddenPane(null);
  }, [proposeViewMode]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/wiki?page=${encodeURIComponent(currentPage)}`,
        );
        if (res.ok) {
          const data: WikiResponse = await res.json();

          const echoPaths = data.content
            ? extractEchoPathsFromMarkdown(data.content)
            : [];
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
    setShowResumeDialog(false);
    setElsewhereDraft(null);
  }, [currentPage]);

  useEffect(() => {
    if (suggestionToLoad != null) {
      setEditContent(suggestionToLoad);
      baselineRef.current = content ?? "";
      draftFinalizedRef.current = false;
      setIsEditing(true);
      setIsProposeMode(true);
      onSuggestionLoaded?.();
    }
    // `content` intentionally excluded: we only react to a new suggestion to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionToLoad, onSuggestionLoaded]);

  // Fetch the user's existing draft once on mount so the edit gate and the
  // proactive resume prompt know about work left over from a previous session.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/wiki/draft");
        if (res.ok) {
          const data: WikiDraftResponse = await res.json();
          draftRef.current = data.draft;
          setDraft(data.draft);
        }
      } catch {}
    })();
  }, []);

  const deleteDraft = useCallback(async () => {
    draftFinalizedRef.current = true;
    draftRef.current = null;
    setDraft(null);
    try {
      await fetch("/api/wiki/draft", { method: "DELETE" });
    } catch {}
  }, []);

  // Auto-save the in-progress edit as a draft (debounced) whenever the editor
  // content diverges from the saved page. Survives app close so nothing is lost.
  useEffect(() => {
    if (!isEditing || draftFinalizedRef.current) return;
    if (editContent === baselineRef.current) return;
    const mode = isProposeMode ? "suggest" : "edit";
    const handle = setTimeout(() => {
      if (draftFinalizedRef.current) return;
      const body: WikiDraftRequest = {
        page: currentPage,
        content: editContent,
        mode,
      };
      void (async () => {
        try {
          const res = await fetch("/api/wiki/draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok || draftFinalizedRef.current) return;
          const saved: WikiDraft = { ...body, updatedAt: Date.now() };
          draftRef.current = saved;
          // Only surface a state change when the draft's identity changes
          // (first save of a session) to avoid re-rendering on every keystroke.
          setDraft((prev) =>
            prev && prev.page === saved.page && prev.mode === saved.mode
              ? prev
              : saved,
          );
        } catch {}
      })();
    }, 800);
    return () => clearTimeout(handle);
  }, [editContent, isEditing, isProposeMode, currentPage]);

  // Open the editor seeded from a draft, honoring the user's current rank/perms:
  // a draft saved as a direct edit downgrades to a suggestion if they can no
  // longer edit directly.
  const openDraftEditor = useCallback(
    (d: WikiDraft) => {
      const proposeMode = d.mode === "suggest" || !isMod;
      setEditContent(d.content);
      setIsProposeMode(proposeMode);
      setIsEditing(true);
      baselineRef.current = content ?? "";
      draftFinalizedRef.current = false;
      resumeHandledRef.current.add(d.page);
    },
    [content, isMod],
  );

  // Open the editor with the draft once navigation to its page has loaded.
  useEffect(() => {
    if (!pendingDraftOpen) return;
    if (
      pendingDraftOpen.page !== currentPage ||
      loading ||
      content === undefined
    )
      return;
    openDraftEditor(pendingDraftOpen);
    setPendingDraftOpen(null);
  }, [pendingDraftOpen, currentPage, loading, content, openDraftEditor]);

  // Proactively offer to resume when the user opens the page that holds a draft.
  useEffect(() => {
    if (isEditing || loading || content === undefined || pendingDraftOpen)
      return;
    if (!isExpanded || !(isMod || canSuggest)) return;
    const d = draft;
    if (!d || d.page !== currentPage) return;
    if (resumeHandledRef.current.has(d.page)) return;
    setShowResumeDialog(true);
  }, [
    draft,
    currentPage,
    isEditing,
    loading,
    content,
    pendingDraftOpen,
    isExpanded,
    isMod,
    canSuggest,
  ]);

  // Intercept an edit/suggest entry point to gate it behind the single-draft
  // rule. With no draft, the editor opens immediately.
  const gateBeforeEdit = useCallback(
    (proceed: () => void) => {
      const d = draftRef.current;
      if (d) {
        pendingProceedRef.current = proceed;
        if (d.page === currentPage) {
          setShowResumeDialog(true);
        } else {
          setElsewhereDraft(d);
        }
        return;
      }
      proceed();
    },
    [currentPage],
  );

  const handlePageChange = useCallback(
    (page: string) => {
      onPageChange(page);
    },
    [onPageChange],
  );

  const handleToolbarInsert = useCallback((newValue: string) => {
    setEditContent(newValue);
  }, []);

  const proceedEdit = useCallback(() => {
    setEditContent(content ?? "");
    baselineRef.current = content ?? "";
    draftFinalizedRef.current = false;
    setIsProposeMode(false);
    setIsEditing(true);
  }, [content]);

  const proceedSuggest = useCallback(async () => {
    try {
      const res = await fetch("/api/wiki/suggestion");
      if (res.ok) {
        const data: WikiSuggestionResponse = await res.json();
        if (data.suggestion) {
          if (data.suggestion.page === currentPage) {
            setEditContent(data.suggestion.content);
            baselineRef.current = content ?? "";
            draftFinalizedRef.current = false;
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
    baselineRef.current = content ?? "";
    draftFinalizedRef.current = false;
    setIsEditing(true);
    setIsProposeMode(true);
  }, [currentPage, content]);

  const handleResumeDraft = useCallback(() => {
    const d = draftRef.current;
    setShowResumeDialog(false);
    resumeHandledRef.current.add(currentPage);
    pendingProceedRef.current = null;
    if (d && d.page === currentPage) openDraftEditor(d);
  }, [currentPage, openDraftEditor]);

  const handleDiscardResumeDraft = useCallback(async () => {
    setIsDiscardingDraft(true);
    const proceed = pendingProceedRef.current;
    pendingProceedRef.current = null;
    await deleteDraft();
    setIsDiscardingDraft(false);
    setShowResumeDialog(false);
    resumeHandledRef.current.add(currentPage);
    proceed?.();
  }, [currentPage, deleteDraft]);

  const handleDismissResumeDraft = useCallback(() => {
    setShowResumeDialog(false);
    resumeHandledRef.current.add(currentPage);
    pendingProceedRef.current = null;
  }, [currentPage]);

  const handleSeeElsewhereDraft = useCallback(() => {
    const d = elsewhereDraft;
    setElsewhereDraft(null);
    pendingProceedRef.current = null;
    if (!d) return;
    if (d.page === currentPage) {
      openDraftEditor(d);
    } else {
      setPendingDraftOpen(d);
      onPageChange(d.page);
    }
  }, [elsewhereDraft, currentPage, openDraftEditor, onPageChange]);

  const handleDiscardElsewhereDraft = useCallback(async () => {
    setIsDiscardingDraft(true);
    const proceed = pendingProceedRef.current;
    pendingProceedRef.current = null;
    await deleteDraft();
    setIsDiscardingDraft(false);
    setElsewhereDraft(null);
    proceed?.();
  }, [deleteDraft]);

  const handleCancelElsewhereDraft = useCallback(() => {
    setElsewhereDraft(null);
    pendingProceedRef.current = null;
  }, []);

  // The Edit affordance now lives on the breadcrumb line (App.tsx). It opens the
  // editor by setting `startInEditMode` to this page; we open the editor once the
  // page has loaded, gated by the single-draft rule like any other edit entry
  // point. The collapsed (inline) view routes through the same prop after first
  // popping out to the expanded view.
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
    onStartInEditModeConsumed?.();
    gateBeforeEdit(proceedEdit);
  }, [
    startInEditMode,
    currentPage,
    loading,
    content,
    isMod,
    isExpanded,
    onStartInEditModeConsumed,
    gateBeforeEdit,
    proceedEdit,
  ]);

  // Suggest counterpart of the above: the breadcrumb "Suggest" button sets
  // `startInSuggestMode`, opening the propose-mode editor (gated) once loaded.
  useEffect(() => {
    if (
      !startInSuggestMode ||
      startInSuggestMode !== currentPage ||
      loading ||
      content === undefined ||
      !canSuggest ||
      !isExpanded
    )
      return;
    onStartInSuggestModeConsumed?.();
    gateBeforeEdit(() => void proceedSuggest());
  }, [
    startInSuggestMode,
    currentPage,
    loading,
    content,
    canSuggest,
    isExpanded,
    onStartInSuggestModeConsumed,
    gateBeforeEdit,
    proceedSuggest,
  ]);

  // Report editing state up so the breadcrumb can hide its Edit button while an
  // editor is already open on this page.
  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  const handleCancelConfirm = useCallback(() => {
    setIsEditing(false);
    setIsProposeMode(false);
    setEditContent("");
    setShowCancelDialog(false);
    setSaveError(null);
    setSuggestDescription("");
    setSuggestError(null);
    setShowSuggestDialog(false);
    // Discarding the edit discards the draft too.
    void deleteDraft();
  }, [deleteDraft]);

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
        void deleteDraft();
        showToast("Vote suggestion submitted!");
      } else {
        const body: WikiUpdateRequest = {
          page: currentPage,
          content: editContent,
          reason: username
            ? `${username}: ${saveReason.trim()}`
            : saveReason.trim(),
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
        void deleteDraft();
      }
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [
    createVotePost,
    currentPage,
    editContent,
    saveReason,
    username,
    voteOnSaveAvailable,
    deleteDraft,
  ]);

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
      void deleteDraft();
      showToast("Suggestion submitted!");
    } catch {
      setSuggestError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [currentPage, editContent, suggestDescription, deleteDraft]);

  const handleExistingSuggestionSee = useCallback(() => {
    if (!existingSuggestion) return;
    setExistingSuggestion(null);
    onNavigateToSuggestion?.(
      existingSuggestion.page,
      existingSuggestion.content,
    );
  }, [existingSuggestion, onNavigateToSuggestion]);

  const handleExistingSuggestionDelete = useCallback(async () => {
    setIsDeletingSuggestion(true);
    try {
      await fetch("/api/wiki/suggestion", { method: "DELETE" });
      setExistingSuggestion(null);

      setEditContent(content ?? "");
      baselineRef.current = content ?? "";
      draftFinalizedRef.current = false;
      setIsEditing(true);
      setIsProposeMode(true);
    } catch {
    } finally {
      setIsDeletingSuggestion(false);
    }
  }, [content]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
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
                      {m === "normal"
                        ? "Normal"
                        : m === "source"
                          ? "Source"
                          : "Diff"}
                    </button>
                  ))}
                </div>
              )}
              <div
                className="flex-1 overflow-hidden"
                style={{
                  zoom:
                    isProposeMode &&
                    proposeHiddenPane === null &&
                    proposeViewMode !== "diff"
                      ? 0.5
                      : 1,
                }}
              >
                {isProposeMode && proposeViewMode === "diff" ? (
                  <SideBySideDiffView
                    original={content ?? ""}
                    proposed={editContent}
                  />
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
                  textareaRef={
                    textareaRef as MutableRefObject<HTMLTextAreaElement | null>
                  }
                />
              </Suspense>
              <textarea
                ref={textareaRef}
                className="flex-1 resize-none p-4 font-mono text-sm bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                value={editContent}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setEditContent(e.target.value)
                }
                spellCheck={false}
                placeholder="Write wiki markdown here..."
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
              onClick={
                proposeHiddenPane !== null
                  ? () => setProposeHiddenPane(null)
                  : undefined
              }
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
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
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

      {showResumeDialog && (
        <WikiResumeDraftDialog
          onResume={handleResumeDraft}
          onDiscard={() => void handleDiscardResumeDraft()}
          onDismiss={handleDismissResumeDraft}
          isDiscarding={isDiscardingDraft}
        />
      )}

      {elsewhereDraft !== null && (
        <WikiDraftElsewhereDialog
          draftPage={elsewhereDraft.page}
          onSee={handleSeeElsewhereDraft}
          onDiscard={() => void handleDiscardElsewhereDraft()}
          onCancel={handleCancelElsewhereDraft}
          isDiscarding={isDiscardingDraft}
        />
      )}
    </div>
  );
});
