const ALERT_META: Record<string, { color: string; icon: string }> = {
  note: {
    color: "var(--link-color)",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
  },
  tip: {
    color: "#22c55e",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"></path></svg>',
  },
  important: {
    color: "#a855f7",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
  },
  warning: {
    color: "#eab308",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
  },
  caution: {
    color: "#ef4444",
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
  },
};

export function extractEchoPathsFromMarkdown(content: string): string[] {
  const paths: string[] = [];
  const re = /echo:\/\/([^\s)"'>\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) paths.push(m[1]);
  }
  return [...new Set(paths)];
}

export function preprocessAlerts(md: string): string {
  return md.replace(
    /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\S\n]*\n((?:> [^\n]*\n?)*)/gm,
    (_, type: string, body: string) => {
      const t = type.toLowerCase();
      const label = type.charAt(0) + type.slice(1).toLowerCase();
      const meta = ALERT_META[t];
      const color = meta?.color ?? "var(--text-muted)";
      const icon = meta?.icon ?? "";
      const content = body.replace(/^> ?/gm, "");
      return `<div class="wiki-alert" style="border-color: ${color};"><div class="wiki-alert-title" style="color: ${color};">${icon}<span>${label}</span></div>\n\n${content}\n</div>\n`;
    },
  );
}

export function preprocessCenterBlocks(md: string): string {
  return md.replace(/>>>([\s\S]*?)<<</g, (_, content: string) => {
    const inner = (content as string).trim();
    return `<div style="text-align: center; margin: 0;">\n\n${inner}\n\n</div>`;
  });
}

export function withCodeProtected(
  md: string,
  transform: (s: string) => string,
): string {
  const slots: string[] = [];

  const OPEN = "EWCOPEN";
  const CLOSE = "EWCCLOSE";
  const guarded = md.replace(
    /(```+[\s\S]*?```+|~~~+[\s\S]*?~~~+|`[^`\n]+`)/g,
    (match) => {
      const id = `${OPEN}${slots.length}${CLOSE}`;
      slots.push(match);
      return id;
    },
  );
  const out = transform(guarded);
  return out.replace(
    new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"),
    (_, i: string) => slots[parseInt(i, 10)] ?? "",
  );
}

export function extractDisplayHints(echoPath: string): {
  hints: Set<string>;
  cleanPath: string;
} {
  const qIdx = echoPath.indexOf("?");
  if (qIdx === -1) return { hints: new Set(), cleanPath: echoPath };
  const base = echoPath.slice(0, qIdx);
  const hints = new Set<string>();
  const remaining: string[] = [];
  for (const seg of echoPath.slice(qIdx + 1).split("&")) {
    const key = (seg.split("=")[0] ?? "").toLowerCase();
    if (key === "emoji" || key === "outline") hints.add(key);
    else remaining.push(seg);
  }
  const cleanPath =
    remaining.length > 0 ? `${base}?${remaining.join("&")}` : base;
  return { hints, cleanPath };
}

export function convertInlineMd(text: string): string {
  return text
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" style="color:var(--link-color,#0079d3)">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function collectDefs(md: string): Map<string, string> {
  const defs = new Map<string, string>();
  const re = /^:::def[ \t]*\n([\s\S]*?)^:::/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    for (const line of m[1]!.split("\n")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const name = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      if (name && value) defs.set(name, value);
    }
  }
  return defs;
}

export function expandDefs(md: string, defs: Map<string, string>): string {
  if (defs.size === 0) return md;
  return md.replace(/echo:\/\/~([a-zA-Z0-9_-]+)/g, (full, name: string) => {
    const resolved = defs.get(name);
    if (!resolved) return full;
    return resolved.startsWith("echo://") ? resolved : `echo://${resolved}`;
  });
}

