import {
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from "react";

/**
 * Lightweight syntax highlighter for EchoWiki's markdown dialect. It is used in
 * two places: the read-only "Source" panes (via {@link WikiSourceHighlight}) and
 * as the highlight layer painted behind the editor textarea (via
 * {@link WikiSourceEditor}).
 *
 * Because the highlight layer must line up character-for-character with a real
 * <textarea> (so the caret and selection land on the right glyphs), the
 * highlighter only ever changes **color** and **background**, never the font
 * weight, style, or size. Those would alter glyph metrics and drift the overlay
 * out of alignment with the textarea underneath.
 */

const COLOR = {
  fence: "#a855f7", // ::: block fences, --- phase separators, list markers
  attrKey: "#3b9eff", // key in key=value params
  attrVal: "#22c55e", // value in key=value params
  echo: "var(--link-color, #0079d3)", // echo:// asset links
  prefix: "#ef8e4b", // bg:/fg:/layer: prefixes, move-line percentages
  heading: "#e0567a", // # headings
  emphasis: "#d98b3c", // **bold** / *italic*
  code: "#16a34a", // `inline code`
  link: "var(--link-color, #0079d3)", // [link](url) text
  muted: "var(--text-muted)", // blockquotes, punctuation
} as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(color: string, text: string, extra = ""): string {
  return `<span style="color:${color};${extra}">${text}</span>`;
}

// Private-use sentinels delimiting a held slot. They never occur in wiki source,
// so restoring them can't accidentally clobber real text (a bare " 5" would).
const SLOT_OPEN = "\uE000";
const SLOT_CLOSE = "\uE001";
const SLOT_RE = /\uE000(\d+)\uE001/g;

/**
 * Create a hold/restore pair. `hold(html)` stows finished HTML behind a sentinel
 * so later regex passes can't re-tokenize inside it (e.g. a URL within a link
 * must not be re-scanned for emphasis); `restore` swaps the sentinels back.
 */
function makeSlots() {
  const slots: string[] = [];
  const hold = (html: string): string => {
    const id = `${SLOT_OPEN}${slots.length}${SLOT_CLOSE}`;
    slots.push(html);
    return id;
  };
  // Restore iteratively: a held token can nest another (e.g. `[t](echo://...)`
  // holds the echo URL first, then holds the whole link with that placeholder
  // inside it). A single pass would expand the outer slot and leave the inner
  // placeholder behind: which then renders as stray □ glyphs. Loop until stable.
  const restore = (s: string): string => {
    let prev: string;
    do {
      prev = s;
      s = s.replace(SLOT_RE, (_m, i: string) => slots[+i] ?? "");
    } while (s !== prev);
    return s;
  };
  return { hold, restore };
}

/** Highlight inline constructs inside an already HTML-escaped string. */
function highlightInline(escaped: string): string {
  const { hold, restore } = makeSlots();
  let s = escaped;
  // `inline code`
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) =>
    hold(
      span(
        COLOR.code,
        "`" + c + "`",
        "background:var(--thumb-bg);border-radius:3px;",
      ),
    ),
  );
  // echo:// asset links (and echo://~alias references)
  s = s.replace(/echo:\/\/[^\s)"'\]]+/g, (m) => hold(span(COLOR.echo, m)));
  // [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) =>
    hold(
      span(COLOR.muted, "[") +
        span(COLOR.link, t) +
        span(COLOR.muted, "](" + u + ")"),
    ),
  );
  // **bold**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (_m, c: string) =>
    hold(span(COLOR.emphasis, "**" + c + "**")),
  );
  // *italic* (bold already consumed above)
  s = s.replace(/\*([^*\n]+)\*/g, (_m, c: string) =>
    hold(span(COLOR.emphasis, "*" + c + "*")),
  );
  return restore(s);
}

/** Color `key=value` / `key="value"` parameter pairs in an escaped string. */
function highlightAttrs(escaped: string): string {
  return escaped.replace(
    /(\w+)(=)("[^"]*"|\S*)/g,
    (_m, k: string, eq: string, v: string) =>
      span(COLOR.attrKey, k) + span(COLOR.muted, eq) + span(COLOR.attrVal, v),
  );
}

