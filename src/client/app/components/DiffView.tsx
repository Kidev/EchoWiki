import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WikiFontSize } from "../../../shared/types/api";
import { WikiMarkdownContent } from "./WikiMarkdownContent";
import { WikiSourceHighlight } from "./WikiSource";

export type DiffLine = { type: "equal" | "add" | "remove"; line: string };

export type CharSpan = { text: string; kind: "same" | "add" | "remove" };

export type SideBySideLine =
  | { type: "equal"; leftNum: number; rightNum: number; content: string }
  | {
      type: "changed";
      leftNum: number;
      rightNum: number;
      leftChars: CharSpan[];
      rightChars: CharSpan[];
    }
  | { type: "remove"; leftNum: number; leftChars: CharSpan[] }
  | { type: "add"; rightNum: number; rightChars: CharSpan[] }
  | { type: "hunk"; count: number };

const DIFF_CONTEXT = 3;
const DIFF_LINE_LIMIT = 6000;

function computeLineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const m = aLines.length;
  const n = bLines.length;

  const stride = n + 1;
  const dp = new Int32Array((m + 1) * stride);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i * stride + j] = dp[(i - 1) * stride + (j - 1)]! + 1;
      } else {
        const up = dp[(i - 1) * stride + j]!;
        const left = dp[i * stride + (j - 1)]!;
        dp[i * stride + j] = up > left ? up : left;
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      result.unshift({ type: "equal", line: aLines[i - 1]! });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || dp[i * stride + (j - 1)]! >= dp[(i - 1) * stride + j]!)
    ) {
      result.unshift({ type: "add", line: bLines[j - 1]! });
      j--;
    } else {
      result.unshift({ type: "remove", line: aLines[i - 1]! });
      i--;
    }
  }
  return result;
}

function computeCharDiff(
  left: string,
  right: string,
): [CharSpan[], CharSpan[]] {
  const m = left.length;
  const n = right.length;
  const stride = n + 1;
  const dp = new Int32Array((m + 1) * stride);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (left[i - 1] === right[j - 1]) {
        dp[i * stride + j] = dp[(i - 1) * stride + (j - 1)]! + 1;
      } else {
        const up = dp[(i - 1) * stride + j]!;
        const lft = dp[i * stride + (j - 1)]!;
        dp[i * stride + j] = up > lft ? up : lft;
      }
    }
  }
  type LItem = { kind: "same" | "remove"; c: string };
  type RItem = { kind: "same" | "add"; c: string };
  const lBuf: LItem[] = [];
  const rBuf: RItem[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      lBuf.unshift({ kind: "same", c: left[i - 1]! });
      rBuf.unshift({ kind: "same", c: right[j - 1]! });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || dp[i * stride + (j - 1)]! >= dp[(i - 1) * stride + j]!)
    ) {
      rBuf.unshift({ kind: "add", c: right[j - 1]! });
      j--;
    } else {
      lBuf.unshift({ kind: "remove", c: left[i - 1]! });
      i--;
    }
  }
  function mergeSpans<T extends { kind: string; c: string }>(
    buf: T[],
  ): CharSpan[] {
    const spans: CharSpan[] = [];
    for (const item of buf) {
      if (spans.length > 0 && spans[spans.length - 1]!.kind === item.kind) {
        spans[spans.length - 1]!.text += item.c;
      } else {
        spans.push({ text: item.c, kind: item.kind as CharSpan["kind"] });
      }
    }
    return spans;
  }
  return [mergeSpans(lBuf), mergeSpans(rBuf)];
}