export function parseEchoBlockParams(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=("[^"]*"|[^\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const key = m[1]!;
    let val = m[2]!;
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

export type EchoBlockDef = { params: Record<string, string>; body: string };

/**
 * Small stable string hash (djb2/xor), base36-encoded. Used to derive animation
 * `uid`s from a block's content so that the generated `@keyframes` names change
 * whenever (and only when) the block itself changes. In the live editor this
 * forces every animation in an edited block to restart together: keeping the
 * sprite frames and the movement in sync: instead of the browser swapping
 * keyframes under a stable name and leaving the clocks at different offsets.
 */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Parse an fps value, falling back to a safe positive default. Guards against
 * empty / NaN / zero / negative input (e.g. while a value is mid-edit in the
 * live editor) which would otherwise produce a non-finite frame period and, in
 * the multi-phase animator, an infinite keyframe-building loop.
 */
export function parseFps(raw: string | undefined, fallback = 2.5): number {
  const v = parseFloat(raw ?? "");
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Parse a boolean-ish param value. Absent/empty -> fallback; falsy strings -> false. */
export function parseBoolParam(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "") return fallback;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

/**
 * Resolve the effective `width`/`height` for a special block (scene, anim) and
 * the vertical stretch factor `k` they imply.
 *
 * Semantics (per design): the block is composed at the image's natural size,
 * then `width` scales it to that % of the container. `height` is taken relative
 * to `width`: equal (or absent) keeps the image's natural aspect ratio; a
 * larger `height` stretches it taller, a smaller one squishes it. The stretch
 * factor is `heightPct / widthPct`. When only `height` is given, `width`
 * defaults to 100% (so e.g. `height=50%` halves the natural height at full
 * width). `k` is only derived from percentage heights; pixel heights keep their
 * own box sizing and yield `k = 1`.
 */
export function resolveBlockSizing(
  params: Record<string, string>,
  defaultWidth: string,
): { width: string; heightRaw: string | undefined; k: number } {
  const heightRaw = params["height"];
  // "only height given" => treat width as 100% (both for the box and for k).
  let widthParam = params["width"];
  if (widthParam === undefined && heightRaw !== undefined) widthParam = "100%";
  const width = widthParam ?? defaultWidth;

  let k = 1;
  if (heightRaw !== undefined && heightRaw.trim().endsWith("%")) {
    const hPct = parseFloat(heightRaw);
    const wPct = width.trim().endsWith("%") ? parseFloat(width) : 100;
    if (
      Number.isFinite(hPct) &&
      hPct > 0 &&
      Number.isFinite(wPct) &&
      wPct > 0
    ) {
      k = hPct / wPct;
    }
  }
  return { width, heightRaw, k };
}

/**
 * Build the HTML for a background image that fills its (relatively positioned,
 * overflow-hidden) container, optionally stretched vertically by `k`.
 *
 * For `k === 1` the image just sizes the container to its natural aspect ratio.
 * For `k !== 1` an invisible sizer image (widened/narrowed by `k`) drives the
 * container height to `naturalHeight * k`, and the real image fills that box
 * with `object-fit:fill`: stretching it vertically without ever cropping and
 * without needing the image's intrinsic pixel size at render time.
 */
export function buildScaledBg(
  src: string,
  k: number,
  extraImgStyle = "",
): string {
  if (!(k > 0) || Math.abs(k - 1) < 1e-4) {
    return `<img class="echo-raw" src="${src}" style="display:block;width:100%;height:auto;${extraImgStyle}" alt="">`;
  }
  // The (invisible) sizer drives the container height to `naturalHeight * k`: an
  // img at `width:k*100%` (`max-width:none` so it isn't clamped when k>1) with
  // `height:auto` keeps its intrinsic ratio, so its laid-out height is exactly k
  // times the height the bg would have at full width.
  //
  // The visible image is drawn at natural ratio (`width:100%;height:auto`) and
  // stretched to that height with `transform:scaleY(k)` anchored at the top.
  // This avoids `object-fit`/percentage-height (which don't reliably resolve for
  // absolutely-positioned replaced elements against a content-sized box, leaving
  // the image at natural height and clipped). The transformed image exactly
  // fills the sizer-defined box: no crop, scales responsively, and needs no
  // intrinsic dimensions at render time.
  const kStr = k.toFixed(4);
  const sizer = `<img class="echo-raw" src="${src}" style="display:block;width:${(k * 100).toFixed(4)}%;height:auto;max-width:none;visibility:hidden;pointer-events:none;" alt="">`;
  const img = `<img class="echo-raw" src="${src}" style="position:absolute;top:0;left:0;width:100%;height:auto;transform:scaleY(${kStr});transform-origin:top;display:block;${extraImgStyle}" alt="">`;
  return `${sizer}${img}`;
}

/**
 * Resolve the duration (in seconds) of an animation phase. An explicit
 * `duration` always wins. Otherwise the duration is derived from whole walk
 * cycles: `loops × frames / fps`. This keeps the sprite's frame animation
 * perfectly in sync with its movement, so the character always finishes facing
 * the right way.
 *
 * When `loops` is absent: if `deriveWhenUnset` is true the phase plays exactly
 * one cycle (`loops=1`); otherwise `fallbackSeconds` is used (legacy default).
 */
export function resolvePhaseDuration(
  params: Record<string, string>,
  frameCount: number,
  fps: number,
  fallbackSeconds: number,
  deriveWhenUnset: boolean,
): number {
  const durRaw = params["duration"];
  if (durRaw !== undefined && durRaw.trim() !== "") {
    const d = parseFloat(durRaw.replace(/s$/i, "").trim());
    if (Number.isFinite(d) && d > 0) return d;
  }
  const loopsRaw = params["loops"];
  if (frameCount > 0 && (loopsRaw !== undefined || deriveWhenUnset)) {
    const loops = parseFloat(loopsRaw ?? "1");
    const safeLoops = Number.isFinite(loops) && loops > 0 ? loops : 1;
    return (safeLoops * frameCount) / fps;
  }
  return fallbackSeconds;
}

export function buildFrameKeyframes(uid: string, n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const sp = ((i / n) * 100).toFixed(1);
    const ep = (((i + 1) / n) * 100 - 0.1).toFixed(1);
    const ap = (((i + 1) / n) * 100).toFixed(1);
    if (i === 0) {
      return `@keyframes ${uid}-f0{0%,${ep}%{opacity:1}${ap}%,100%{opacity:0}}`;
    }
    const bp = ((i / n) * 100 - 0.1).toFixed(1);
    return `@keyframes ${uid}-f${i}{0%,${bp}%{opacity:0}${sp}%,${ep}%{opacity:1}${ap}%,100%{opacity:0}}`;
  }).join(" ");
}

