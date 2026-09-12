# Passmint

A Firefox extension that generates strong passwords and passphrases, with enough
knobs to satisfy whatever arbitrary rules the site you're signing up for has
decided on today.

Everything happens in the popup. There is no background script, no network
access, and no telemetry — the extension requests three permissions, all of
them local: `storage` for your settings, `clipboardWrite` for the copy button,
and `theme` to read the colours of your current Firefox theme. None of the
three carry an install-time warning, and `theme` is read-only.

## Features

**Two modes**

- **Password** — random characters from the classes you enable.
- **Passphrase** — words drawn from a bundled 2,569-word list (~11.3 bits per
  word), with a separator, capitalisation, and optional number/symbol.

**Complexity controls**

| Option | What it does |
| --- | --- |
| Length | 4–128 characters (2–12 words in passphrase mode) |
| Character classes | Uppercase, lowercase, numbers, symbols — any combination |
| Symbol set | Standard (`!@#$%^&*()-_=+[]{};:,.<>?/~`), Safe (`!@#$%^&*()-_=+`), or your own |
| Include one of each | Guarantees at least one character from every enabled class |
| Avoid look-alikes | Drops `Il1O0oB8S5Z2G6q9` and friends for anything you have to read aloud or retype |
| No repeated characters | Samples without replacement |
| Never use | A free-text blocklist for sites that reject specific characters |

**Presets** — PIN, Readable, Strong, and Paranoid, for when you don't want to
think about it.

**Live strength meter** — shows the actual entropy in bits and the time to
brute force at a trillion guesses per second. The estimate is computed from the
real keyspace (`length × log₂(pool)`, or `words × log₂(2569)`), not from a
heuristic that counts how many character types you used.

## Native theming

The popup is painted in Firefox's own Photon palette and set in the OS UI font
(`font: message-box`), so it reads as part of the browser rather than as a web
page embedded in it. Colours resolve through three layers, each a fallback for
the one above:

1. **`browser.theme.getCurrent()`** — the colours of the theme actually in use,
   including custom ones from addons.mozilla.org. This is the only source that
   knows about a theme you picked by hand, and `theme.onUpdated` keeps the
   popup in step if you switch themes while it is open.
2. **`prefers-color-scheme`** — used when the default system theme is active,
   in which case `getCurrent()` reports no colours at all.
3. **The Photon palette in `popup.css`** — for anything the above cannot answer.

Because a browser theme can disagree with the OS setting (Firefox dark on a
light desktop, say), layer 1 wins by setting `data-theme` and `color-scheme` on
the root element, which steers both the stylesheet's dark palette and Firefox's
native widgets — scrollbars, checkboxes, the range thumb.

The toolbar icon is a separate monochrome SVG that paints with `context-fill`,
so Firefox tints it with the same colour as its own toolbar icons and it
inverts by itself on a dark toolbar.

### Waterfox Nova, and choosing the look yourself

In Waterfox, the popup switches to a second style modelled on Waterfox's
**Nova** look: pill-shaped controls, rounder cards, Nova's own light and dark
palettes, and an accent drawn from Waterfox's twelve theme colours (Default,
Smoke, Ash, Sun, Spark, Flame, Flare, Lavender, Dusk, Lagoon, Tide, Pine).
Detection uses `runtime.getBrowserInfo()`, which needs no permission.

The **Appearance** button (the half-filled circle next to the mode tabs) opens
a panel to override all of it:

| Setting | Options |
| --- | --- |
| Style | **Auto** (Nova in Waterfox, Firefox everywhere else), Firefox, Waterfox |
| Mode | **System** (follow the browser theme, then the OS), Light, Dark |
| Theme color | Waterfox's twelve, shown when the Waterfox style is active |

The popup can't detect which theme colour you picked in Waterfox's settings,
so that one is chosen by hand. In dark mode each accent is the pastel Waterfox
shows on its swatch; in light mode it is a deeper shade of the same hue, since
a pastel checkbox or focus ring barely shows on a light background. Tests hold
every colour to 4.5:1 for its text and 3:1 for its focus ring, in both modes.

The Nova style follows the browser's light/dark state but not a theme's
individual colours, because Nova is a complete palette of its own. The Firefox
style keeps adopting theme colours as described above. A forced Light or Dark
ignores the browser theme entirely.

