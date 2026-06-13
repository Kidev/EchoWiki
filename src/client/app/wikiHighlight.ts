/**
 * Lightweight syntax highlighter for EchoWiki's markdown dialect. It powers
 * three things, all sharing the exact same token colors:
 *
 *  - the live highlight layer painted behind the editor textarea
 *    ({@link highlightWikiSource}, via `WikiSourceEditor`),
 *  - the read-only "Source" review panes (`WikiSourceHighlight`),
 *  - and ```echo fenced code blocks in the rendered preview
 *    ({@link highlightEchoCode}).
 *
 * Because the editor highlight layer must line up character-for-character with a
 * real <textarea> (so the caret and selection land on the right glyphs), the
 * highlighter only ever changes **color** and **background**, never the font
 * weight, style, or size. Those would alter glyph metrics and drift the overlay
 * out of alignment with the textarea underneath.
 */

import { isAllowedImageHost } from "../../shared/imageHosts";

const COLOR = {
  fence: "#a855f7", // ::: block fences, --- phase separators, list markers
  attrKey: "#3b9eff", // key in key=value params
  attrVal: "#22c55e", // value in key=value params
  echo: "var(--link-color, #0079d3)", // echo:// asset links
  alias: "#eab308", // ~name in echo://~alias references
  prefix: "#ef8e4b", // bg:/fg:/layer: prefixes, move-line percentages
  heading: "#e0567a", // # headings
  emphasis: "#d98b3c", // **bold** / *italic*
  code: "#16a34a", // `inline code`
  link: "var(--link-color, #0079d3)", // [link](url) text
  muted: "var(--text-muted)", // blockquotes, punctuation
  invalid: "#ef4444", // remote image src that can't be proxied (won't load)
} as const;