export function renderFbfBlock(
  uid: string,
  params: Record<string, string>,
  frames: string[],
): string {
  if (frames.length === 0) return "";
  const fps = parseFps(params["fps"]);
  const sizeRaw = params["size"] ?? "";
  const period = (frames.length / fps).toFixed(3);
  const kf = buildFrameKeyframes(uid, frames.length);
  const overlayImgs = frames
    .map(
      (src, i) =>
        `<img class="echo-raw" src="${src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;animation:${uid}-f${i} ${period}s linear infinite;" alt="">`,
    )
    .join("");

  if (sizeRaw && !sizeRaw.includes("%")) {
    const px = parseInt(sizeRaw, 10);
    return `<style>${kf}</style><span style="position:relative;display:inline-block;width:${px}px;height:${px}px;vertical-align:middle;">${overlayImgs}</span>`;
  }

  const sizeDriver = `<img class="echo-raw" src="${frames[0]}" style="display:block;width:auto;height:auto;max-width:100%;visibility:hidden;pointer-events:none;" alt="">`;
  return `<style>${kf}</style><span style="position:relative;display:inline-block;max-width:100%;vertical-align:middle;">${sizeDriver}<span style="position:absolute;inset:0;">${overlayImgs}</span></span>`;
}

export function renderSceneBlock(
  params: Record<string, string>,
  lines: string[],
): string {
  const { width, heightRaw, k } = resolveBlockSizing(params, "100%");
  let bgSrc = "";
  let fgSrc = "";
  const layerImgs: string[] = [];
  for (const line of lines) {
    if (line.startsWith("bg:")) {
      bgSrc = line.slice(3).trim();
    } else if (line.startsWith("fg:")) {
      fgSrc = line.slice(3).trim();
    } else if (line.startsWith("layer:")) {
      const rest = line.slice(6).trim();
      const spIdx = rest.search(/\s/);
      const src = spIdx === -1 ? rest : rest.slice(0, spIdx);
      const posStr = spIdx === -1 ? "" : rest.slice(spIdx + 1);
      const pos = parseEchoBlockParams(posStr);
      let posStyle = "position:absolute;display:block;";
      for (const [pk, pv] of Object.entries(pos)) posStyle += `${pk}:${pv};`;
      layerImgs.push(
        `<img class="echo-raw" src="${src}" style="${posStyle}" alt="">`,
      );
    }
  }
  // `fg` overlays the whole scene; fill (not cover) so it stretches with the
  // box exactly like the background does, never cropping.
  const fgHtml = fgSrc
    ? `<img class="echo-raw" src="${fgSrc}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;display:block;" alt="">`
    : "";
  const overlayHtml = `<div style="position:absolute;inset:0;overflow:hidden;">${layerImgs.join("")}${fgHtml}</div>`;
  // inline-block so a wrapping `>>> <<<` (text-align:center) actually centers it.
  const baseStyle = `position:relative;display:inline-block;width:${width};max-width:100%;border-radius:6px;overflow:hidden;line-height:0;`;

  if (bgSrc) {
    // The background drives the natural aspect ratio (never cropped); `width`
    // scales the whole composite and `height`, when given, stretches it
    // vertically relative to `width` (see resolveBlockSizing).
    const bgImg = buildScaledBg(bgSrc, k);
    return `<div style="${baseStyle}">${bgImg}${overlayHtml}</div>`;
  }

  if (heightRaw?.endsWith("%")) {
    const hPct = parseFloat(heightRaw);
    return `<div style="${baseStyle}aspect-ratio:${(100 / hPct).toFixed(4)} / 1;">${layerImgs.join("")}${fgHtml}</div>`;
  }
  const h = heightRaw ?? "200px";
  return `<div style="${baseStyle}height:${h};">${layerImgs.join("")}${fgHtml}</div>`;
}

