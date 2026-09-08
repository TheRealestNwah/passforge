/**
 * Native Firefox theming.
 *
 * Three layers, each a fallback for the one above it:
 *
 *   1. `browser.theme.getCurrent()` — the colours of the theme actually in
 *      use, including custom ones from addons.mozilla.org. This is the only
 *      source that knows about a theme the user picked by hand.
 *   2. `prefers-color-scheme` — used when the default (system) theme is
 *      active, in which case `getCurrent()` reports no colours at all.
 *   3. The Photon palette baked into popup.css.
 *
 * Everything below the `applyBrowserTheme` entry point is pure colour maths so
 * that it can be tested under Node without a browser.
 */

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

/** Below this relative luminance we treat a background as dark. */
const DARK_THRESHOLD = 0.4;

/** WCAG AA for body text. A theme that cannot clear it gets its text ignored. */
const MIN_TEXT_CONTRAST = 4.5;

/*
 * The accent fills the primary button and the active tab. A filled surface
 * only has to be *distinguishable* from the panel behind it, so the bar here
 * is deliberately low: Firefox's own Dark theme puts #0060df on a #42414d
 * popup, which is 1.77:1, and rejecting that would mean throwing away the
 * native accent in favour of our stylesheet default.
 */
const MIN_ACCENT_CONTRAST = 1.5;

/*
 * A focus indicator is held to a real standard (WCAG 1.4.11), and a dim accent
 * makes a useless one. When the accent cannot clear this, the focus ring falls
 * back to the text colour instead.
 */
const MIN_FOCUS_CONTRAST = 3;

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB_FN = /^rgba?\(\s*([^)]+)\)$/i;

/**
 * Theme colours arrive either as a CSS string or as an [r, g, b] / [r, g, b, a]
 * array, depending on how the theme author wrote their manifest.
 */
export function normalizeColor(input) {
  if (!input) return null;

  if (Array.isArray(input)) {
    const [r, g, b, a = 1] = input;
    return [r, g, b].every((n) => Number.isFinite(n)) ? { r, g, b, a } : null;
  }

  if (typeof input !== 'string') return null;
  const value = input.trim();

  const hex = HEX.exec(value);
  if (hex) {
    let digits = hex[1];
    // #rgb and #rgba are shorthand for doubled digits.
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((d) => d + d).join('');
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    const n = (i) => parseInt(digits.slice(i, i + 2), 16);
    return {
      r: n(0),
      g: n(2),
      b: n(4),
      a: digits.length === 8 ? n(6) / 255 : 1
    };
  }

  const fn = RGB_FN.exec(value);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    const [r, g, b, a = 1] = parts;
    return { r, g, b, a: Number.isFinite(a) ? a : 1 };
  }

  return null;
}

export function toCss({ r, g, b, a = 1 }) {
  const round = (n) => Math.round(Math.min(255, Math.max(0, n)));
  return a >= 1
    ? `rgb(${round(r)}, ${round(g)}, ${round(b)})`
    : `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${Number(a.toFixed(3))})`;
}

/** Blend `weight` of `overlay` into `base` (0 = all base, 1 = all overlay). */
export function mix(base, overlay, weight) {
  const t = Math.min(1, Math.max(0, weight));
  return {
    r: base.r + (overlay.r - base.r) * t,
    g: base.g + (overlay.g - base.g) * t,
    b: base.b + (overlay.b - base.b) * t,
    a: 1
  };
}

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isDark(color) {
  return relativeLuminance(color) < DARK_THRESHOLD;
}

/**
 * Whichever of black or white reads better on `bg`.
 *
 * Note this is a separate question from `isDark`, which picks a *palette*.
 * A mid grey like #7f7f7f sits below the dark threshold, yet black text on it
 * beats white (5.28:1 against 3.98:1) — so the two must be decided apart.
 *
 * The worse of the two choices is never far behind: the crossover, where black
 * and white are equally readable, sits at 4.58:1, so taking the better one
 * always clears WCAG AA for body text no matter what background a theme sends.
 */
export function readableOn(bg) {
  return contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? WHITE : BLACK;
}

/** The error reds from popup.css, so a theme can be checked against both. */
const DANGER_LIGHT = { r: 197, g: 0, b: 66, a: 1 };
const DANGER_DARK = { r: 255, g: 154, b: 162, a: 1 };

/**
 * The first candidate readable on `bg`, else `fallback`.
 *
 * For text whose colour carries meaning: losing the hue beats rendering an
 * error message that cannot be read against a saturated theme.
 */
