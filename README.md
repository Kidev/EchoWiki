# EchoWiki

For all the communities sharing their passion for an RPG Maker game, this app turns your subreddit wiki into an interactive and rich experience. Users owning the same game bring their own files from their own copy, those assets are processed and stored locally in their browser, and are displayed when they encounter echo links in the wiki. Nothing is uploaded to any server.

[EchoWiki is available on GitHub](https://github.com/Kidev/EchoWiki)

## How It Works

**Import**: Users select their game folder. The app auto-detects the engine and extracts assets entirely in the browser. Nothing is uploaded.

**Browse**: Wiki pages render `echo://` links as inline images and audio players. An asset browser lets users explore all their files and copy echo links for use in the wiki.

**Wiki**: The subreddit wiki is displayed directly inside the app. Links between wiki pages navigate in-app, anchor links scroll to the right section, and external links open normally. Moderators can write wiki pages with echo links that resolve to each user's own local copy of the game assets.

## Echo Links

Standard markdown with the `echo://` scheme:

```markdown
![Character portrait](echo://img/characters/hero.png)
[Battle theme](echo://audio/bgm/battle.ogg)
```

Users who have imported the game see resolved assets inline. Everyone else (and those reading the raw wiki on Reddit) sees the alt text only.

## Asset Editions

Echo links support edition parameters that transform how assets are displayed. Editions use URL query-parameter syntax (`?` and `&`) appended to the path and are applied client-side in real-time.

Available editions:

| Edition    | Syntax                    | Description                                             |
| ---------- | ------------------------- | ------------------------------------------------------- |
| **Crop**   | `?crop`                   | Trims transparent pixels from all edges of the image    |
| **Sprite** | `?sprite=cols,rows,index` | Extracts a single cell from a sprite sheet grid         |
| **Speed**  | `?speed=value`            | Sets audio playback speed (0.25 to 4.0, default 1.0)    |
| **Pitch**  | `?pitch=value`            | Shifts audio pitch in semitones (-12 to +12, default 0) |

Editions can be combined with `&`:

```markdown
![Hero walking](echo://img/characters/actor1.png?crop&sprite=12,8,3)
[Battle theme fast](echo://audio/bgm/battle.ogg?speed=2.0&pitch=-3)
```

The asset preview lightbox includes interactive controls for applying editions. The generated echo link (copied via the "Copy ECHO" button) automatically includes the active edition suffixes.

## Supported Engines

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

## Wiki

Wiki pages are fetched from the subreddit's wiki via the Reddit API. Navigating between pages happens in-app via a breadcrumb bar that slides down from the top menu when hovering the Wiki tab. The breadcrumb shows the current page path and dropdown arrows to navigate to sibling pages at each level.

Markdown rendering supports:

- Standard GFM features: tables, code blocks, lists, blockquotes, horizontal rules
- GitHub-style alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) with colored borders, icons, and bold titles
- HTML content via `rehype-raw`, used for floating infoboxes and layout grids
- Echo links resolved inline as images or audio players
- Anchor links scrolling within the current page
- External links opening in the browser

All wiki content is themed to match the configured color scheme.

### Section Links

Every wiki heading has a copy-link button that appears on hover. Clicking it copies an `echolink://` URL pointing to that specific section. These links can be shared with other users of the same subreddit's EchoWiki. To open one, click the link icon in the Wiki tab bar to open the EchoLink dialog, then paste the URL. The dialog also accepts `echo://` asset paths to jump directly to a specific file in the asset browser.

### Editing

Moderators can edit wiki pages directly inside the app. An edit button appears in the top-right corner of the wiki view when in expanded mode. Clicking it opens a split-pane editor: the left pane shows a live Markdown preview and the right pane is a raw Markdown textarea. Saving requires entering a reason for the change; the reason is prefixed with the moderator's username and stored in the Reddit wiki revision history. Navigating away while editing prompts for confirmation before discarding changes.

HTML `style` attributes on echo image tags (e.g. `<img src="echo://..." style="width: 120px">`) are applied client-side, allowing fine-grained layout control from wiki source.

## Asset Browser

A gallery view with filter tabs (Images, Audio) and subfolder navigation. Long asset names scroll on hover. Clicking any asset opens a full preview with a close button (image lightbox or audio player with frequency visualization). Right-clicking or using the copy button copies the echo markdown to the clipboard. When a filename mapping is configured, assets display mapped names. Pagination loads more assets on demand.

## Mod Settings

Moderators see a Settings tab with five sections and a single Save button in the tab bar.

### General

- **Wiki Title**: Displayed on the home screen below the logo. Leave empty for default.
- **Wiki Description**: Short text shown below the title.

### Game

- **Game Title**: Displayed to users during import. If the detected game title does not match, a warning is shown.
- **Engine**: Select the engine type or leave on auto for automatic detection.
- **Encryption Key**: Required for games with encrypted assets.

### Style

- **Card Size**: Compact, Normal, or Large thumbnails in the asset browser.
- **Wiki Font Size**: Small, Normal, or Large.
- **Font**: System, Serif, Mono, or Subreddit (uses the subreddit's configured font).
- **Home Background**: Ripple animation, subreddit banner, both, or none.
- **Home Logo**: EchoWiki logo or subreddit icon.

### Theme

Separate light and dark mode configuration. Two-column layout with foreground colors (Accent, Links, Text, Muted Text) on the left and background colors (Background, Thumbnail Bg, Control Bg, Control Text) on the right. Each color has a reset button to restore the default derived from the subreddit's appearance settings. The app follows the user's system light/dark preference.

### Mapping

Split-pane editor with a draggable divider. The top panel shows a live preview table of parsed mappings (Original / Mapped To) with a sticky header and scrollable rows. The bottom panel is a code editor with JS-style syntax highlighting for strings, colons, and comments.

Mods define `"original": "mapped"` pairs (one per line, comments supported). Mapped names replace raw filenames in the asset browser and echo links.

When a mapping is changed or removed, any wiki echo links that referenced the old mapped name are automatically replaced with the original hash name. A notification shows how many replacements were made and which pages were updated.

Example:

```
// Character sprites
"actor1": "hero"
"actor2": "villain"

// Tilesets
"dungeon_a1": "cave_floor"
```

## A Note to Game Developers

Fan wikis happen. For any game with a dedicated community, players will build wikis filled with screenshots, ripped sprites, and re-hosted audio. This is the reality of passionate fanbases, and it has always been largely uncontrollable: assets end up scattered across third-party sites, reposted without context, and stripped of any connection to the original product.

EchoWiki takes a fundamentally different approach. No asset is ever uploaded, hosted, or distributed by anyone. Each user loads files from their own purchased copy of the game, and those files never leave their machine. The wiki references assets by filename, but every single user must own and import the game themselves for anything to appear. There is no server hosting your art, no CDN serving your music, no download link anywhere. If someone does not own the game, they see nothing. The app actively encourages ownership rather than working around it.

If you are a developer whose game has an EchoWiki community, your fans are building something beautiful around the world you created, and they are doing it without redistributing a single byte of your work.

## Privacy

All game files are processed locally in the browser using IndexedDB. No assets are uploaded anywhere. Server-side storage (Redis) only holds mod configuration: game title, style settings, and filename mappings. See [PRIVACY_POLICY.md](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/PRIVACY_POLICY.md) and [TERMS_AND_CONDITIONS.md](https://raw.githubusercontent.com/Kidev/EchoWiki/refs/heads/main/TERMS_AND_CONDITIONS.md).