export function renderAnimBlock(
  uid: string,
  params: Record<string, string>,
  body: string,
  aliases: Map<string, EchoBlockDef>,
): string {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let frames: string[];
  let fps: number;
  let spriteSizeRaw: string;
  const ref = params["ref"];
  if (ref !== undefined && aliases.has(ref)) {
    const alias = aliases.get(ref)!;
    fps = parseFps(alias.params["fps"]);
    spriteSizeRaw = alias.params["size"] ?? "";
    frames = alias.body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("echo://"));
  } else {
    fps = parseFps(params["fps"]);
    spriteSizeRaw = params["spritesize"] ?? "";
    frames = lines.filter((l) => l.startsWith("echo://"));
  }

  if (frames.length === 0) return "";

  // `duration` wins; otherwise derive from `loops` whole cycles. When neither
  // is set, keep the historical 3s default (deriveWhenUnset=false).
  const durationSecs = resolvePhaseDuration(
    params,
    frames.length,
    fps,
    3,
    false,
  );
  const duration = `${durationSecs.toFixed(3)}s`;
  const { width, heightRaw, k } = resolveBlockSizing(params, "50%");
  const bg = params["bg"] ?? "";
  const bgOpacity = params["bgopacity"] ?? "1";
  const pingpong = params["pingpong"] === "true";
  // "hold" (default): lock the walk to the movement so the steps and the travel
  // share one clock. The cycle is snapped so a whole number of cycles exactly
  // fills the move duration (fps is treated as a target). hold=false keeps the
  // raw fps, letting the frame cycle drift against the movement (old behavior).
  const hold = parseBoolParam(params["hold"], true);
  const rawPeriod = frames.length / fps;
  const cycles = hold ? Math.max(1, Math.round(durationSecs / rawPeriod)) : 0;
  const period = (hold ? durationSecs / cycles : rawPeriod).toFixed(3);
  const animDir = pingpong ? "alternate" : "normal";
  const framekf = buildFrameKeyframes(uid, frames.length);

  const moveLines = lines.filter((l) => /^\d/.test(l));
  const moveKf =
    moveLines.length >= 1
      ? (() => {
          const stops = moveLines
            .map((l) => {
              const hit = /^(\d+(?:\.\d+)?%)\s+(.+)$/.exec(l);
              if (!hit) return null;
              const props = parseEchoBlockParams(hit[2]!);
              const css = Object.entries(props)
                .map(([k, v]) => `${k}:${v}`)
                .join(";");
              return `${hit[1]!}{${css}}`;
            })
            .filter(Boolean)
            .join(" ");
          return `@keyframes ${uid}-move{${stops}}`;
        })()
      : `@keyframes ${uid}-move{0%{left:5%;bottom:5%}100%{left:85%;bottom:5%}}`;
  const moveStyle = `animation:${uid}-move ${duration} linear infinite ${animDir};`;

  const frameImgs = frames
    .map(
      (src, i) =>
        `<img class="echo-raw" src="${src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;animation:${uid}-f${i} ${period}s linear infinite;" alt="">`,
    )
    .join("");

  const spriteNatural = !spriteSizeRaw || spriteSizeRaw.includes("%");
  let spriteDiv: string;
  if (spriteNatural) {
    const sizeDriver = `<img class="echo-raw" src="${frames[0]}" style="display:block;width:auto;height:auto;max-width:100%;visibility:hidden;pointer-events:none;" alt="">`;
    spriteDiv = `<div style="position:absolute;${moveStyle}">${sizeDriver}<div style="position:absolute;inset:0;">${frameImgs}</div></div>`;
  } else {
    const px = parseInt(spriteSizeRaw, 10);
    spriteDiv = `<div style="position:absolute;width:${px}px;height:${px}px;${moveStyle}">${frameImgs}</div>`;
  }

  // inline-block so a wrapping `>>> <<<` (text-align:center) actually centers it.
  const baseStyle = `position:relative;display:inline-block;width:${width};max-width:100%;overflow:hidden;border-radius:6px;line-height:0;`;
  const overlayDiv = `<div style="position:absolute;inset:0;overflow:hidden;">${spriteDiv}</div>`;

  if (bg) {
    // Background drives the natural aspect ratio (never cropped); `width` scales
    // the composite and `height`, when given, stretches it vertically relative
    // to `width` (see resolveBlockSizing). The sprite overlay scales with it.
    const bgImg = buildScaledBg(bg, k, `opacity:${bgOpacity};`);
    return `<style>${framekf} ${moveKf}</style><div style="${baseStyle}">${bgImg}${overlayDiv}</div>`;
  }

  if (heightRaw?.endsWith("%")) {
    const hPct = parseFloat(heightRaw);
    return `<style>${framekf} ${moveKf}</style><div style="${baseStyle}aspect-ratio:${(100 / hPct).toFixed(4)} / 1;">${overlayDiv}</div>`;
  }
  const h = heightRaw ?? "50%";
  const hStyle = h.endsWith("%")
    ? `aspect-ratio:${(100 / parseFloat(h)).toFixed(4)} / 1;`
    : `height:${h};`;
  return `<style>${framekf} ${moveKf}</style><div style="${baseStyle}${hStyle}">${overlayDiv}</div>`;
}

