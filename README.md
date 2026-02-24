# EchoWiki

Rich wikis for Reddit communities. Live editing, advanced markdown, collaborative contributions, and for RPG Maker games: in-game assets from each player's own copy. No uploads.

[EchoWiki is available on GitHub](https://github.com/Kidev/EchoWiki)

EchoWiki turns a subreddit wiki into a proper editing and reading environment. Moderators write and update pages inside the app with a live Markdown preview. Readers get richer formatting than Reddit's native wiki. Contributors can propose changes that mods review before merging. For RPG Maker communities specifically, the app resolves special `echo://` links to in-game assets that each reader loads from their own copy of the game, without any files being uploaded anywhere.

## Wiki

Wiki pages are fetched from the subreddit's wiki via the Reddit API and rendered inside the app with a full Markdown engine.

Supported formatting:

- Standard GFM: tables, code blocks, lists, blockquotes, horizontal rules
- GitHub-style alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) with colored borders and icons
- Raw HTML via `rehype-raw`, enabling floating infoboxes, layout grids, and inline style overrides
- Echo links resolved as inline images and audio players
- Anchor links scrolling to the target heading within the page
- External links opening in the browser

Navigation uses a breadcrumb bar that slides down from the top when hovering the Wiki tab. Each segment in the breadcrumb has a dropdown showing sibling pages at that level.

### Live Editor

Moderators can edit wiki pages directly inside the app. An edit button appears in the top-right corner of the wiki view when in expanded mode. Clicking it opens a split-pane editor: the left pane shows a live Markdown preview and the right pane is a raw Markdown textarea. Saving requires entering a reason for the change. The reason is prefixed with the moderator's username and stored in the Reddit wiki revision history. Navigating away while editing prompts for confirmation before discarding changes.

HTML `style` attributes on echo image tags (e.g. `<img src="echo://..." style="width: 120px">`) are applied client-side, allowing layout control from wiki source.

### Section Links

Every heading has a copy-link button that appears on hover. Clicking it copies an `echolink://` URL pointing to that specific section. These links can be shared with other users of the same subreddit's EchoWiki. To open one, use the link icon in the top bar to open the EchoLink dialog, then paste the URL. The dialog also accepts `echo://` asset paths to jump directly to a file in the asset browser.

## Collaborative Editing

When collaborative mode is enabled, users who meet the subreddit's eligibility thresholds (karma and account age, both configurable) can suggest changes to any wiki page. Each user can have one active suggestion at a time.

### Suggestions

Suggesting a change opens the same split-pane editor as the mod editor, with two tabs in the preview pane:

- **Preview**: live rendered Markdown of the suggested content
- **Highlight changes**: a unified diff view of the raw Markdown, with removed lines in red and added lines in green, and unchanged content collapsed to context blocks

Submitting requires a short description of what changed. The suggestion is queued for mod review.

### Mod Review

Moderators see a Submissions tab listing all pending suggestions. Clicking Review opens a full-screen modal showing the current page content alongside the suggested content. A "Highlight changes" button in the header switches the view from side-by-side rendered Markdown to a unified diff of the raw source.

Mods can accept or deny each submission. Accepting writes the suggested content to the Reddit wiki with the contributor's username in the revision reason.

### Flair Rewards

Mods can configure two flair templates in the Collaborative settings: one for contributors and one for advanced contributors (awarded after a configurable number of accepted suggestions). When a suggestion is accepted, the contributor earns the appropriate flair based on their acceptance count.

Flairs are not assigned automatically. Users choose when to equip them using a dropdown in the top bar, to the left of the EchoLink button. The dropdown lists all earned flairs with their styled previews. Users can switch between earned flairs at any time or remove their flair.

## Echo Links

Echo links are standard Markdown image or link syntax using the `echo://` scheme:

```markdown
![Character portrait](echo://img/characters/hero.png)
[Battle theme](echo://audio/bgm/battle.ogg)
```

Users who have imported their copy of the game see assets resolved inline. Everyone else, including those reading the raw wiki on Reddit, sees only the alt text. Nothing is uploaded to any server.