/** Color echo links first, then remaining `key=value` params (block bodies). */
function highlightEchoAndAttrs(escaped: string): string {
  const { hold, restore } = makeSlots();
  let s = escaped.replace(/echo:\/\/[^\s)"'\]]+/g, (m) =>
    hold(span(COLOR.echo, m)),
  );
  s = highlightAttrs(s);
  return restore(s);
}

const BLOCK_OPEN_RE = /^(:::)(def|fbf|scene|anim|card|infobox)\b(.*)$/;

/** Highlight a line that lives inside a `:::...:::` block body. */
function highlightBlockLine(raw: string): string {
  const trimmed = raw.trimStart();
  const indent = esc(raw.slice(0, raw.length - trimmed.length));

  // bg:/fg:/layer: scene directives
  const pm = /^(bg|fg|layer):(.*)$/.exec(trimmed);
  if (pm) {
    return (
      indent +
      span(COLOR.prefix, pm[1] + ":") +
      highlightEchoAndAttrs(esc(pm[2]!))
    );
  }
  if (/^---/.test(trimmed)) {
    return (
      indent + span(COLOR.fence, "---") + highlightAttrs(esc(trimmed.slice(3)))
    );
  }
  // move keyframe line: "50% left=10% bottom=5%"
  const mv = /^(\d+(?:\.\d+)?%)(\s+)(.*)$/.exec(trimmed);
  if (mv) {
    return (
      indent +
      span(COLOR.prefix, mv[1]!) +
      esc(mv[2]!) +
      highlightAttrs(esc(mv[3]!))
    );
  }
  // echo://... frame line, def entries, and anything else: echo links + params
  return indent + highlightEchoAndAttrs(esc(trimmed));
}

/** Highlight an ordinary (outside-of-block) markdown line. */
function highlightMarkdownLine(raw: string): string {
  const t = raw.trim();
  // standalone center markers
  if (t === ">>>" || t === "<<<") return span(COLOR.fence, esc(raw));

  // # headings
  const hm = /^(\s*)(#{1,6})(\s.*)?$/.exec(raw);
  if (hm) {
    return esc(hm[1]!) + span(COLOR.heading, esc(hm[2]! + (hm[3] ?? "")));
  }

  // > [!NOTE] style alert callouts
  const am = /^(\s*>\s*)(\[![A-Za-z]+\])(.*)$/.exec(raw);
  if (am) {
    return (
      esc(am[1]!) +
      span(COLOR.heading, esc(am[2]!)) +
      highlightInline(esc(am[3]!))
    );
  }

  // > blockquote
  const bm = /^(\s*>\s?)(.*)$/.exec(raw);
  if (bm) {
    return span(COLOR.muted, esc(bm[1]!)) + highlightInline(esc(bm[2]!));
  }

  // list markers ( -, *, +, 1. )
  const lm = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/.exec(raw);
  if (lm) {
    return (
      esc(lm[1]!) +
      span(COLOR.fence, esc(lm[2]!)) +
      esc(lm[3]!) +
      highlightInline(esc(lm[4]!))
    );
  }

  return highlightInline(esc(raw));
}

/** Turn EchoWiki markdown source into highlighted HTML (color/background only). */
function highlightWikiSource(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inBlock = false;

  for (const raw of lines) {
    if (!inBlock) {
      const mo = BLOCK_OPEN_RE.exec(raw);
      if (mo) {
        inBlock = true;
        out.push(
          span(COLOR.fence, ":::" + mo[2]) + highlightAttrs(esc(mo[3]!)),
        );
        continue;
      }
      out.push(highlightMarkdownLine(raw));
      continue;
    }
    // inside a block
    if (/^:::\s*$/.test(raw)) {
      inBlock = false;
      out.push(span(COLOR.fence, esc(raw)));
      continue;
    }
    out.push(highlightBlockLine(raw));
  }

  // Each source line is wrapped in an inline span tagged with its line index.
  // Inline spans don't change layout (so the highlight layer stays aligned with
  // the textarea), but they give the scroll-lock a measurable per-line anchor.
  return out
    .map((html, i) => `<span class="ew-ln" data-ln="${i}">${html}</span>`)
    .join("\n");
}

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