To stop the popup opening in the default look and then visibly switching, a
small synchronous script (`popup/boot.js`) repaints the last look from a local
cache before first paint; the real lookups then confirm or correct it.

### Themes are untrusted input

A theme's colours are whatever its author typed, so they are treated as
suggestions and checked before use:

- **Text** is adopted only if it clears 4.5:1 against the popup background it
  will sit on. Otherwise it is replaced with whichever of black or white reads
  better — never worse than 4.58:1, since that is where the two cross over.
- **Light or dark** is decided by whether the text is lighter than the
  background, not by whether the background merely looks dark. A saturated
  theme parts the two: a hot pink popup is dark by luminance, but black reads
  better on it, and calling it dark would hand the stylesheet its pale-pink
  error colour to paint onto pink.
- **The accent** fills the primary button, so it only has to be
  distinguishable (1.5:1). Firefox's own Dark theme puts `#0060df` on a
  `#42414d` popup, which is 1.77:1 — a stricter bar would throw the native
  accent away.
- **The focus ring** is held to 3:1 (WCAG 1.4.11) and falls back to the text
  colour when the accent is too dim, which is exactly what happens with that
  Firefox Dark pairing.
- **The error message** keeps its red only while the red stays legible; on a
  background where neither Photon red works, it falls back to the text colour.
  Losing the hue beats an unreadable explanation of why nothing generated.

Every one of those rules has a test, including a sweep of the entire grey ramp
confirming the contrast guarantee holds at all 256 luminances.

## Randomness

Every random choice goes through `crypto.getRandomValues()` with rejection
sampling:

```js
const limit = Math.floor(0x100000000 / max) * max;
let value;
do {
  crypto.getRandomValues(buf);
  value = buf[0];
} while (value >= limit);
return value % max;
```

Drawing a `uint32` and taking `% max` directly would make the low values
slightly more likely whenever `max` doesn't divide 2³² evenly. Discarding the
top partial block removes that bias. `Math.random()` is never used, and neither
is character order — the final password is shuffled with Fisher-Yates over the
same CSPRNG so that the "include one of each class" pass doesn't pin those
characters to the front.

## Install

### From source, temporarily

1. Clone this repo.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. **Load Temporary Add-on…** → pick `manifest.json`.

The add-on stays until you restart Firefox.

### From source, permanently

Temporary add-ons are unsigned, and release Firefox won't keep unsigned
extensions installed. To install permanently you can either:

- Use [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/) or
  Nightly and set `xpinstall.signatures.required` to `false` in `about:config`,
  then install the built `.xpi`; or
- Sign it yourself for free through
  [addons.mozilla.org](https://addons.mozilla.org/developers/) (unlisted
  self-distribution is fine — you don't have to publish it).

Build the `.xpi` with:

```bash
npm install
npm run build
```

The package lands in `web-ext-artifacts/`.

## Development

```bash
npm install
npm test          # 67 unit tests, node:test, no browser needed
npm run lint      # web-ext lint against the Mozilla add-on rules
npm start         # launch a scratch Firefox profile with the add-on loaded
```

The generator is a plain ES module with no extension APIs in it
([`src/generator.js`](src/generator.js)), and the theming logic keeps its
colour maths pure for the same reason ([`src/theme.js`](src/theme.js)), so the
test suite runs both directly under Node. The popup ([`popup/`](popup/)) is the
only part that touches `browser.*`, and it degrades to in-memory defaults when
storage or the theme API is unavailable.

```
manifest.json         MV3 manifest (Firefox 140+, Android 142+)
popup/                popup.html, popup.css, popup.js
src/generator.js      generation, entropy, strength — no browser APIs
src/theme.js          browser theme -> CSS custom properties
src/appearance.js     style/mode/accent choice, Waterfox detection
popup/boot.js         repaints the cached look before first paint
src/wordlist.js       passphrase wordlist
icons/toolbar.svg     monochrome toolbar icon, tinted by Firefox
test/                 node:test suite
```

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl` + `Space` | Generate a new one |
| `Ctrl` / `Cmd` + `C` | Copy (when nothing is selected) |

## License

MIT — see [LICENSE](LICENSE).