export function renderCardBlock(
  params: Record<string, string>,
  body: string,
): string {
  const image = params["image"] ?? "";
  const size = params["size"] ?? "120px";
  const align = params["align"] ?? "right";
  const floatStyle =
    align === "left"
      ? "float:left;margin:0 1.5em 1em 0;"
      : "float:right;margin:0 0 1em 1.5em;";
  const imgHtml = image
    ? `<img src="${image}" style="${floatStyle}width:${size};border-radius:6px;" alt="">`
    : "";
  return `<div style="overflow:hidden;padding:1em;background:var(--thumb-bg);border-radius:8px;margin:1em 0;">${imgHtml}\n\n${body.trim()}\n\n</div>`;
}

export function renderInfoboxBlock(
  params: Record<string, string>,
  body: string,
): string {
  const title = params["title"] ?? "";
  const image = params["image"] ?? "";
  const align = (params["align"] ?? "right") === "left" ? "left" : "right";
  const floatMargin =
    align === "left" ? "margin:0 1.5em 1em 0;" : "margin:0 0 1em 1.5em;";

  const rows = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("|"));

  const tableRows = rows
    .map((row) => {
      const pipeIdx = row.indexOf("|");
      const key = row.slice(0, pipeIdx).trim();
      const value = convertInlineMd(row.slice(pipeIdx + 1).trim());
      return `<tr style="border-top:1px solid var(--text-muted,#ccc);"><th style="padding:4px 10px;font-weight:600;text-align:left;white-space:nowrap;vertical-align:top;background:var(--control-bg,#f8f9fa);font-size:0.85em;">${key}</th><td style="padding:4px 10px;vertical-align:top;font-size:0.85em;">${value}</td></tr>`;
    })
    .join("");

  const headerHtml = title
    ? `<div style="padding:8px 12px;font-weight:bold;text-align:center;background:var(--accent,#0079d3);color:#fff;font-size:0.95em;">${title}</div>`
    : "";
  const imgHtml = image
    ? `<div style="text-align:center;padding:8px 12px;background:var(--control-bg,#f8f9fa);border-bottom:1px solid var(--text-muted,#ccc);"><img src="${image}" alt="${title}" style="max-width:100%;border-radius:4px;"></div>`
    : "";

  return `<div style="float:${align};${floatMargin}min-width:180px;max-width:260px;border:1px solid var(--text-muted,#ccc);border-radius:6px;overflow:hidden;clear:${align};margin-bottom:1em;">${headerHtml}${imgHtml}<table style="width:100%;border-collapse:collapse;">${tableRows}</table></div>`;
}

