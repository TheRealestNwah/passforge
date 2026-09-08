# Passforge

A Firefox extension that generates strong passwords and passphrases, with enough
knobs to satisfy whatever arbitrary rules the site you're signing up for has
decided on today.

Everything happens in the popup. There is no background script, no network
access, and no telemetry — the extension requests exactly two permissions
(`storage` for your settings, `clipboardWrite` for the copy button).

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
npm test          # 21 unit tests, node:test, no browser needed
npm run lint      # web-ext lint against the Mozilla add-on rules
npm start         # launch a scratch Firefox profile with the add-on loaded
```

The generator is a plain ES module with no extension APIs in it
([`src/generator.js`](src/generator.js)), so the test suite runs it directly
under Node. The popup ([`popup/`](popup/)) is the only part that touches
`browser.*`, and it degrades to in-memory defaults when storage is unavailable.

```
manifest.json         MV3 manifest (Firefox 109+)
popup/                popup.html, popup.css, popup.js
src/generator.js      generation, entropy, strength — no browser APIs
src/wordlist.js       passphrase wordlist
test/                 node:test suite
```

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl` + `Space` | Generate a new one |
| `Ctrl` / `Cmd` + `C` | Copy (when nothing is selected) |

## License

MIT — see [LICENSE](LICENSE).