function computeSideBySideDiff(
  original: string,
  proposed: string,
): SideBySideLine[] {
  const lineDiff = computeLineDiff(original, proposed);
  const raw: SideBySideLine[] = [];
  let leftNum = 0;
  let rightNum = 0;
  let i = 0;
  while (i < lineDiff.length) {
    const line = lineDiff[i]!;
    if (line.type === "equal") {
      leftNum++;
      rightNum++;
      raw.push({ type: "equal", leftNum, rightNum, content: line.line });
      i++;
    } else {
      const removes: string[] = [];
      const adds: string[] = [];
      while (i < lineDiff.length && lineDiff[i]!.type === "remove") {
        removes.push(lineDiff[i]!.line);
        i++;
      }
      while (i < lineDiff.length && lineDiff[i]!.type === "add") {
        adds.push(lineDiff[i]!.line);
        i++;
      }
      const pairCount = Math.min(removes.length, adds.length);
      for (let k = 0; k < pairCount; k++) {
        leftNum++;
        rightNum++;
        const [lChars, rChars] = computeCharDiff(removes[k]!, adds[k]!);
        raw.push({
          type: "changed",
          leftNum,
          rightNum,
          leftChars: lChars,
          rightChars: rChars,
        });
      }
      for (let k = pairCount; k < removes.length; k++) {
        leftNum++;
        raw.push({
          type: "remove",
          leftNum,
          leftChars: [{ text: removes[k]!, kind: "remove" }],
        });
      }
      for (let k = pairCount; k < adds.length; k++) {
        rightNum++;
        raw.push({
          type: "add",
          rightNum,
          rightChars: [{ text: adds[k]!, kind: "add" }],
        });
      }
    }
  }

  const isNear = raw.map((_, idx) => {
    for (
      let k = Math.max(0, idx - DIFF_CONTEXT);
      k <= Math.min(raw.length - 1, idx + DIFF_CONTEXT);
      k++
    ) {
      if (raw[k]!.type !== "equal") return true;
    }
    return false;
  });
  const result: SideBySideLine[] = [];
  let j = 0;
  while (j < raw.length) {
    const entry = raw[j]!;
    if (entry.type === "equal" && !isNear[j]) {
      let count = 0;
      while (j < raw.length && raw[j]!.type === "equal" && !isNear[j]) {
        count++;
        j++;
      }
      result.push({ type: "hunk", count });
    } else {
      result.push(entry);
      j++;
    }
  }
  return result;
}