export function renderMultiPhaseAnimBlock(
  uid: string,
  params: Record<string, string>,
  body: string,
  aliases: Map<string, EchoBlockDef>,
): string {
  type Phase = {
    params: Record<string, string>;
    frames: string[];
    moveLines: string[];
    duration: number;
  };

  const phases: Phase[] = [];
  let curPhaseParams: Record<string, string> | null = null;
  let curFrames: string[] = [];
  let curMove: string[] = [];

  const flushPhase = () => {
    if (!curPhaseParams) return;
    const fps = parseFps(curPhaseParams["fps"]);
    // Default to one walk cycle when no duration/loops given (deriveWhenUnset),
    // keeping the sprite animation in sync with the movement.
    const d = resolvePhaseDuration(
      curPhaseParams,
      curFrames.length,
      fps,
      2,
      true,
    );
    phases.push({
      params: curPhaseParams,
      frames: curFrames,
      moveLines: curMove,
      duration: d,
    });
  };

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("---")) {
      flushPhase();
      curPhaseParams = parseEchoBlockParams(line.slice(3).trim());
      curFrames = [];
      curMove = [];
    } else if (curPhaseParams !== null) {
      if (line.startsWith("echo://")) curFrames.push(line);
      else if (/^\d/.test(line)) curMove.push(line);
    }
  }
  flushPhase();

  if (phases.length < 2) return renderAnimBlock(uid, params, body, aliases);

  const totalDuration = phases.reduce((s, p) => s + p.duration, 0);
  const { width, heightRaw: height, k } = resolveBlockSizing(params, "50%");
  const bg = params["bg"] ?? "";
  const bgOpacity = params["bgopacity"] ?? "1";

  const starts: number[] = [];
  let tOffset = 0;
  for (const phase of phases) {
    starts.push(tOffset);
    tOffset += phase.duration;
  }

  let cssOut = "";
  const frameEls: string[] = [];

  for (let pi = 0; pi < phases.length; pi++) {
    const phase = phases[pi]!;
    const S = starts[pi]!;
    const D = phase.duration;
    const N = phase.frames.length;
    if (N === 0) continue;
    const rawFps = parseFps(phase.params["fps"]);
    const rawPeriod = N / rawFps;

    // "hold" (default): lock the walk to the movement by snapping the cycle so a
    // whole number of cycles exactly fills the phase. The sprite then steps in
    // sync with its travel and completes a stride exactly as the move finishes,
    // so it never switches direction mid-stride. `hold=false` keeps the raw fps
    // and lets the cycle drift / clamp at the phase boundary (old behavior).
    const hold = parseBoolParam(phase.params["hold"] ?? params["hold"], true);
    const cycles = hold ? Math.max(1, Math.round(D / rawPeriod)) : 0;
    const period = hold ? D / cycles : rawPeriod;

    for (let fi = 0; fi < N; fi++) {
      const src = phase.frames[fi]!;
      const animName = `${uid}-p${pi}-f${fi}`;

      const kfStops: string[] = ["0%{opacity:0}"];
      let endsVisible = false;
      for (let k = 0; k < 10000; k++) {
        const ws = S + k * period + (fi / N) * period;
        const we = S + k * period + ((fi + 1) / N) * period;
        if (ws >= S + D - 1e-6) break;
        const sp = (Math.max(ws, S) / totalDuration) * 100;
        const ep = (Math.min(we, S + D) / totalDuration) * 100;
        if (sp > 0.01) kfStops.push(`${(sp - 0.01).toFixed(2)}%{opacity:0}`);
        kfStops.push(`${sp.toFixed(2)}%{opacity:1}`);
        kfStops.push(`${ep.toFixed(2)}%{opacity:1}`);
        if (ep < 99.99) {
          kfStops.push(`${(ep + 0.01).toFixed(2)}%{opacity:0}`);
          endsVisible = false;
        } else {
          endsVisible = true;
        }
      }
      // Always anchor an explicit 100% keyframe. Without one the browser
      // synthesizes 100% from the element's underlying opacity (1), which made
      // inactive frames ramp back up to fully visible over the tail of the loop
      // so a previous phase's sprite reappeared underneath the current one.
      // The single frame still on screen at the loop boundary stays visible (1);
      // every other frame is pinned hidden (0). Pinning to 0 (not the blackout
      // the previous fix avoided) is correct here because the boundary frame is
      // the one that hands off to frame 0 at the wrap.
      kfStops.push(endsVisible ? "100%{opacity:1}" : "100%{opacity:0}");
      cssOut += `@keyframes ${animName}{${kfStops.join("")}}`;
      frameEls.push(
        `<img class="echo-raw" src="${src}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;animation:${animName} ${totalDuration.toFixed(3)}s linear infinite;" alt="">`,
      );
    }
  }

  const moveKfStops: string[] = [];
  for (let pi = 0; pi < phases.length; pi++) {
    const phase = phases[pi]!;
    const S = starts[pi]!;
    const D = phase.duration;
    for (const moveLine of phase.moveLines) {
      const hit = /^(\d+(?:\.\d+)?%)\s+(.+)$/.exec(moveLine);
      if (!hit) continue;
      const localFrac = parseFloat(hit[1]!.slice(0, -1)) / 100;
      const globalPct = ((S + localFrac * D) / totalDuration) * 100;
      const css = Object.entries(parseEchoBlockParams(hit[2]!))
        .map(([k, v]) => `${k}:${v}`)
        .join(";");
      moveKfStops.push(`${globalPct.toFixed(2)}%{${css}}`);
    }
  }
  cssOut += `@keyframes ${uid}-move{${moveKfStops.join("")}}`;

  const pSizeRaw =
    phases[0]!.params["spritesize"] ?? params["spritesize"] ?? "";
  const spriteNatural = !pSizeRaw || pSizeRaw.includes("%");
  let spriteDiv: string;
  if (spriteNatural) {
    const firstSrc = phases[0]?.frames[0] ?? "";
    const sizeDriver = firstSrc
      ? `<img class="echo-raw" src="${firstSrc}" style="display:block;width:auto;height:auto;max-width:100%;visibility:hidden;pointer-events:none;" alt="">`
      : "";
    spriteDiv = `<div style="position:absolute;animation:${uid}-move ${totalDuration.toFixed(3)}s linear infinite;">${sizeDriver}<div style="position:absolute;inset:0;">${frameEls.join("")}</div></div>`;
  } else {
    const pSize = parseInt(pSizeRaw, 10);
    spriteDiv = `<div style="position:absolute;width:${pSize}px;height:${pSize}px;animation:${uid}-move ${totalDuration.toFixed(3)}s linear infinite;">${frameEls.join("")}</div>`;
  }

  // inline-block so a wrapping `>>> <<<` (text-align:center) actually centers it.
  const baseStyle = `position:relative;display:inline-block;width:${width};max-width:100%;overflow:hidden;border-radius:6px;line-height:0;`;
  const overlayDiv = `<div style="position:absolute;inset:0;overflow:hidden;">${spriteDiv}</div>`;

  if (bg) {
    // Background drives the natural aspect ratio (never cropped); `width` scales
    // the composite and `height`, when given, stretches it vertically relative
    // to `width` (see resolveBlockSizing). The sprite overlay scales with it.
    const bgImg = buildScaledBg(bg, k, `opacity:${bgOpacity};`);
    return `<style>${cssOut}</style><div style="${baseStyle}">${bgImg}${overlayDiv}</div>`;
  }

  if (height?.endsWith("%")) {
    const hPct = parseFloat(height);
    return `<style>${cssOut}</style><div style="${baseStyle}aspect-ratio:${(100 / hPct).toFixed(4)} / 1;">${overlayDiv}</div>`;
  }
  const h = height ?? "50%";
  const hStyle = h.endsWith("%")
    ? `aspect-ratio:${(100 / parseFloat(h)).toFixed(4)} / 1;`
    : `height:${h};`;
  return `<style>${cssOut}</style><div style="${baseStyle}${hStyle}">${overlayDiv}</div>`;
}

