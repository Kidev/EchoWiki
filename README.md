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

## Wiki Integration

Wiki pages are fetched from the subreddit's wiki via the Reddit API. The dropdown only shows pages the current user has permission to view. Links within wiki pages work naturally:

- **Wiki-internal links** (e.g. `/r/sub/wiki/page`) navigate within the app
- **Anchor links** (`#section`) scroll to the heading within the current page
- **External links** open in the browser tab

Markdown features like blockquotes, tables, code blocks, lists, and horizontal rules are all themed to match the configured color scheme.

## Asset Browser

A gallery view with filter tabs (Images, Audio), subfolder navigation, search, and lazy pagination. Clicking any asset opens a full preview (image lightbox or audio player with frequency visualization). Right-clicking or using the copy button copies the echo markdown to the clipboard. When a filename mapping is configured, assets display mapped names.

## Mod Settings

Moderators see a Settings tab with three sections:

### General

- **Game Title**: Displayed to users during import. If the detected game title doesn't match, a dismissible warning is shown.

### Style

- **Font**: System, Serif, or Mono.
- **Card Size**: Compact, Normal, or Large thumbnails in the asset browser.
- **Wiki Font Size**: Small, Normal, or Large.
- **Colors**: Separate light and dark theme configuration with color pickers for Accent, Background, Text, Muted Text, Thumbnail Background, Control Background, and Control Text. Each color has preset swatches and a custom hex input. The app automatically follows the user's system light/dark preference.

### Filename Mapping

A textarea where mods define `"original": "mapped"` pairs (one per line, comments supported). A live preview table shows the parsed mappings below the editor. Mapped names replace raw filenames in the asset browser and echo links. No code execution: parsing uses a simple regex to extract key-value pairs from the text.

When a mapping is changed or removed, any wiki echo links that referenced the old mapped name are automatically replaced with the original hash name. The moderator is shown a notification with the number of replacements and which pages were updated. This prevents stale mapped names from breaking wiki content.

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