export function SideBySideDiffView({
  original,
  proposed,
}: {
  original: string;
  proposed: string;
}) {
  const tooLarge = useMemo(
    () =>
      original.split("\n").length + proposed.split("\n").length >
      DIFF_LINE_LIMIT,
    [original, proposed],
  );
  const lines = useMemo(
    () => (tooLarge ? [] : computeSideBySideDiff(original, proposed)),
    [tooLarge, original, proposed],
  );

  if (tooLarge) {
    return (
      <div className="flex items-center justify-center py-8 text-sm px-6 text-center text-[var(--text-muted)]">
        Content too large to diff. Use Source view to review changes.
      </div>
    );
  }

  const hasChanges = lines.some((l) => l.type !== "equal" && l.type !== "hunk");
  if (!hasChanges) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
        No changes
      </div>
    );
  }

  function renderChars(spans: CharSpan[], side: "left" | "right") {
    return spans.map((span, si) => {
      if (span.kind === "same")
        return <span key={si}>{span.text || "\u00a0"}</span>;
      if (side === "left" && span.kind === "remove")
        return (
          <span key={si} className="bg-red-500/50 rounded-[1px]">
            {span.text}
          </span>
        );
      if (side === "right" && span.kind === "add")
        return (
          <span key={si} className="bg-green-500/50 rounded-[1px]">
            {span.text}
          </span>
        );
      return <span key={si}>{span.text}</span>;
    });
  }

  return (
    <div
      className="flex flex-col h-full overflow-auto font-mono text-xs select-text"
      style={{ scrollbarGutter: "stable both-edges" }}
    >
      {lines.map((line, idx) => {
        if (line.type === "hunk") {
          return (
            <div
              key={idx}
              className="flex border-y select-none"
              style={{
                borderColor: "var(--thumb-bg)",
                backgroundColor: "var(--control-bg)",
                opacity: 0.7,
              }}
            >
              <div className="w-9 shrink-0" />
              <div
                className="flex-1 px-2 py-0.5 text-[10px] italic border-r"
                style={{
                  color: "var(--text-muted)",
                  borderColor: "var(--thumb-bg)",
                }}
              >
                . {line.count} unchanged line{line.count !== 1 ? "s" : ""}
              </div>
              <div className="w-9 shrink-0" />
              <div className="flex-1" />
            </div>
          );
        }
        const leftNum = line.type !== "add" ? line.leftNum : null;
        const rightNum = line.type !== "remove" ? line.rightNum : null;
        const leftBg =
          line.type === "remove"
            ? "bg-red-500/15"
            : line.type === "changed"
              ? "bg-red-500/10"
              : "";
        const rightBg =
          line.type === "add"
            ? "bg-green-500/15"
            : line.type === "changed"
              ? "bg-green-500/10"
              : "";
        const leftContent = () => {
          if (line.type === "add") return null;
          if (line.type === "equal") return <>{line.content || "\u00a0"}</>;
          return renderChars(line.leftChars, "left");
        };
        const rightContent = () => {
          if (line.type === "remove") return null;
          if (line.type === "equal") return <>{line.content || "\u00a0"}</>;
          return renderChars(line.rightChars, "right");
        };
        return (
          <div key={idx} className="flex">
            <div
              className={`flex flex-1 min-w-0 border-r ${leftBg}`}
              style={{ borderColor: "var(--thumb-bg)" }}
            >
              <span
                className="w-9 shrink-0 text-right pr-2 py-0 leading-5 select-none opacity-40 text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {leftNum ?? ""}
              </span>
              <span
                className="flex-1 px-2 py-0 leading-5 whitespace-pre-wrap break-all min-w-0"
                style={{ color: "var(--text)" }}
              >
                {leftContent()}
              </span>
            </div>
            <div className={`flex flex-1 min-w-0 ${rightBg}`}>
              <span
                className="w-9 shrink-0 text-right pr-2 py-0 leading-5 select-none opacity-40 text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {rightNum ?? ""}
              </span>
              <span
                className="flex-1 px-2 py-0 leading-5 whitespace-pre-wrap break-all min-w-0"
                style={{ color: "var(--text)" }}
              >
                {rightContent()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Toggle for the side-by-side scroll lock. Kept here (rather than inline) so the
// compare panes and any external toolbar (e.g. the voting view) render an
// identical control. Mirrors the editor's scroll-lock button styling.
export function ScrollLockToggle({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={
        locked
          ? "Scroll lock on: the two panes stay aligned as you scroll"
          : "Scroll lock off: panes scroll independently"
      }
      aria-pressed={locked}
      aria-label={locked ? "Scroll lock on" : "Scroll lock off"}
      className={`shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer hover:bg-[var(--control-bg)] ${
        locked ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
      }`}
    >
      {locked ? (
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      ) : (
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 7.5-1.9" />
        </svg>
      )}
    </button>
  );
}

export function CompareView({
  original,
  proposed,
  subredditName,
  currentPage,
  wikiFontSize,
  leftLabel = "Current",
  rightLabel = "Suggested",
  mode: controlledMode,
  initialMode = "normal",
  scrollLocked: controlledScrollLocked,
  onScrollLockChange,
}: {
  original: string;
  proposed: string;
  subredditName: string;
  currentPage: string;
  wikiFontSize: WikiFontSize;
  leftLabel?: string;
  rightLabel?: string;
  mode?: "normal" | "source" | "diff";
  initialMode?: "normal" | "source" | "diff";
  // When provided, scroll-lock state is controlled by the parent (which is then
  // responsible for rendering its own ScrollLockToggle). Otherwise CompareView
  // manages the state itself and shows a toggle in its built-in toolbar.
  scrollLocked?: boolean;
  onScrollLockChange?: (locked: boolean) => void;
}) {
  const [internalMode, setInternalMode] = useState<
    "normal" | "source" | "diff"
  >(initialMode);
  const mode = controlledMode ?? internalMode;
  const [hiddenCol, setHiddenCol] = useState<null | "left" | "right">(null);
  useEffect(() => {
    if (mode === "diff") setHiddenCol(null);
  }, [mode]);

  // Side-by-side scroll lock: yoke the two panes proportionally so the same
  // relative position of each document stays visible together. Proportional
  // (rather than heading-anchored like the editor) because the panes share an
  // identical layout/zoom, so the fraction maps cleanly and is robust to the
  // two documents diverging. `lockGuardRef` stops the programmatic scroll of one
  // pane from echoing back and fighting the user.
  const [internalLock, setInternalLock] = useState(true);
  const scrollLocked = controlledScrollLocked ?? internalLock;
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const lockGuardRef = useRef(false);

  const syncFrom = useCallback(
    (from: "left" | "right") => {
      if (!scrollLocked || lockGuardRef.current || hiddenCol !== null) return;
      const left = leftScrollRef.current;
      const right = rightScrollRef.current;
      if (!left || !right) return;
      const src = from === "left" ? left : right;
      const dst = from === "left" ? right : left;
      const fromMax = src.scrollHeight - src.clientHeight;
      const toMax = dst.scrollHeight - dst.clientHeight;
      if (fromMax <= 0 || toMax <= 0) return;
      lockGuardRef.current = true;
      dst.scrollTop = (src.scrollTop / fromMax) * toMax;
      requestAnimationFrame(() => {
        lockGuardRef.current = false;
      });
    },
    [scrollLocked, hiddenCol],
  );
  const handleLeftScroll = useCallback(() => syncFrom("left"), [syncFrom]);
  const handleRightScroll = useCallback(() => syncFrom("right"), [syncFrom]);
  const toggleScrollLock = useCallback(() => {
    if (controlledScrollLocked === undefined) setInternalLock((v) => !v);
    onScrollLockChange?.(!scrollLocked);
  }, [controlledScrollLocked, onScrollLockChange, scrollLocked]);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {controlledMode === undefined && (
        <div
          className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0"
          style={{
            borderColor: "var(--thumb-bg)",
            backgroundColor: "var(--thumb-bg)",
          }}
        >
          {(["normal", "source", "diff"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setInternalMode(m)}
              className={`text-[10px] px-2.5 py-1 rounded transition-colors cursor-pointer ${
                mode === m
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--control-bg)]"
              }`}
            >
              {m === "normal"
                ? "Preview"
                : m === "source"
                  ? "Source"
                  : "Changes"}
            </button>
          ))}
          {mode !== "diff" && (
            <div className="ml-auto">
              <ScrollLockToggle
                locked={scrollLocked}
                onToggle={toggleScrollLock}
              />
            </div>
          )}
        </div>
      )}
      {mode === "diff" ? (
        <div className="flex-1 overflow-hidden">
          <SideBySideDiffView original={original} proposed={proposed} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {}
          <div
            style={{
              flexGrow: hiddenCol === "left" ? 0 : 1,
              flexShrink: 1,
              flexBasis: "0%",
              minWidth: 0,
              overflow: "hidden",
              transition: "flex-grow 0.35s ease",
              borderRight: "1px solid var(--thumb-bg)",
            }}
          >
            <div
              ref={leftScrollRef}
              onScroll={handleLeftScroll}
              className="h-full overflow-auto"
              style={{ scrollbarGutter: "stable both-edges" }}
            >
              <div style={{ zoom: hiddenCol === null ? 0.5 : 1 }}>
                {mode === "normal" ? (
                  original ? (
                    <WikiMarkdownContent
                      content={original}
                      subredditName={subredditName}
                      currentPage={currentPage}
                      wikiFontSize={wikiFontSize}
                      onPageChange={() => undefined}
                      onCopyEchoLink={() => undefined}
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center py-12 text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      No existing content
                    </div>
                  )
                ) : (
                  <WikiSourceHighlight
                    source={original}
                    className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed"
                    style={{ color: "var(--text)" }}
                  />
                )}
              </div>
            </div>
          </div>
          {}
          <div
            style={{
              flexGrow: hiddenCol === "right" ? 0 : 1,
              flexShrink: 1,
              flexBasis: "0%",
              minWidth: 0,
              overflow: "hidden",
              transition: "flex-grow 0.35s ease",
            }}
          >
            <div
              ref={rightScrollRef}
              onScroll={handleRightScroll}
              className="h-full overflow-auto"
              style={{ scrollbarGutter: "stable both-edges" }}
            >
              <div style={{ zoom: hiddenCol === null ? 0.5 : 1 }}>
                {mode === "normal" ? (
                  <WikiMarkdownContent
                    content={proposed}
                    subredditName={subredditName}
                    currentPage={currentPage}
                    wikiFontSize={wikiFontSize}
                    onPageChange={() => undefined}
                    onCopyEchoLink={() => undefined}
                  />
                ) : (
                  <WikiSourceHighlight
                    source={proposed}
                    className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed"
                    style={{ color: "var(--text)" }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {}
      <div
        className="flex items-center shrink-0 border-t text-[10px]"
        style={{
          borderColor: "var(--thumb-bg)",
          backgroundColor: "var(--thumb-bg)",
          cursor: hiddenCol !== null ? "pointer" : "default",
        }}
        onClick={hiddenCol !== null ? () => setHiddenCol(null) : undefined}
      >
        <div
          style={{
            flexGrow: hiddenCol === "left" ? 0 : 1,
            flexShrink: 1,
            flexBasis: "0%",
            overflow: "hidden",
            transition: "flex-grow 0.35s ease",
          }}
          className={`flex items-center justify-center px-3 py-0.5 select-none ${hiddenCol === null && mode !== "diff" ? "cursor-pointer" : ""}`}
          onClick={
            hiddenCol === null && mode !== "diff"
              ? (e) => {
                  e.stopPropagation();
                  setHiddenCol("right");
                }
              : undefined
          }
        >
          <span
            className="font-bold whitespace-nowrap"
            style={{
              color: "var(--text)",
              opacity: hiddenCol === "left" ? 0 : 1,
              transition: "opacity 0.35s ease",
            }}
          >
            {leftLabel.toUpperCase()}
          </span>
        </div>
        {hiddenCol === null && (
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
            flexGrow: hiddenCol === "right" ? 0 : 1,
            flexShrink: 1,
            flexBasis: "0%",
            overflow: "hidden",
            transition: "flex-grow 0.35s ease",
          }}
          className={`flex items-center justify-center px-3 py-0.5 select-none ${hiddenCol === null && mode !== "diff" ? "cursor-pointer" : ""}`}
          onClick={
            hiddenCol === null && mode !== "diff"
              ? (e) => {
                  e.stopPropagation();
                  setHiddenCol("left");
                }
              : undefined
          }
        >
          <span
            className="font-bold whitespace-nowrap"
            style={{
              color: "var(--text)",
              opacity: hiddenCol === "right" ? 0 : 1,
              transition: "opacity 0.35s ease",
            }}
          >
            {rightLabel.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}
