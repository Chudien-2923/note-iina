# Note IINA interface

The visual authority is IINA/macOS and the product requirements in `PRODUCT.md`. The sidebar is an **Operate** surface; the course notebook is a **Read** surface. Native controls and minimal distraction take precedence over branding.

## Surface structure

- Sidebar: actual lesson name and course action; host status/errors and course selection when needed; recovery choices; timestamped lesson notes; multiline draft editor and explicit Save.
- Notebook: actual course name and content search; full relative lesson paths with note counts; host-filtered results grouped in host-provided order. Duplicate video basenames remain distinguishable.
- The host owns sidebar position, window chrome, video playback, folder selection, deletion confirmation, timestamps and durable storage. The HTML does not draw a player or simulated macOS window.
- Empty states explain the real next action. No sample notes, illustrative course data, network assets or browser persistence are included.

## Typography and spacing

System stack: `-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`. Base 13px; headings 15px at the top level; reader note text 14px with generous line height. Timestamps and note counts use tabular numerals. Reader content is limited to 72ch. Plain note text preserves line breaks and wraps long Vietnamese words/paths instead of truncating content.

Controls use small 5px corners and a restrained 1px separator. Layout spacing is primarily 4, 6, 8, 12, 16, 20 and 28px. No nested cards, display typography, decorative illustrations, gradients, slogans or page-entry motion.

## Color tokens

All tokens live in `note-iina.iinaplugin/ui/shared.css`. Host appearance overrides system appearance; system media queries work before the first host state. A valid host accent color overrides the default accent.

| Role | Light | Dark |
| --- | --- | --- |
| Content background | `#ffffff` | `#202020` |
| Toolbar/navigation background | `#f3f3f3` | `#292929` |
| Input background | `#ffffff` | `#181818` |
| Primary text | `#202020` | `#eeeeee` |
| Secondary text | `#626262` | `#b4b4b4` |
| Separator | `#d1d1d1` | `#4c4c4c` |
| Hover | `#e7e7e7` | `#3b3b3b` |
| Selected | `#dedede` | `#454545` |
| Default accent | `#0069d9` | `#78b7ff` |
| Error text | `#b42318` | `#ff9b91` |
| Text selection | `#b9d9ff` | `#285784` |

Accent belongs to focus, selected-path underline, timestamps and primary action text. Scrollbars retain the host platform's native rendering. Focus outlines are explicit; disabled controls are visually distinct; errors and save/draft status are accessible live text.

## Interaction boundaries

Only non-composing Command-Enter saves from a textarea. Ordinary N, Space and Enter remain text input. Escape sends `close-sidebar` only inside the sidebar; the notebook installs no Escape interception. The host implements the player's N shortcut.

The shared draft tracker protects pending local input from older echoes and save acknowledgements. Unchanged textarea values are never reassigned; selection and scroll are preserved when an accepted same-lesson state changes the text. Inline edit rows retain their actual textarea across unrelated state updates. Saving feedback alone never clears text: only authoritative host state does. Search and lesson filtering are delegated to the host, not duplicated in the DOM.

## Small surfaces

The sidebar scrolls vertically and limits the existing-note region so a long lesson does not bury the editor. Controls wrap rather than force horizontal scrolling. A narrow notebook places lesson navigation above the reader, with bounded navigation height and independently scrollable reading content. Small-height rules reduce chrome/editor height without hiding actions. Reduced-motion preference is respected; no animation is required for use.

## Verification status

These are implementation decisions, not proof of every native scenario. Version 1.0.1 has user confirmation in IINA; see README for specific exercised paths. Full light/dark, narrow/small-height, fullscreen and Vietnamese IME composition coverage remains uncertified.