export function preprocessEchoBlocks(md: string): string {
  const defs = collectDefs(md);
  const expanded = expandDefs(md, defs);

  const stripped = expanded.replace(/^:::def[ \t]*\n[\s\S]*?^:::/gm, "");

  const BLOCK_RE = () =>
    /^:::(fbf|scene|anim|card|infobox)([ \t][^\n]*)?\n([\s\S]*?)^:::/gm;

  const aliases = new Map<string, EchoBlockDef>();
  const re1 = BLOCK_RE();
  let m: RegExpExecArray | null;
  while ((m = re1.exec(stripped)) !== null) {
    const paramStr = (m[2] ?? "").trim();
    const body = m[3]!;
    const params = parseEchoBlockParams(paramStr);
    const alias = params["alias"];
    if (alias) aliases.set(alias, { params, body });
  }

  let counter = 0;
  return stripped.replace(
    BLOCK_RE(),
    (match, type: string, paramStr: string | undefined, body: string) => {
      counter++;
      // uid is derived from the block's content (not just its position) so that
      // editing a block in the live editor changes all its keyframe names at
      // once, forcing a synchronized restart of its frame + movement animations.
      // The counter is kept only as a tie-breaker against hash collisions.
      const uid = `ew${counter}h${hashString(`${type}|${paramStr ?? ""}|${body}`)}`;
      const params = parseEchoBlockParams((paramStr ?? "").trim());
      const lines = (body as string)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (type === "fbf") return renderFbfBlock(uid, params, lines);
      if (type === "scene") return renderSceneBlock(params, lines);
      if (type === "anim") {
        const hasPhases = (body as string)
          .split("\n")
          .some((l) => l.trim().startsWith("---"));
        return hasPhases
          ? renderMultiPhaseAnimBlock(uid, params, body as string, aliases)
          : renderAnimBlock(uid, params, body as string, aliases);
      }
      if (type === "card") return renderCardBlock(params, body as string);
      if (type === "infobox") return renderInfoboxBlock(params, body as string);
      return match;
    },
  );
}
