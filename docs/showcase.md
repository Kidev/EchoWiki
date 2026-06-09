# EchoWiki showcase

This page demonstrates every visual feature the echo system supports. Assets are rendered from locally-imported game files. Nothing is uploaded to Reddit's servers: assets are resolved on each reader's device.

> [!NOTE]
> Replace any `echo://` paths below with paths from **your own** asset browser. The paths shown here match *The Coffin of Andy and Leyley*.

[1. Inline image](#1-inline-image)  
[2. Audio player](#2-audio-player)  
[3. 3D models](#3-3d-models)  
[4. Sprites](#4-sprite-extraction)  
[5. Crop](#5-crop-images)  
[6. Emoji & outline](#6-emoji--outline-modifiers)  
[7. Infobox](#7-infobox)  
[8. Scene](#8-layered-scene)  
[9. Frame-by-frame](#9-frame-by-frame-animation)  
[10. Moving animation](#10-moving-animation)  
[Quick reference](#quick-reference)

---

## 1. Inline image

Embed any game image with the standard markdown image syntax.

```
![Ashley](echo://img/faces/ashley_(content).png)
```

![Ashley](echo://img/faces/ashley_(content).png)

Use `>>> <<<` to center images or any other content:

```
>>>![Ashley](echo://img/faces/ashley_(content).png)<<<
```

>>>![Ashley](echo://img/faces/ashley_(content).png)<<<

---

## 2. Audio player

Link to a sound or music file to embed a native audio player.

```
![Twisted Clowns](echo://audio/bgm/twisted_clowns.ogg)
```

![Twisted Clowns](echo://audio/bgm/twisted_clowns.ogg)

Combine `?speed=` and `?pitch=` to shift playback:

![Normal](echo://audio/bgm/twisted_clowns.ogg)  
![x1.5 speed](echo://audio/bgm/twisted_clowns.ogg?speed=1.5)  
![+5 semitones](echo://audio/bgm/twisted_clowns.ogg?pitch=5)  
![Slow + low](echo://audio/bgm/twisted_clowns.ogg?speed=0.7&pitch=-3)

---

## 3. 3D models

Interactive 3D models embed with the **same image syntax** as a picture. The model loads in a small WebGL viewer: drag to orbit, scroll to zoom, and use the buttons in the corner to auto-rotate or reset the view.

```
![King statue](echo://meshes/king.glb)
```

> [!NOTE]
> Unlike the image examples on this page, 3D models only appear for games that actually ship 3D assets (Unity, Unreal, Godot). *The Coffin of Andy and Leyley* is a 2D RPG Maker game, so the model paths in this section will not resolve in its demo. Swap in an `echo://` model path from your own asset browser.

Append display hints to the path, combined with `&`:

| Param | Example | Effect |
|---|---|---|
| `?autorotate` (alias `?spin`) | `?autorotate` | Start with the model slowly spinning |
| `?height` (alias `?h`) | `?height=400px` | Set the viewer height |
| `?width` (alias `?w`) | `?width=80%` | Set the viewer width |
| `?bg` | `?bg=111` | Background color (hex, `#` is added for you) |
| `?texture` (alias `?tex`) | `?texture=img/diffuse.png` | Use an imported image as the model's texture |

```
![King statue](echo://meshes/king.glb?spin&height=420px&bg=151515)
```

**Supported formats:** `glb`, `gltf`, `obj`, `stl`, `ply`, `fbx`, `dae` (Collada), `3mf`. GLB is recommended because it packs geometry and textures into a single self-contained file; OBJ/Collada that rely on sibling `.mtl` or texture files render geometry only. Unity games are special-cased: their meshes ship as raw GPU buffers rather than model files, so EchoWiki rebuilds each one into a self-contained GLB and links it to its base-color texture.

When a model loads untextured (e.g. an OBJ whose materials live in external files), give it one with `?texture=`, pointing at any imported image asset:

```
![King statue](echo://meshes/king.obj?texture=img/king_diffuse.png)
```

The asset browser's model preview has a matching **Texture** field; whatever you set there is baked into the link it copies. You don't have to type the path by hand: open an image in the asset browser, hit its copy button, and paste the result straight into the Texture field. A pasted Markdown link like `![diffuse](echo://img/king_diffuse.png)` is trimmed down to its `echo://` path automatically and applied right away, so retexturing a model is a copy-then-paste.

The viewer is lazy-loaded: the three.js runtime and the loader for a given format are only downloaded the first time a reader opens a model, so pages without 3D content carry no extra weight.

---

## 4. Sprite extraction

Extract one cell from a grid spritesheet with `?sprite=cols,rows,index`. Index counts left-to-right, top-to-bottom, zero-based.

```
![frame](echo://img/characters/spritessheet_12x8_characters_7.png?sprite=12,8,6)
```

Four consecutive cells from the same row:

| | | | |
|---|---|---|---|
| ![frame 6](echo://img/characters/spritessheet_12x8_characters_7.png?sprite=12,8,6) | ![frame 7](echo://img/characters/spritessheet_12x8_characters_7.png?sprite=12,8,7) | ![frame 8](echo://img/characters/spritessheet_12x8_characters_7.png?sprite=12,8,8) | ![frame 9](echo://img/characters/spritessheet_12x8_characters_7.png?sprite=12,8,9) |
| `index 6` | `index 7` | `index 8` | `index 9` |

---

## 5. Crop images

Trims transparent padding using `?crop`, keeping only the bounding box of visible pixels. Adding `?outline` on top shows the bounding box clearly.

| Original | `?crop` |
|---|---|
| ![Artifact](echo://img/pictures/pictures_53.png?outline) | ![Artifact cropped](echo://img/pictures/pictures_53.png?crop&outline) |

The first image shows the original with `?outline` marking the full image bounds, including transparent padding. The second shows the result of `?crop&outline`: the image is trimmed to the bounding box of visible pixels, and the outline now sits tight against the content.

> [!IMPORTANT]
> `?crop` cannot be combined with `?sprite`.

---

## 6. Emoji & outline modifiers

Two display hints can be appended to any image path.

### `?emoji`: inline text-height image

Renders the image inline with surrounding text at `1.2em` height, vertically aligned like an emoji.

```
Ashley ![Ashley](echo://img/faces/ashley_(content).png?emoji) is the protagonist.
```

Ashley ![Ashley](echo://img/faces/ashley_(content).png?emoji) is the protagonist, while Andrew ![Andrew](echo://img/faces/andrew_(content).png?emoji) is her brother.

Combine with `?sprite` and other params using `&`:

```
![icon](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,0&emoji)
```

Sprite 0: ![icon](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,0&emoji)  
Sprite 4: ![icon](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,4&emoji)  
Sprite 7: ![icon](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,7&emoji)

### `?outline`: dashed accent outline

Draws a dashed accent-color outline around the image. Useful to highlight or contrast an image.

| Without `?outline` | With `?outline` |
|---|---|
| ![No outline](echo://img/pictures/pictures_53.png?crop) | ![With outline](echo://img/pictures/pictures_53.png?crop&outline) |

You can combine `?outline` with `?crop`, `?sprite`, and `?emoji`:

```
![outlined sprite](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,6&outline)
```



| | | |
|---|---|---|
| ![outlined sprite](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,0&outline)  | ![outlined sprite](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,4&outline)  | ![outlined sprite](echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,7&outline)
|

---

## 7. Infobox

Use `:::infobox` to build a Wikipedia-style character infobox: a colored header, portrait, and a key-value table floated beside page content. Below is a full example of what a real character page looks like.

```
# Ashley Graves

:::infobox title="Ashley Graves" image=echo://img/faces/ashley_(content).png align=right
Alias | Leyley
Age | 20
Species | Human
Gender | Female
Status | Alive (determinant)
Role | Co-protagonist
Family | [Andrew](/r/echo_wiki_dev/wiki/index/characters/andrew_graves) (brother)<br>[Renee](/r/echo_wiki_dev/wiki/index/characters/mrs_graves) (mother)<br>[Douglas](/r/echo_wiki_dev/wiki/index/characters/mr_graves) (father)
Victims | [Nina](/r/echo_wiki_dev/wiki/index/characters/nina), others (determinant)
Crimes | Murder, cannibalism, manipulation, obstruction of justice
:::

> *"It's us against the world, Andy. It always has been."*

**Ashley Graves**, nicknamed **Leyley**, is the younger of the Graves siblings and co-protagonist of *The Coffin of Andy and Leyley*. She is the primary driver of the story's events, propelled by an obsessive and possessive attachment to her brother Andrew.

## Appearance

Ashley has long black hair, most often styled in twin pigtails. She wears a choker and favors dark clothing. She is notably shorter than Andrew. Her character design emphasizes a contrast between her youthful appearance and the severity of her actions.

In childhood flashbacks, she is depicted with a similar hairstyle, already visually distinct from other children.

## Personality

Ashley is manipulative, impulsive, and frequently cruel. She exhibits sociopathic tendencies and demonstrates little to no regard for conventional morality or the well-being of anyone outside her bond with Andrew. Her entire world revolves around her brother, and she becomes violently jealous of anyone who threatens her monopoly on his attention and affection.

She employs a wide range of manipulation tactics, including guilt-tripping, emotional blackmail, playing the victim, and feigned helplessness, to maintain control over Andrew. She is acutely aware of his weaknesses and exploits them with precision.

Despite her disturbing behavior, Ashley shows moments of genuine vulnerability and insecurity, particularly when she doubts Andrew's commitment to her. These moments suggest that beneath the manipulation lies a deeply damaged individual whose attachment style was warped by childhood neglect.

She possesses a dark sense of humor and often makes light of horrific situations, suggesting either a coping mechanism or a genuine enjoyment of chaos, likely both.
```

Live render:

# Ashley Graves

:::infobox title="Ashley Graves" image=echo://img/faces/ashley_(content).png align=right
Alias | Leyley
Age | 20
Species | Human
Gender | Female
Status | Alive (determinant)
Role | Co-protagonist
Family | [Andrew](/r/echo_wiki_dev/wiki/index/characters/andrew_graves) (brother)<br>[Renee](/r/echo_wiki_dev/wiki/index/characters/mrs_graves) (mother)<br>[Douglas](/r/echo_wiki_dev/wiki/index/characters/mr_graves) (father)
Victims | [Nina](/r/echo_wiki_dev/wiki/index/characters/nina), others (determinant)
Crimes | Murder, cannibalism, manipulation, obstruction of justice
:::

> *"It's us against the world, Andy. It always has been."*

**Ashley Graves**, nicknamed **Leyley**, is the younger of the Graves siblings and co-protagonist of *The Coffin of Andy and Leyley*. She is the primary driver of the story's events, propelled by an obsessive and possessive attachment to her brother Andrew.

## Appearance

Ashley has long black hair, most often styled in twin pigtails. She wears a choker and favors dark clothing. She is notably shorter than Andrew. Her character design emphasizes a contrast between her youthful appearance and the severity of her actions.

In childhood flashbacks, she is depicted with a similar hairstyle, already visually distinct from other children.

## Personality

Ashley is manipulative, impulsive, and frequently cruel. She exhibits sociopathic tendencies and demonstrates little to no regard for conventional morality or the well-being of anyone outside her bond with Andrew. Her entire world revolves around her brother, and she becomes violently jealous of anyone who threatens her monopoly on his attention and affection.

She employs a wide range of manipulation tactics, including guilt-tripping, emotional blackmail, playing the victim, and feigned helplessness, to maintain control over Andrew. She is acutely aware of his weaknesses and exploits them with precision.

Despite her disturbing behavior, Ashley shows moments of genuine vulnerability and insecurity, particularly when she doubts Andrew's commitment to her. These moments suggest that beneath the manipulation lies a deeply damaged individual whose attachment style was warped by childhood neglect.

She possesses a dark sense of humor and often makes light of horrific situations, suggesting either a coping mechanism or a genuine enjoyment of chaos, likely both.

---

## 8. Layered scene

Use `:::scene` to stack images at absolute positions in a fixed-size container.

- `bg:` fills the entire container (background layer)
- `layer:` places a sprite at custom coordinates: append CSS position params (`bottom=`, `left=`, `height=`, etc.)
- `fg:` covers everything on top with `pointer-events: none` (foreground overlay)

```
:::scene width=75% height=51%
bg: echo://img/parallaxes/backgrounds_156.png?crop
layer: echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,0 bottom=5% left=48% height=25%
layer: echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,3 bottom=5% left=40% height=25%
fg: echo://img/parallaxes/backgrounds_157.png?crop
:::
```

:::scene width=75% height=30%
bg: echo://img/parallaxes/backgrounds_156.png?crop
layer: echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,0 bottom=5% left=48% height=25%
layer: echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,3 bottom=5% left=40% height=25%
fg: echo://img/parallaxes/backgrounds_157.png?crop
:::

---

## 9. Frame-by-frame animation

Use `:::fbf` to cycle through sprite frames using CSS opacity animation. Each line is one `echo://` path for one frame. `fps` controls playback speed, `size` sets the pixel dimensions of the box.

An optional `alias=name` names the block so it can be referenced by `:::anim` blocks elsewhere on the page.

```
:::fbf fps=4 size=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
:::
```

Three speeds using the same walk cycle:

:::fbf fps=3 size=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
:::
`Slow: fps=3`

:::fbf fps=6 size=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
:::
Normal: `fps=6`

:::fbf fps=12 size=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
:::
Fast: `fps=12`


> [!TIP]
> **Picking frame indices:** open the Asset Browser, click a spritesheet, and use the Sprite editor to preview individual cells. Note down the indices you want, then write them into the `?sprite=cols,rows,index` parameter.

---

## 10. Moving animation

Use `:::anim` to move a sprite across a scene. You can either reference an `:::fbf` block by alias (with `ref=name`) or supply frames inline. Movement is defined as CSS keyframes (`N% key=value ...`).

> [!IMPORTANT]
> When using a background image (`bg=`), always set the container height with a percentage (`height=50%`), not pixels. Pixel heights break the background scaling.

**Defining an alias and referencing it:**

The `:::fbf alias=ashley-right` block defines a looping walk animation (facing right) and also renders where it appears. The `:::anim ref=ashley-right` block reuses those frames inside a moving scene.

```
:::fbf alias=ashley-right fps=6 size=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
:::

:::anim ref=ashley-right duration=2.5s width=75% height=51% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
0% left=10% bottom=5%
100% left=60% bottom=5%
:::
```

:::fbf alias=ashley-right fps=6 size=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
:::

*Walking across a background:*

:::anim ref=ashley-right duration=2.5s width=75% height=51% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
0% left=10% bottom=5%
100% left=60% bottom=5%
:::

**Inline frames (no alias needed):**

Lines starting with `echo://` are treated as frames; lines starting with a number are movement keyframes. Everything goes inside a single `:::anim` block.

```
:::anim fps=6 spritesize=100% duration=2.5s width=75% height=51% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
0% left=10% bottom=5%
100% left=60% bottom=5%
:::
```

:::anim fps=6 spritesize=100% duration=2.5s width=75% height=51% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
0% left=10% bottom=5%
100% left=60% bottom=5%
:::

**Walk back and forth (multi-phase):**

Use `---` separators inside `:::anim` to switch sprites mid-cycle. Each phase has its own frames and movement keyframes. Global params (`width`, `height`, `bg`) go on the opening `:::anim` line; per-phase params (`fps`, `spritesize`, `loops`, `duration`, `hold`) go on each `---` line.

Phase 1 uses the right-facing walk cycle (indices 24-25-26-25) moving left to right. Phase 2 uses the left-facing walk cycle (indices 12-13-14-13) moving right to left. The result is a seamless loop where the character always faces the direction she is walking.

```
:::anim width=75% height=51% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
--- duration=2s fps=6 spritesize=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
0% left=10% bottom=5%
100% left=60% bottom=5%
--- duration=2s fps=6 spritesize=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,12
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,13
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,14
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,13
0% left=60% bottom=5%
100% left=10% bottom=5%
:::
```

:::anim width=75% height=51% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
--- duration=2s fps=6 spritesize=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,24
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,26
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,25
0% left=10% bottom=5%
100% left=60% bottom=5%
--- duration=2s fps=6 spritesize=100%
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,12
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,13
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,14
echo://img/characters/spritessheet_12x8_characters_8.png?sprite=12,8,13
0% left=60% bottom=5%
100% left=10% bottom=5%
:::

---

## Quick reference

### echo:// links

| Feature | Syntax |
|---|---|
| Inline image | `![alt](echo://path/to/image.png)` |
| Audio player | `![label](echo://path/to/sound.ogg)` |
| Interactive 3D model | `![alt](echo://path/to/model.glb)` |
| Model: auto-rotate | `?autorotate` (alias `?spin`) appended to a model path |
| Model: size / background | `?height=400px`, `?width=80%`, `?bg=111` |
| Model: texture | `?texture=img/diffuse.png` (alias `?tex`); the preview's Texture field also accepts a pasted `![](echo://...)` link |
| Sprite cell | `?sprite=cols,rows,index` appended to an image path |
| Crop transparent padding | `?crop` appended to an image path |
| Inline emoji-size image | `?emoji` appended to any image path |
| Outlined image | `?outline` appended to any image path |
| Audio speed | `?speed=1.5` |
| Audio pitch (semitones) | `?pitch=5` |
| Combine params | `?crop&outline` or `?emoji&sprite=12,8,0` |

### Layout helpers

| Feature | Syntax |
|---|---|
| Center any content | `>>>content<<<` |

### Path aliases (`:::def`)

Define short names for long `echo://` paths and reference them anywhere on the page:

```
:::def
ashley = echo://img/faces/ashley_(content).png
bg     = echo://img/parallaxes/backgrounds_66.png?crop
sheet  = echo://img/characters/spritessheet_12x8_characters_8.png
:::
```

Then use `echo://~ashley`, `echo://~bg`, or `echo://~sheet` anywhere an echo path appears: in markdown images, block params, and inside other blocks.

```
![Ashley face](echo://~ashley)

:::scene width=80% height=120px
bg: echo://~bg
layer: echo://~sheet?sprite=12,8,0 bottom=5% left=48% height=25%
:::
```

Live demo (alias defined once, reused in image and scene):

:::def
ashley = echo://img/faces/ashley_(content).png
bg     = echo://img/parallaxes/backgrounds_66.png?crop
sheet  = echo://img/characters/spritessheet_12x8_characters_8.png
:::

![Ashley face](echo://~ashley?emoji) Walk right: ![walk r0](echo://~sheet?sprite=12,8,24&emoji) ![walk r1](echo://~sheet?sprite=12,8,25&emoji) ![walk r2](echo://~sheet?sprite=12,8,26&emoji)

:::scene
bg: echo://~bg
layer: echo://~sheet?sprite=12,8,24 bottom=5% left=48% height=25%
layer: echo://~sheet?sprite=12,8,12 bottom=5% left=30% height=25%
:::

### Echo blocks

All echo blocks use fenced syntax: opening line `:::type [params]`, content lines, closing `:::`. Params use `key=value` (quote values containing spaces: `key="some value"`).

#### `:::infobox` Wikipedia-style infobox

Renders a floating character infobox with a colored header, portrait image, and a key-value table. Values support inline markdown links and `<br>` for multi-line cells.

```
:::infobox title="Ashley Graves" image=echo://img/faces/ashley_(content).png align=right
Alias | Leyley
Age | 20
Species | Human
Gender | Female
Status | Alive (determinant)
Role | Co-protagonist
Family | [Andrew](/r/echo_wiki_dev/wiki/index/characters/andrew_graves) (brother)<br>[Renee](/r/echo_wiki_dev/wiki/index/characters/mrs_graves) (mother)
Crimes | Murder, cannibalism, manipulation, obstruction of justice
:::
```

| Param | Default | Description |
|---|---|---|
| `title` | | Text shown in the colored header bar |
| `image` | | Echo path of the portrait |
| `align` | `right` | Float side: `right` or `left` |

Body lines follow the format `Key | Value`.

#### `:::card` Simple image card

Floats an image beside free-form markdown content (headings, tables, prose).

```
:::card image=echo://img/faces/ashley_(content).png size=96px align=right
## Ashley

A young woman with a complicated relationship with the world.

| Attribute | Value |
|---|---|
| Age | 19 |
| Role | Protagonist |
:::
```

| Param | Default | Description |
|---|---|---|
| `image` | | Echo path of the portrait/image |
| `size` | `120px` | Width of the image |
| `align` | `right` | Float side: `right` or `left` |

#### `:::scene` Layered scene

```
:::scene [width=100%] [height=200px]
bg: echo://...
layer: echo://... [bottom=X] [left=X] [height=X] [width=X] ...
fg: echo://...
:::
```

| Param | Default | Description |
|---|---|---|
| `width` | `100%` | Container width |
| `height` | `200px` | Container height |

| Line prefix | Description |
|---|---|
| `bg:` | Background image, fills the container |
| `layer:` | Absolutely-positioned image; append CSS properties as `key=value` |
| `fg:` | Foreground overlay, `pointer-events: none` |

#### `:::fbf` Frame-by-frame animation

```
:::fbf [fps=2.5] [size=64] [alias=name]
echo://path/frame1.png?sprite=...
echo://path/frame2.png?sprite=...
:::
```

| Param | Default | Description |
|---|---|---|
| `fps` | `2.5` | Frames per second |
| `size` | `64` | Pixel dimensions of the animation box |
| `alias` | | Name this block so `:::anim` can reference it |

#### `:::anim` Moving animation

Moves a sprite across a background. Supports a single phase or multiple phases with different sprites.

> [!IMPORTANT]
> Always use percentage-based heights (`height=50%`) when a background image is set. Pixel heights break background scaling.

```
:::anim [ref=alias] [fps=2.5] [spritesize=48] [loops=1] [duration=3s] [hold=true] [width=75%] [height=50%] [pingpong=true] [bg=echo://...] [bgopacity=1]
[echo://frame1... (if no ref)]
[echo://frame2... (if no ref)]
N% key=value [key=value ...]
M% key=value [key=value ...]
:::
```

| Param | Default | Description |
|---|---|---|
| `ref` | | Alias of an `:::fbf` block to use as the sprite |
| `fps` | `2.5` | Frames per second. Treated as a target: see `hold`. Ignored when `ref` is set |
| `spritesize` | `48` | Sprite pixel size (ignored when `ref` is set) |
| `loops` | `1` | Number of whole walk cycles per movement. Movement time is derived as `loops × frames ÷ fps`. Ignored when `duration` is set |
| `duration` | `3s` | Explicit time for one full movement. Overrides `loops` |
| `hold` | `true` | Lock the walk to the movement: the cycle is snapped so a whole number of cycles exactly fills the movement, so the sprite never switches direction mid-stride. Set `hold=false` to keep the raw `fps` and let the cycle drift against the movement |
| `width` | `50%` | Scene container width |
| `height` | `50%` | Scene container height (use %, not px, with backgrounds) |
| `pingpong` | `false` | `true` = reverse at end of cycle (sprite does not flip) |
| `bg` | | Echo path for the background image |
| `bgopacity` | `1` | Background opacity (0-1) |

Movement keyframe lines: `N% key=value ...` where `N%` is the animation percentage.

**Multi-phase animation:** change the sprite mid-loop by adding `---` phase separators. Each phase has its own frames and movement keyframes, composited into a single seamless CSS loop. Phase keyframes are relative to that phase (0% = phase start, 100% = phase end).

```
:::anim width=75% height=50% bg=echo://img/parallaxes/backgrounds_66.png?crop bgopacity=1
--- duration=2.1s fps=4 spritesize=56
echo://img/characters/sheet.png?sprite=12,8,24
echo://img/characters/sheet.png?sprite=12,8,25
echo://img/characters/sheet.png?sprite=12,8,26
echo://img/characters/sheet.png?sprite=12,8,25
0% left=8px bottom=24px
100% left="calc(100% - 64px)" bottom=24px
--- duration=2.1s fps=4 spritesize=56
echo://img/characters/sheet.png?sprite=12,8,12
echo://img/characters/sheet.png?sprite=12,8,13
echo://img/characters/sheet.png?sprite=12,8,14
echo://img/characters/sheet.png?sprite=12,8,13
0% left="calc(100% - 64px)" bottom=24px
100% left=8px bottom=24px
:::
```

Phase params (`fps`, `spritesize`, `loops`, `duration`, `hold`) go on the `---` line. Global params (`width`, `height`, `bg`, etc.) go on the `:::anim` line. By default (`hold`) each phase's walk is snapped to a whole number of cycles that exactly fills its movement, so the sprite always faces the way it's walking and a phase never advances to the next `---` block mid-stride.

---

*Back to [Index](/r/echo_wiki_dev/wiki/index)*
