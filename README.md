![EchoWiki](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/assets/echo-wiki.svg)

[Watch all the features in the demo video](https://youtu.be/OOgn59yKN_I "EchoWiki features demo video")

EchoWiki turns a subreddit wiki into a proper editing and reading environment. Moderators write and update pages inside the app with a live Markdown preview. Readers get richer formatting than Reddit's native wiki. Contributors can propose changes that moderators review before merging, and optionally the community votes on whether to accept each suggestion. For game communities specifically, the app resolves special `echo://` links to in-game assets that each reader loads from their own copy of the game. No files are uploaded anywhere, so the original work's copyright is respected.

## Contents

- [Wiki](#wiki)
  - [Live Editor](#live-editor)
  - [Section Links](#section-links)
- [Collaborative Editing](#collaborative-editing)
  - [Suggestions](#suggestions)
  - [Voting](#voting)
  - [Moderator Review](#moderator-review)
  - [Flair Rewards](#flair-rewards)
- [Echo Links](#echo-links)
  - [Asset Editions](#asset-editions)
  - [3D Models](#3d-models)
  - [Composition Blocks](#composition-blocks)
- [Asset Import](#asset-import)
  - [Supported Engines](#supported-engines)
- [Asset Browser](#asset-browser)
- [Moderator Permissions](#moderator-permissions)
- [Moderator Settings](#moderator-settings)
  - [General](#general)
  - [Game](#game)
  - [Style](#style)
  - [Theme](#theme)
  - [Mapping](#mapping)
  - [Collaborative](#collaborative)
  - [Voting](#voting-1)
- [A Note to Game Developers](#a-note-to-game-developers)
- [Privacy](#privacy)

## Wiki

EchoWiki is a renderer on top of your subreddit's **own** native Reddit wiki, not a separate store. Every page is fetched live from the subreddit wiki (`reddit.com/r/<subreddit>/wiki`) via the Reddit API and rendered inside the app with a full Markdown engine. Saving a page from the app writes straight back to that same wiki, so the two stay in sync.

Because the data lives in the real wiki, you keep everything Reddit already gives you for it: the **full revision history** of every page (with author and reason for each edit) is visible at `reddit.com/r/<subreddit>/wiki/revisions`, and **new pages are created the normal Reddit way**: visit the page's wiki URL on Reddit and create it (or link to it from an existing EchoWiki page), and it shows up in the app. EchoWiki never hides or replaces the underlying wiki; it just gives it a richer reading and editing surface.

Easy and powerful custom formatting based on Markdown:

- [Tables, code blocks, lists, blockquotes, horizontal rules...](https://github.github.com/gfm)
- GitHub-style alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) with colored borders and icons
- Echo links resolved as inline images, audio players, and interactive 3D models
- [Composition blocks](#composition-blocks): cards, stat-table infoboxes, layered scenes, and frame-by-frame or moving-sprite animations built from game assets
- Anchor links scrolling to the target heading within the page
- External links opening in the browser
- Raw HTML for custom layouts (floating infoboxes, multi-column grids, inline styles...)

Navigation uses a breadcrumb bar that slides down from the top when hovering the Wiki tab. Each segment in the breadcrumb has a dropdown showing sibling pages at that level.

**For more details, [watch the demo video](https://youtu.be/OOgn59yKN_I "EchoWiki features demo video")**

### Easy integration

![integration](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/modmenu.png)

Create and set up the wiki for your subreddit from the moderator menu: it creates the wiki post, can remove previous ones, adds a sidebar widget linking to it, and sets the basic configuration (title, subtitle, game name) in one form.

### Live Editor

![editor](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/editor.png)

Moderators can edit wiki pages directly inside the app. An edit button appears in the top-right corner of the wiki view when in expanded mode. Clicking it opens the editor, where the Markdown source sits next to a live preview that updates as you type.

An **Insert** toolbar above the editor builds the trickier syntax for you: dialogs for inserting an image (with an asset picker and an inline emoji-size mode), an interactive 3D model, an infobox, a layered scene, a frame-by-frame or moving animation, and `:::def` path aliases, plus quick buttons for centered text, bold, italic, inline code, and a table template.

Saving requires a short description of the change (at least 10 characters). When collaborative mode and voting are both enabled, the save dialog shows a "Bypass public vote" checkbox, unchecked by default: leaving it unchecked sends the edit through the suggestion and voting flow, while checking it writes straight to the wiki without a vote post.

When saving directly, the reason is prefixed with the moderator's username and stored in the Reddit wiki revision history. Navigating away while editing prompts for confirmation before discarding changes.

### Section Links

Every heading has a copy-link button that appears on hover. Clicking it copies an `echolink://` URL pointing to that specific section. These links can be shared with other users of the same subreddit's EchoWiki. To open one, use the link icon in the top bar to open the EchoLink dialog, then paste the URL. The dialog also accepts `echo://` asset paths to jump directly to a file in the asset browser.

## Collaborative Editing

When collaborative mode is enabled, users who meet the subreddit's eligibility thresholds (karma and account age, both configurable) can suggest changes to any wiki page. Each user can have one active suggestion at a time.

### Suggestions

![Suggestions](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/suggestions.png)

Suggesting a change opens the same editor as the moderator editor, with three ways to preview your work:

- **Normal**: live rendered Markdown of the suggested content
- **Source**: the raw Markdown of the suggestion
- **Diff**: a side-by-side comparison of the current page and the suggestion, with changed text highlighted character by character (removed in red, added in green) and unchanged stretches collapsed

Submitting requires a description of what changed (at least 10 characters). The suggestion is then queued for moderator review or community voting, depending on configuration.

A user can update their pending suggestion from the Submissions tab. Each update resets any votes already cast on the suggestion. The maximum number of updates and the minimum time between updates are both configurable in moderator settings.

### Voting

![Vote](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/vote.png)

When voting is enabled, submitting a suggestion creates a separate Reddit post where community members cast votes. The voting post embeds the same side-by-side comparison as the editor (Normal / Source / Diff modes) so voters can review exactly what is changing, then vote **✓ FOR** or **✗ AGAINST**; clicking the chosen side again retracts the vote. Running tallies, the thresholds, and the time remaining are shown along the top.

A suggestion is finalized automatically when any of the following conditions are met:

- The accept vote count reaches the configured threshold
- The reject vote count reaches the configured threshold
- The voting deadline passes and the percentage of accept votes meets the configured time-based threshold

A minimum number of voters can be required before the time-based threshold applies. The suggestion author cannot vote on their own suggestion. Voter eligibility (karma and account age) is configurable separately from contributor eligibility.

The voting post includes a pinned bot comment that records vote events: when the vote opened, when the suggestion was updated, and when the vote concluded with the outcome and reason. The comment is updated as events occur, and the post is locked once the vote concludes.

### Moderator Review

![Suggestions moderator](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/suggestions-mod.png)

Moderators with "wiki" or "config" permissions see a Submissions tab listing all pending suggestions, each with the contributor, target page, description, and vote status if voting is enabled. Clicking Review opens a full-screen modal comparing the current page (left) and the suggestion (right), with the same Normal / Source / Diff modes as the editor; either column can be collapsed by clicking its label.

Moderators can Accept or Deny from the review modal, or Deny a suggestion straight from the list, at any time and regardless of the vote result. When a voting post exists, a link to it is shown. Accepting writes the suggested content to the Reddit wiki with the contributor's username in the revision reason.

Contributors also see the Submissions tab, where they can edit their own pending suggestion's content and description. A suggestion can be withdrawn entirely from the suggest dialog (which offers to delete the current one when you start another).

### Flair Rewards

Moderators can configure two flair templates in the Collaborative settings: one for contributors and one for advanced contributors (awarded after a configurable number of accepted suggestions). When a suggestion is accepted, the contributor earns the appropriate flair based on their acceptance count.

Flairs are not assigned automatically. Users choose when to equip them using a dropdown in the top bar, to the left of the EchoLink button. The dropdown lists all earned flairs with their styled previews. Users can switch between earned flairs at any time or remove their flair.

## Echo Links

Echo links are standard Markdown image or link syntax using the `echo://` scheme:

```markdown
![Character portrait](echo://img/characters/hero.png)
![Battle theme](echo://audio/bgm/battle.ogg)
![King statue](echo://meshes/king.glb)
```

Images render inline, audio files become a native player, and 3D models open an interactive WebGL viewer. Users who have imported their copy of the game see assets resolved inline. Everyone else, including those reading the raw wiki on Reddit, sees only the alt text. Nothing is uploaded to any server.

### Asset Editions

![Asset edit](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/asset-edit.png)

Echo links support edition parameters that transform how assets are displayed, using URL query-parameter syntax appended to the path. Editions are applied client-side in real-time.

| Edition    | Syntax                    | Description                                             |
| ---------- | ------------------------- | ------------------------------------------------------- |
| **Crop**   | `?crop`                   | Trims transparent pixels from all edges of the image    |
| **Sprite** | `?sprite=cols,rows,index` | Extracts a single cell from a sprite sheet grid         |
| **Speed**  | `?speed=value`            | Sets audio playback speed (0.25 to 4.0, default 1.0)    |
| **Pitch**  | `?pitch=value`            | Shifts audio pitch in semitones (-12 to +12, default 0) |

Editions combine with `&`:

```markdown
![Hero walking](echo://img/characters/actor1.png?crop&sprite=12,8,3)
![Battle theme fast](echo://audio/bgm/battle.ogg?speed=2.0&pitch=-3)
```

The asset preview lightbox includes interactive controls for applying editions. The generated echo link (copied via the copy button) includes the active edition suffixes.

![Audio](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/audio.png)

![Sprites](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/sprites.png)

### 3D Models

![Models](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/models.gif)

Interactive 3D models are a first-class echo asset, embedded with the same Markdown image syntax as a picture:

```markdown
![King statue](echo://meshes/king.glb)
```

The model loads in an inline WebGL viewer (powered by three.js): drag to orbit, scroll to zoom, and use the corner buttons to auto-rotate or reset the view. Display hints can be appended to the path like editions and combined with `&`:

| Hint            | Syntax                     | Description                                                 |
| --------------- | -------------------------- | ----------------------------------------------------------- |
| **Auto-rotate** | `?autorotate`              | Start the model slowly spinning (alias `?spin`)             |
| **Height**      | `?height=400px`            | Viewer height (alias `?h`)                                  |
| **Width**       | `?width=80%`               | Viewer width (alias `?w`)                                   |
| **Background**  | `?bg=111`                  | Background color, hex (the `#` is added for you)            |
| **Texture**     | `?texture=img/diffuse.png` | Use an imported image as the model's texture (alias `?tex`) |

```markdown
![King statue](echo://meshes/king.glb?spin&height=420px&bg=151515)
```

Supported formats are `glb`, `gltf`, `obj`, `stl`, `ply`, `fbx`, `dae` (Collada), and `3mf`. GLB is recommended because it packs geometry and textures into a single self-contained file; formats that rely on sibling `.mtl` or texture files render geometry only. When a model loads untextured, the `?texture=` hint, or the **Texture** field in the asset browser's model preview, applies any imported image as its texture. That field also accepts a Markdown link pasted straight from another asset's copy button (e.g. `![diffuse](echo://img/diffuse.png)`), stripping it down to the `echo://` path automatically, so a texture can be grabbed from the browser and dropped onto a model without hand-editing the path.

Models appear in the asset browser under their own **Models** category, which surfaces only when the game ships 3D assets; those carrying an attached texture are flagged with a small badge. Like every other asset, they resolve from each reader's own copy of the game and are never uploaded.

The viewer and its format loaders are lazy-loaded: the three.js runtime is only fetched the first time a reader opens a model, so pages without 3D content carry no extra weight.

### Composition Blocks

Wiki pages support a set of fenced block directives for building richer layouts and animations without writing raw HTML. Each block opens with `:::type [params]` and closes with `:::`. Parameter values containing spaces must be quoted: `key="some value"`.

**`:::card`** floats an image beside free-form Markdown content (headings, tables, prose). `image=` is the echo path, `size=` sets the image width (default `120px`), and `align=` floats it `right` (default) or `left`.

```
:::card image=echo://img/faces/hero.png size=96px align=right
## Hero

A short character blurb beside the portrait.

| Attribute | Value |
|---|---|
| Role | Protagonist |
:::
```

**`:::infobox`** renders a classic stat-table infobox: an optional title header and image on top of a list of `Label | value` rows, floated to one side of the page. Values support inline Markdown links and `<br>` for multi-line cells.

![Infobox](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/card.png)

```
:::infobox title="Character Name" image=echo://img/faces/hero.png align=right
Class | Hero
HP | 9999
Weapon | Echo Blade
:::
```

**`:::scene`** stacks images at absolute positions inside a fixed-size container. `bg:` is the background layer, `layer:` places a sprite at custom CSS coordinates (append `bottom=`, `left=`, `height=`, etc.), and `fg:` is a foreground overlay with `pointer-events: none`.

![Scene](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/scene.png)

**`:::fbf`** (frame by frame) cycles through sprite frames using CSS opacity animation. List one `echo://` path per line. Use `fps` to set playback speed, `size` for the box pixel dimensions, and `alias=name` to name the block for use in `:::anim`.

![Scene](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/animations.gif)

**`:::anim`** moves a sprite across a background scene. Reference an `:::fbf` block via `ref=alias`, or supply frames inline. Define the movement path as one or more keyframe lines (`N% key=value ...`).

![Scene](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/animate.gif)

| Param              | Default | Description                                                                                                                                                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`              |         | Alias of an `:::fbf` block to use as the sprite                                                                                                                                                                           |
| `fps`              | `2.5`   | Frames per second. Treated as a target: see `hold`. Ignored when `ref` is set                                                                                                                                             |
| `spritesize`       | natural | Sprite size: a pixel value (e.g. `48`) fixes the size; omit it (or use a `%`) to render the sprite at its natural size. Ignored when `ref` is set                                                                         |
| `loops`            | `1`     | Number of whole walk cycles per movement; movement time is derived as `loops × frames ÷ fps`. Ignored when `duration` is set                                                                                              |
| `duration`         | `3s`    | Explicit time for one full movement. Overrides `loops`                                                                                                                                                                    |
| `hold`             | `true`  | Locks the walk to the movement: the cycle is snapped so a whole number of cycles exactly fills the movement, so the sprite never switches direction mid-stride. `hold=false` keeps the raw `fps` and lets the cycle drift |
| `pingpong`         | `false` | `true` reverses direction at the end of each cycle instead of jumping back to start (sprite does not flip)                                                                                                                |
| `width` / `height` | `50%`   | Scene container size (use `%` height with a background)                                                                                                                                                                   |
| `bg` / `bgopacity` |         | Background image path and opacity (`0`-`1`)                                                                                                                                                                               |

```
:::fbf alias=hero fps=11 size=48
echo://img/characters/actor.png?sprite=12,8,0
echo://img/characters/actor.png?sprite=12,8,1
echo://img/characters/actor.png?sprite=12,8,2
echo://img/characters/actor.png?sprite=12,8,1
:::

:::anim ref=hero loops=3 width=60% height=120px pingpong=true bg=echo://img/parallaxes/bg.png bgopacity=0.6
0% left=8px bottom=24px
100% left="calc(100% - 56px)" bottom=24px
:::
```

**Multi-phase animations** swap the sprite mid-loop: add `---` separators inside `:::anim`, each with its own frames and movement keyframes (and optional `fps`, `spritesize`, `loops`, `duration`, `hold`). They composite into one seamless loop: e.g. a right-facing walk left-to-right, then a left-facing walk back: so the character always faces the way it is walking.

![Scene](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/animate-blocs.gif)

```
:::anim width=75% height=50% bg=echo://img/parallaxes/bg.png?crop bgopacity=1
--- fps=6 spritesize=100% loops=3
echo://img/characters/actor.png?sprite=12,8,24
echo://img/characters/actor.png?sprite=12,8,25
echo://img/characters/actor.png?sprite=12,8,26
echo://img/characters/actor.png?sprite=12,8,25
0% left=10% bottom=5%
100% left=60% bottom=5%
--- fps=6 spritesize=100% loops=3
echo://img/characters/actor.png?sprite=12,8,12
echo://img/characters/actor.png?sprite=12,8,13
echo://img/characters/actor.png?sprite=12,8,14
echo://img/characters/actor.png?sprite=12,8,13
0% left=60% bottom=5%
100% left=10% bottom=5%
:::
```

**`:::def`** defines reusable aliases for long echo paths. List `name = echo://path` lines inside the block, then reference them anywhere on the page as `echo://~name`.

```
:::def
hero = echo://img/characters/actor1.png
theme = echo://audio/bgm/battle.ogg
:::

![Hero](echo://~hero?crop)
```

Content can also be centered with `>>>content<<<`, which wraps anything between the markers in a centered div.

![Images](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/center-img.png)

Inline echo images accept two display hints appended like editions: `?emoji` shrinks the image to the height of the surrounding text so it reads as an inline icon, and `?outline` draws a dashed accent-colored outline around it. They combine with editions and with each other.

The file [docs/showcase.md](https://github.com/Kidev/EchoWiki/blob/main/docs/showcase.md) in the repository is a full showcase of all these features with live examples.

## Asset Import

If enabled, users select their game folder. The app auto-detects the engine, extracts assets entirely in the browser, and stores them in IndexedDB. Nothing is uploaded.

If no game is configured, EchoWiki runs as a plain wiki: there is no "Import game" prompt, no asset browser, and no echo links. The app works entirely as a collaborative Markdown wiki without any of the asset machinery.

### Supported Engines

Engine detection is automatic. EchoWiki reads the biggest modern general-purpose engines, Unity, Unreal, and Godot, directly from their packaged data.

#### **Unity**

EchoWiki reads Unity's serialized data files (`resources.assets`, `sharedassets*.assets`, `globalgamemanagers`, `levelN`) and asset bundles (`.bundle` / `.unity3d`). It extracts textures as PNGs and, because Unity ships meshes as raw geometry rather than model files, rebuilds each mesh into a self-contained [GLB model](#3d-models) linked to its base-color texture all decoded in the browser. Textures in GPU formats that need heavyweight decoders, and skinned or compressed meshes, are skipped.

#### **Unreal**

A full cooked-asset reader isn't feasible in the browser, since shipping titles compress and often encrypt their `.pak` archives. EchoWiki instead carves out any self-contained media (OGG, WAV, PNG, JPEG) stored uncompressed inside a `.pak`. Compressed, encrypted, or cooked data is never matched, so it extracts only what it safely can rather than producing garbage.

#### **Godot**

EchoWiki reads Godot's `.pck` pack files (used by both Godot 3 and 4), pulling out the bundled images and audio.

Most other games work too. When no known engine is matched, EchoWiki falls back to a generic scan that picks up image and audio files from anywhere in the folder, using each file's parent folder as its category. Along the way it automatically unpacks common archives so these engines are supported out of the box:

| Engine        | Format              | What's extracted            |
| ------------- | ------------------- | --------------------------- |
| **RenPy**     | `.rpa` archive      | Image/audio files           |
| **GameMaker** | `data.win` / `FORM` | Texture pages + audio blobs |

It also unpacks plain `.zip` and `.nw` (NW.js) packages.

RPG Maker games are decrypted natively, including their archive formats:

| Engine               | Format            |
| -------------------- | ----------------- |
| **RPG Maker MV**     | Individual files  |
| **RPG Maker MZ**     | Individual files  |
| **RPG Maker VX Ace** | RGSS3A v3 archive |
| **RPG Maker VX**     | RGSSAD v1 archive |
| **RPG Maker XP**     | RGSSAD v1 archive |
| **RPG Maker 2003**   | XYZ image format  |

And a few title-specific readers, such as **TCOAAL** (_The Coffin of Andy and Leyley_) 3.0+, are handled natively as well.

For anything unusual, moderators can supply a [custom transform](#custom-transform): a short snippet of JavaScript that receives each file and returns the decoded asset. This lets a community add support for an engine EchoWiki doesn't recognize on its own.

When forcing the engine in the [Game settings](#game), the choices are: **Auto-detect** (recommended), then Unity, Unreal, and Godot, followed by the **RPG Maker** group (the full family above), **Other** (Generic scan, TCOAAL), and **Advanced** (Custom transform).

## Asset Browser

![browser](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/assets.png)

A gallery view with filter tabs (Images, Audio, and a Models tab that appears once the game ships 3D assets) and subfolder navigation. Each card has a copy button that copies its echo Markdown to the clipboard (Ctrl/Cmd+click copies the link with the original, unmapped filename instead). When a filename mapping is configured, cards display their mapped names. A "Load more" button pages in additional assets on demand.

Clicking any asset opens a full preview: an image lightbox, an audio player with a waveform you can click to seek, or the interactive 3D model viewer (with a **Texture** field for retexturing models). The lightbox carries interactive [edition](#asset-editions) controls (crop, sprite-cell picker, audio speed and pitch); the copy button there bakes the active editions into the link, and right-clicking the preview copies it directly.

## Moderator Permissions

EchoWiki maps its capabilities onto Reddit's native moderator permissions, so you decide who can do what from the subreddit's mod-team settings rather than from any in-app role list. Two levels matter:

- **Wiki**: moderators who hold Reddit's _Manage Wiki Pages_ permission (`wiki`).
- **Config**: moderators who hold _Manage Settings_ (`config`), or full moderators with no permission restrictions (`all`).

Config is a superset of Wiki: a config moderator can do everything a wiki moderator can, plus everything in the Settings tab. A user with neither permission is treated as a regular reader.

| Capability                                               | Required level    |
| -------------------------------------------------------- | ----------------- |
| Read the wiki and resolve echo links                     | Anyone            |
| Suggest changes and vote (when collaborative mode is on) | Any eligible user |
| Edit wiki pages directly in the live editor              | Wiki              |
| Save directly to the wiki / bypass the public vote       | Wiki              |
| Review, accept, or deny suggestions (Submissions tab)    | Wiki              |
| Create or delete EchoWiki posts (mod menu)               | Config            |
| Open the Settings tab                                    | Config            |
| Game, engine, and asset-import configuration             | Config            |
| Style, theme, and filename mapping                       | Config            |
| Collaborative settings (eligibility, flairs, bans)       | Config            |
| Voting settings                                          | Config            |

## Moderator Settings

The Settings tab is visible only to **config**-level moderators (see [Moderator Permissions](#moderator-permissions)). **Wiki**-level moderators can edit wiki pages directly and use the Submissions tab, but not the Settings tab.

### General

![general](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/general.png)

- **Wiki Title**: Displayed on the home screen below the logo. Leave empty for default.
- **Wiki Description**: Short text shown below the title.

### Game

![game](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/game.png)

- **Game Title**: Displayed to users during import. A warning appears if the detected title does not match.
- **Engine**: Leave on Auto-detect, or force a specific engine. The dropdown lists Unity, Unreal, and Godot first, then groups the rest for clarity: **RPG Maker** (MV, MZ, VX Ace, VX, XP, 2003: with encrypted variants for MV/MZ), **Other** (Generic scan covering RenPy, GameMaker, and any other game; plus TCOAAL), and **Advanced** (Custom transform).
- **Encryption Key**: Override the decryption key for games with encrypted assets. Leave empty for auto-detection. Not used by Unity, Unreal, Godot, Generic, or TCOAAL.
- **Custom Transform Code**: Shown when the engine is set to Custom. See [Custom transform](#custom-transform) below.

#### Custom transform

When no built-in reader fits, set the engine to **Custom transform** and provide a JavaScript snippet. The snippet is a function body that runs in each reader's browser during import. It is called once for every file in the selected game folder and receives a single `file` argument (a [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File) object). Return `{ path, data, mimeType }` to include the decoded asset, or `null`/`undefined` to skip the file. Read raw bytes with `await file.arrayBuffer()` and apply any custom decryption there.

```js
// Called for every file in the game folder.
// Return an object to include the file, or null/undefined to skip it.
// Available: file.name, file.webkitRelativePath, file.arrayBuffer(), file.text()

const rel = file.webkitRelativePath;
const parts = rel.split("/").slice(1); // strip root folder
if (parts.length === 0) return null;

const name = parts[parts.length - 1] ?? "";
if (!name.match(/\.(png|jpg|jpeg|gif|ogg|mp3|wav|m4a)$/i)) return null;

const parent = parts.length > 1 ? parts[parts.length - 2] : "root";
const mime = name.endsWith(".png")
  ? "image/png"
  : name.endsWith(".ogg")
    ? "audio/ogg"
    : name.endsWith(".mp3")
      ? "audio/mpeg"
      : name.endsWith(".wav")
        ? "audio/wav"
        : "application/octet-stream";

return {
  path: parent + "/" + name.toLowerCase(),
  data: await file.arrayBuffer(),
  mimeType: mime,
};
```

> ⚠ This code runs in users' browsers when they import game files. Only set it from a source you trust.

### Style

![style](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/style.png)

- **Card Size**: Compact, Normal, or Large thumbnails in the asset browser.
- **Wiki Font Size**: Small, Normal, or Large.
- **Font**: System, Serif, Mono, or Subreddit (uses the subreddit's configured font).
- **Home Background**: Ripple animation, subreddit banner, both, or none.
- **Home Logo**: EchoWiki logo or subreddit icon.

### Theme

![theme](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/theme.png)

Separate light and dark mode configuration. Each color has a reset button to restore the default derived from the subreddit's appearance settings. The app follows the user's system light/dark preference.

### Mapping

![mapping](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/mapping.png)

Moderators define `"original": "mapped"` pairs (one per line, comments supported), with a live preview table showing how each pair is parsed (Original / Mapped To). Mapped names replace raw filenames in the asset browser and in echo links.

When a mapping is changed or removed, any wiki echo links referencing the old mapped name are automatically replaced with the original filename. A notification shows how many replacements were made and which pages were updated.

Example:

```
// Character sprites
"actor1": "hero"
"actor2": "villain"

// Tilesets
"dungeon_a1": "cave_floor"
```

### Collaborative

![collaborative](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/collaborative.png)

The collaborative feature lets users suggest changes to the wiki.

- **Collaborative mode**: Toggle to enable or disable community suggestions.
- **Eligibility thresholds**: Minimum karma and account age required to submit suggestions.
- **Edit cooldown**: Minimum number of minutes a user must wait between edits to their pending suggestion.
- **Contributor flair**: Flair template awarded to users after their first accepted suggestion.
- **Advanced contributor flair**: Flair template and acceptance count threshold for the advanced tier.
- **Banned contributors**: List of users banned from submitting suggestions.

### Voting

![voting](https://raw.githubusercontent.com/Kidev/EchoWiki/main/docs/voting.png)

Voting builds on collaborative mode, which it requires, engaging your community with a vote on each suggested change.

- **Voting**: Toggle to enable or disable community voting on suggestions (requires collaborative mode).
- **Accept threshold**: Number of accept votes that approve a suggestion immediately. 0 disables the instant accept.
- **Reject threshold**: Number of reject votes that reject a suggestion immediately. 0 disables the instant reject.
- **Duration**: Voting period in days. Set to 0 to disable deadline-based finalization.
- **Minimum voters for timing**: Number of voters required before the time-based threshold applies.
- **Time-based threshold**: Percentage of accept votes required to pass when the deadline is reached. 0 means a simple majority wins.
- **Allow vote changes**: Whether voters can change their vote after casting, with an optional cooldown between changes.
- **Show voter names**: Whether voter names are visible to other users. Moderators and the suggestion author always see names.
- **Max suggestion updates**: Maximum number of times a pending suggestion can be updated (0 for unlimited).
- **Voter eligibility**: Minimum karma and account age required to vote (separate from contributor eligibility).
- **Voting post flair**: Flair template applied to voting posts on creation.
- **Voting post title**: Template for the title of created voting posts. Supports `%user%`, `%page%`, `%pathPage%`, and `%shortPathPage%` placeholders.

## A Note to Game Developers

Fan wikis happen. For any game with a dedicated community, players will build wikis filled with screenshots, ripped sprites, and re-hosted audio. Assets end up scattered across third-party sites, reposted without context, and stripped of any connection to the original product.

EchoWiki takes a different approach. No asset is ever uploaded, hosted, or distributed by anyone. Each user loads files from their own purchased copy of the game, and those files never leave their machine. The wiki references assets by filename, but every reader must own and import the game themselves for anything to appear. There is no server hosting the art, no CDN serving the music, no download link anywhere. If someone does not own the game, they see nothing. The app encourages ownership rather than working around it.

## Privacy

All game files are processed locally in the browser using IndexedDB. No assets are uploaded anywhere. Server-side storage (Redis) holds only moderator configuration (game title, style settings, filename mappings, collaborative and voting settings) plus the text of pending suggestions and vote records. See [PRIVACY_POLICY.md](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/PRIVACY_POLICY.md) and [TERMS_AND_CONDITIONS.md](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/TERMS_AND_CONDITIONS.md).

[EchoWiki is available on GitHub](https://github.com/Kidev/EchoWiki)

> _An echo is never a copy, it is a sound that returns to those who were there to make it. An `echo://` link stores no game file anywhere; it is a call that resolves inside the reader's own browser. Players who own the game hear the echo and see the art; everyone else sees only its name. The wiki speaks, and each player's own copy answers._