### Asset Editions

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
[Battle theme fast](echo://audio/bgm/battle.ogg?speed=2.0&pitch=-3)
```

The asset preview lightbox includes interactive controls for applying editions. The generated echo link (copied via the copy button) includes the active edition suffixes.

## Asset Import

Users select their game folder. The app auto-detects the engine, extracts assets entirely in the browser, and stores them in IndexedDB. Nothing is uploaded.

### Supported Engines

| Engine               | Format            |
| -------------------- | ----------------- |
| **RPG Maker 2003**   | XYZ image format  |
| **RPG Maker XP**     | RGSSAD v1 archive |
| **RPG Maker VX**     | RGSSAD v1 archive |
| **RPG Maker VX Ace** | RGSS3A v3 archive |
| **RPG Maker MV**     | Individual files  |
| **RPG Maker MZ**     | Individual files  |
| **TCOAAL 3.0+**      | Individual files  |

Engine detection is automatic. Games using mkxp with RTP archives (.dat files) are also supported.

## Asset Browser

A gallery view with filter tabs (Images, Audio) and subfolder navigation. Clicking any asset opens a full preview with a close button, an image lightbox or an audio player with frequency visualization. Right-clicking or using the copy button copies the echo Markdown to the clipboard. When a filename mapping is configured, assets display their mapped names. Pagination loads more assets on demand.

## Mod Settings

Moderators see a Settings tab with sections for General, Game, Style, Theme, Mapping, and Collaborative configuration.

### General

- **Wiki Title**: Displayed on the home screen below the logo. Leave empty for default.
- **Wiki Description**: Short text shown below the title.

### Game

- **Game Title**: Displayed to users during import. A warning appears if the detected title does not match.
- **Engine**: Select the engine type or leave on auto for automatic detection.
- **Encryption Key**: Required for games with encrypted assets.

### Style

- **Card Size**: Compact, Normal, or Large thumbnails in the asset browser.
- **Wiki Font Size**: Small, Normal, or Large.
- **Font**: System, Serif, Mono, or Subreddit (uses the subreddit's configured font).
- **Home Background**: Ripple animation, subreddit banner, both, or none.
- **Home Logo**: EchoWiki logo or subreddit icon.

### Theme

Separate light and dark mode configuration. Each color has a reset button to restore the default derived from the subreddit's appearance settings. The app follows the user's system light/dark preference.

### Mapping

Split-pane editor with a draggable divider. The top panel shows a live preview table of parsed mappings (Original / Mapped To). The bottom panel is a code editor with syntax highlighting for strings, colons, and comments.

Mods define `"original": "mapped"` pairs (one per line, comments supported). Mapped names replace raw filenames in the asset browser and in echo links.

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

- **Collaborative mode**: Toggle to enable or disable community suggestions.
- **Eligibility thresholds**: Minimum karma and account age required to submit suggestions.
- **Contributor flair**: Flair template awarded to users after their first accepted suggestion.
- **Advanced contributor flair**: Flair template and acceptance count threshold for the advanced tier.
- **Banned contributors**: List of users banned from submitting suggestions.

## A Note to Game Developers

Fan wikis happen. For any game with a dedicated community, players will build wikis filled with screenshots, ripped sprites, and re-hosted audio. Assets end up scattered across third-party sites, reposted without context, and stripped of any connection to the original product.

EchoWiki takes a different approach. No asset is ever uploaded, hosted, or distributed by anyone. Each user loads files from their own purchased copy of the game, and those files never leave their machine. The wiki references assets by filename, but every reader must own and import the game themselves for anything to appear. There is no server hosting the art, no CDN serving the music, no download link anywhere. If someone does not own the game, they see nothing. The app encourages ownership rather than working around it.

## Privacy

All game files are processed locally in the browser using IndexedDB. No assets are uploaded anywhere. Server-side storage (Redis) holds only mod configuration: game title, style settings, filename mappings, and collaborative settings. See [PRIVACY_POLICY.md](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/PRIVACY_POLICY.md) and [TERMS_AND_CONDITIONS.md](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/TERMS_AND_CONDITIONS.md).