export function pickReadable(bg, candidates, fallback) {
  for (const candidate of candidates) {
    if (contrastRatio(candidate, bg) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return fallback;
}

/** First value that parses into a colour, else null. */
function firstColor(...candidates) {
  for (const candidate of candidates) {
    const color = normalizeColor(candidate);
    if (color) return color;
  }
  return null;
}

/**
 * Turn a theme's `colors` object into CSS custom properties.
 *
 * Returns `null` when the theme carries no usable background — which is what
 * the default system theme reports — so the caller can leave the stylesheet's
 * own `prefers-color-scheme` handling alone.
 */
export function deriveTokens(colors) {
  if (!colors || typeof colors !== 'object') return null;

  // A popup colour is ideal; a themed toolbar or window frame is a good
  // stand-in, since that is the chrome the popup visually hangs off.
  const bg = firstColor(colors.popup, colors.toolbar, colors.frame);
  if (!bg) return null;

  // Trust the theme's text colour only if it is actually readable on its own
  // background — custom themes are not always careful about this.
  let text = firstColor(colors.popup_text, colors.toolbar_text, colors.tab_background_text);
  if (!text || contrastRatio(text, bg) < MIN_TEXT_CONTRAST) text = readableOn(bg);

  /*
   * A theme is "dark" when its text is lighter than its background, rather
   * than whenever the background alone looks dark. The two part company on
   * saturated themes: a hot pink popup falls under the dark luminance
   * threshold, yet black text reads better on it, and calling that dark would
   * hand the stylesheet its dark error colour — pale pink on pink. Deriving
   * the answer from the text keeps every palette token agreeing with the
   * colour actually being painted over it.
   */
  const dark = relativeLuminance(text) > relativeLuminance(bg);
  const far = dark ? WHITE : BLACK;

  const border = firstColor(colors.popup_border, colors.toolbar_field_border) ?? mix(bg, text, 0.22);

  const tokens = {
    '--bg': bg,
    '--bg-sunken': mix(bg, text, dark ? 0.06 : 0.04),
    '--bg-raised': dark ? mix(bg, WHITE, 0.07) : bg,
    '--border': border,
    '--border-strong': mix(bg, text, 0.42),
    '--text': text,
    '--text-muted': mix(bg, text, 0.68),
    '--button-bg': mix(bg, text, dark ? 0.1 : 0.06),
    '--surface-hover': mix(bg, text, dark ? 0.18 : 0.1),
    '--surface-active': mix(bg, text, dark ? 0.26 : 0.16),

    // The error message is the only way the user learns why nothing was
    // generated, so it keeps its red only while that red stays legible.
    '--danger': pickReadable(
      bg,
      dark ? [DANGER_DARK, DANGER_LIGHT] : [DANGER_LIGHT, DANGER_DARK],
      text
    )
  };

  // The accent fills the primary button and the active tab.
  const accent = firstColor(colors.popup_highlight, colors.tab_line, colors.icons_attention);
  if (accent && contrastRatio(accent, bg) >= MIN_ACCENT_CONTRAST) {
    const supplied = normalizeColor(colors.popup_highlight_text);
    const accentText =
      supplied && contrastRatio(supplied, accent) >= MIN_TEXT_CONTRAST
        ? supplied
        : readableOn(accent);

    tokens['--accent'] = accent;
    tokens['--accent-text'] = accentText;
    tokens['--accent-hover'] = mix(accent, far, 0.15);
    tokens['--accent-active'] = mix(accent, far, 0.3);

    // A dim accent makes an invisible focus ring, so that one token holds out
    // for real contrast and drops back to the text colour otherwise.
    tokens['--focus-ring'] =
      contrastRatio(accent, bg) >= MIN_FOCUS_CONTRAST ? accent : text;
  }

  return { dark, tokens };
}

/**
 * Read the active browser theme and paint it onto `root`.
 *
 * Also sets `data-theme` and `color-scheme`, so that the stylesheet's dark
 * palette and Firefox's own native widgets (scrollbars, checkboxes, the range
 * thumb) follow the browser theme even when it disagrees with the OS setting.
 */
export function applyTheme(root, theme) {
  const derived = deriveTokens(theme?.colors);

  /*
   * Wipe first, always. A theme only overrides the tokens it has colours for,
   * so without this the leftovers from the previous theme survive underneath
   * the new one — switching from a dark theme to a light one that supplies no
   * highlight colour would keep the dark theme's near-white focus ring and
   * paint it onto a white popup. onUpdated makes that a live code path, not a
   * hypothetical.
   */
  root.style.cssText = '';

  if (!derived) {
    // Default theme: hand control back to `prefers-color-scheme`.
    root.removeAttribute('data-theme');
    return false;
  }

  root.dataset.theme = derived.dark ? 'dark' : 'light';
  root.style.colorScheme = derived.dark ? 'dark' : 'light';
  for (const [name, color] of Object.entries(derived.tokens)) {
    root.style.setProperty(name, toCss(color));
  }
  return true;
}

/**
 * Apply the current theme and keep following it. Safe to call anywhere: if the
 * theme API is missing (no permission, or a non-Firefox browser) this is a
 * no-op and the stylesheet's own light/dark handling takes over.
 */
export async function applyBrowserTheme(root) {
  const themeApi = globalThis.browser?.theme ?? globalThis.chrome?.theme;
  if (!themeApi?.getCurrent) return false;

  try {
    const applied = applyTheme(root, await themeApi.getCurrent());
    // Fires when the user switches themes while the popup is open.
    themeApi.onUpdated?.addListener((info) => applyTheme(root, info?.theme));
    return applied;
  } catch {
    return false;
  }
}
