import {
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from "react";

import { highlightWikiSource } from "../wikiHighlight";

/** Read-only highlighted source, used by the "Source" review panes. */
export function WikiSourceHighlight({
  source,
  className,
  style,
}: {
  source: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <pre
      className={className}
      style={style}
      dangerouslySetInnerHTML={{
        __html: source ? highlightWikiSource(source) : "(empty)",
      }}
    />
  );
}

// Geometry shared between the highlight layer and the textarea so they overlap
// perfectly. Any change here must be applied to both elements identically: any
// difference in font, padding, wrapping, or width drifts the caret off the text.
const EDITOR_LAYER =
  "m-0 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words";

/**
 * A textarea with live syntax highlighting, built on the proven "transparent
 * textarea over a highlighted <pre>" technique.
 *
 * Crucially, the **textarea itself does not scroll** (`overflow:hidden`): the
 * outer wrapper is the scroll container, so both the <pre> (which defines the
 * height) and the absolutely-positioned textarea share the exact same width and
 * therefore wrap identically. If the textarea scrolled, its scrollbar would
 * narrow its text area and long unbreakable tokens (e.g. `echo://...` URLs) would
 * wrap at different points than the full-width <pre>, shifting the caret and
 * garbling selections.
 */
export function WikiSourceEditor({
  value,
  onChange,
  textareaRef,
  scrollRef,
  onScroll,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  scrollRef?: RefObject<HTMLDivElement | null> | undefined;
  onScroll?: (() => void) | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="relative flex-1 min-h-0 overflow-auto"
      style={{ scrollbarGutter: "stable" }}
    >
      <div className="relative min-h-full">
        <pre
          aria-hidden="true"
          className={`${EDITOR_LAYER} block pointer-events-none`}
          style={{ color: "var(--text)", minHeight: "100%" }}
          // Trailing newline keeps the layer's height in step with the textarea,
          // which always reserves a blank final line.
          dangerouslySetInnerHTML={{
            __html: highlightWikiSource(value) + "\n",
          }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          wrap="soft"
          // Spellcheck stays on: the browser's squiggly underlines render above
          // the (transparent-text) textarea, overlaying the highlighted layer
          // and surfacing the native auto-corrector while editing.
          spellCheck={true}
          placeholder={placeholder}
          className={`${EDITOR_LAYER} absolute inset-0 resize-none overflow-hidden bg-transparent outline-none placeholder:text-[var(--text-muted)]`}
          style={{
            color: "transparent",
            WebkitTextFillColor: "transparent",
            caretColor: "var(--text)",
          }}
        />
      </div>
    </div>
  );
}