// An `![alt](url)` whose src is a remote http(s) URL can only render if it goes
// through the server image proxy, which is limited to the hosts declared in
// devvit.json (see `isAllowedImageHost`). Detect a src that won't load so the
// editor can flag it: any other src (echo://, data:, relative, reddit links) is
// fine. `escUrl` is HTML-escaped source, so undo the entity escaping to parse.
function isUnproxyableRemoteImage(escUrl: string): boolean {
  const url = escUrl
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return !isAllowedImageHost(new URL(url).hostname);
  } catch {
    return true; // malformed http(s) url won't load either
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(color: string, text: string, extra = ""): string {
  return `<span style="color:${color};${extra}">${text}</span>`;
}

// Matches an `echo://` URL. A run of "normal" chars (anything but whitespace,
// the markdown/quote terminators, or a closing paren) plus, crucially, balanced
// `(...)` groups so filenames like `ashley_(content).png` aren't truncated at
// the first `)`. The chars consumed here are already HTML-escaped, so `&` shows
// up as `&amp;` and is matched as part of the normal run.
const ECHO_URL_RE = /echo:\/\/(?:[^\s()"'\]]|\([^\s()"'\]]*\))+/g;

/**
 * Highlight a single (HTML-escaped) `echo://` URL: the base link in the echo
 * color, an `~alias` reference in the alias color, and any `?key&key=value`
 * query params like a `:::` block's `key=value` attributes (key blue, value
 * green). The query separators (`?`, escaped `&`, `=`) are muted.
 */
function highlightEchoUrl(escUrl: string): string {
  const qIdx = escUrl.indexOf("?");
  const base = qIdx === -1 ? escUrl : escUrl.slice(0, qIdx);

  // `echo://~name` reference: tint the `~name` so aliases stand out from paths.
  const aliasM = /^(echo:\/\/)(~[A-Za-z0-9_-]+)(.*)$/.exec(base);
  const baseHtml = aliasM
    ? span(COLOR.echo, aliasM[1]!) +
      span(COLOR.alias, aliasM[2]!) +
      (aliasM[3] ? span(COLOR.echo, aliasM[3]) : "")
    : span(COLOR.echo, base);

  if (qIdx === -1) return baseHtml;

  // Query string: params are `&`-separated (escaped to `&amp;` here), each
  // either a bare flag (`emoji`) or `key=value`.
  const amp = span(COLOR.muted, "&amp;");
  const query = escUrl
    .slice(qIdx + 1)
    .split("&amp;")
    .map((seg) => {
      if (seg === "") return "";
      const eq = seg.indexOf("=");
      if (eq === -1) return span(COLOR.attrKey, seg);
      return (
        span(COLOR.attrKey, seg.slice(0, eq)) +
        span(COLOR.muted, "=") +
        span(COLOR.attrVal, seg.slice(eq + 1))
      );
    })
    .join(amp);

  return baseHtml + span(COLOR.muted, "?") + query;
}

// Private-use sentinels delimiting a held slot. They never occur in wiki source,
// so restoring them can't accidentally clobber real text (a bare " 5" would).
const SLOT_OPEN = "";
const SLOT_CLOSE = "";
const SLOT_RE = /(\d+)/g;

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
  // echo:// asset links (alias + query params colored by highlightEchoUrl)
  s = s.replace(ECHO_URL_RE, (m) => hold(highlightEchoUrl(m)));
  // ![alt](url) images. Run before the generic link rule so the `!` isn't
  // stranded. A remote http(s) src whose host isn't in the proxy allowlist
  // can't load (see isUnproxyableRemoteImage); flag the whole image in red with
  // a wavy underline so the author sees it won't work. echo:// srcs are already
  // held above, so `u` is a placeholder for them and reads as valid.
  s = s.replace(
    /!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g,
    (_m, t: string, u: string) => {
      if (isUnproxyableRemoteImage(u)) {
        return hold(
          span(
            COLOR.invalid,
            "![" + t + "](" + u + ")",
            "text-decoration:underline wavy;",
          ),
        );
      }
      return hold(
        span(COLOR.muted, "![") +
          span(COLOR.link, t) +
          span(COLOR.muted, "](" + u + ")"),
      );
    },
  );
  // [text](url): the url destination allows balanced `(...)` (e.g. a held echo
  // link whose filename contained parens), so it isn't truncated at the first `)`
  s = s.replace(
    /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g,
    (_m, t: string, u: string) =>
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
  let s = escaped.replace(ECHO_URL_RE, (m) => hold(highlightEchoUrl(m)));
  s = highlightAttrs(s);
  return restore(s);
}

const BLOCK_OPEN_RE = /^(:::)(def|fbf|scene|anim|card|infobox)\b(.*)$/;

// GitHub-style alert callouts: `> [!NOTE]` and the `>` quote lines that follow
// it form one block. Each type tints in its own semantic color (matching the
// rendered preview's alert colors), so the whole callout reads as a unit instead
// of the body lines falling back to the generic muted blockquote color.
const ALERT_COLOR: Record<string, string> = {
  NOTE: "var(--link-color, #0079d3)",
  TIP: "#22c55e",
  IMPORTANT: "#a855f7",
  WARNING: "#eab308",
  CAUTION: "#ef4444",
};
// Header line. Only the five known types start a callout (a plain `> [!foo]`
// stays an ordinary quote), mirroring the renderer's `preprocessAlerts`.
const ALERT_HEAD_RE =
  /^(\s*>\s*)(\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])(.*)$/;
// A blockquote line; while a callout is open, each such line continues it.
const QUOTE_RE = /^(\s*>\s?)(.*)$/;

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
  // `>>> ... <<<` center markers. A line may open with `>>>`, close with `<<<`,
  // or both (wrapping inline content on one line). Handled before the blockquote
  // rule so the leading `>>>` isn't mistaken for a `>` quote and cut short.
  const openM = /^(\s*)>>>/.exec(raw);
  if (openM || /<<<\s*$/.test(raw)) {
    let prefix = "";
    let body = raw;
    if (openM) {
      prefix = esc(openM[1]!) + span(COLOR.fence, ">>>");
      body = raw.slice(openM[0].length);
    }
    let suffix = "";
    const closeM = /<<<(\s*)$/.exec(body);
    if (closeM) {
      suffix = span(COLOR.fence, "<<<") + esc(closeM[1]!);
      body = body.slice(0, body.length - closeM[0].length);
    }
    return prefix + highlightInline(esc(body)) + suffix;
  }

  // # headings
  const hm = /^(\s*)(#{1,6})(\s.*)?$/.exec(raw);
  if (hm) {
    return esc(hm[1]!) + span(COLOR.heading, esc(hm[2]! + (hm[3] ?? "")));
  }

  // > blockquote (alert callouts are handled, with their multi-line grouping,
  // up in highlightSourceLines before this per-line fallback runs).
  const bm = QUOTE_RE.exec(raw);
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

/** Highlight each line of EchoWiki source, returning per-line HTML fragments. */
function highlightSourceLines(src: string): string[] {
  const lines = src.split("\n");
  const out: string[] = [];
  let inBlock = false;
  // Color of the currently-open GitHub alert callout (null when not in one).
  let alertColor: string | null = null;

  for (const raw of lines) {
    if (!inBlock) {
      const mo = BLOCK_OPEN_RE.exec(raw);
      if (mo) {
        alertColor = null;
        inBlock = true;
        out.push(
          span(COLOR.fence, ":::" + mo[2]) + highlightAttrs(esc(mo[3]!)),
        );
        continue;
      }
      // Start of a `> [!TYPE]` alert callout: tint the marker in its type color.
      const ah = ALERT_HEAD_RE.exec(raw);
      if (ah) {
        alertColor = ALERT_COLOR[ah[3]!] ?? COLOR.heading;
        out.push(
          span(alertColor, esc(ah[1]! + ah[2]!)) + highlightInline(esc(ah[4]!)),
        );
        continue;
      }
      // Continuation `>` line of an open callout: tint the quote marker the same
      // color so the whole callout reads as one group. A non-quote line ends it.
      if (alertColor) {
        const qm = QUOTE_RE.exec(raw);
        if (qm) {
          out.push(
            span(alertColor, esc(qm[1]!)) + highlightInline(esc(qm[2]!)),
          );
          continue;
        }
        alertColor = null;
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

  return out;
}

/** Turn EchoWiki markdown source into highlighted HTML (color/background only). */
export function highlightWikiSource(src: string): string {
  // Each source line is wrapped in an inline span tagged with its line index.
  // Inline spans don't change layout (so the highlight layer stays aligned with
  // the textarea), but they give the scroll-lock a measurable per-line anchor.
  return highlightSourceLines(src)
    .map((html, i) => `<span class="ew-ln" data-ln="${i}">${html}</span>`)
    .join("\n");
}

/**
 * Highlight EchoWiki source for a read-only ```echo fenced code block in the
 * rendered preview. Same dialect colors as the editor, but without the per-line
 * `ew-ln` anchor spans (those exist only for the editor's scroll-lock).
 */
export function highlightEchoCode(src: string): string {
  // Drop a single trailing newline the markdown fence leaves on the content so
  // the block doesn't render an extra blank line at the bottom.
  return highlightSourceLines(src.replace(/\n$/, "")).join("\n");
}
