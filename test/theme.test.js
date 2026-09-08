import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeColor,
  toCss,
  mix,
  relativeLuminance,
  contrastRatio,
  isDark,
  readableOn,
  deriveTokens,
  applyTheme
} from '../src/theme.js';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

/** Firefox's built-in Dark theme reports colours in this shape. */
const FIREFOX_DARK = {
  popup: '#42414d',
  popup_text: '#fbfbfe',
  popup_border: '#52525e',
  popup_highlight: '#0060df',
  popup_highlight_text: '#ffffff',
  toolbar: '#2b2a33',
  frame: '#1c1b22'
};

const FIREFOX_LIGHT = {
  popup: '#ffffff',
  popup_text: '#15141a',
  popup_border: '#cfcfd8',
  toolbar: '#f9f9fb',
  frame: '#f0f0f4'
};

/** Minimal stand-in for documentElement. */
function fakeRoot() {
  const props = new Map();
  return {
    dataset: {},
    style: {
      colorScheme: '',
      setProperty: (k, v) => props.set(k, v),
      set cssText(_) {
        props.clear();
        this.colorScheme = '';
      },
      get cssText() {
        return '';
      }
    },
    props,
    removeAttribute(name) {
      if (name === 'data-theme') delete this.dataset.theme;
    }
  };
}

/* ── Colour parsing ── */

test('parses 6- and 8-digit hex', () => {
  assert.deepEqual(normalizeColor('#0060df'), { r: 0, g: 96, b: 223, a: 1 });
  assert.deepEqual(normalizeColor('#00000080').a, 128 / 255);
});

test('parses shorthand hex', () => {
  assert.deepEqual(normalizeColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(normalizeColor('#0f08').r, 0);
  assert.equal(normalizeColor('#0f08').g, 255);
});

test('parses rgb() and rgba(), including the slash form', () => {
  assert.deepEqual(normalizeColor('rgb(66, 65, 77)'), { r: 66, g: 65, b: 77, a: 1 });
  assert.deepEqual(normalizeColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(normalizeColor('rgb(1 2 3 / 0.25)'), { r: 1, g: 2, b: 3, a: 0.25 });
});

test('parses the array form themes may use', () => {
  assert.deepEqual(normalizeColor([12, 34, 56]), { r: 12, g: 34, b: 56, a: 1 });
  assert.deepEqual(normalizeColor([12, 34, 56, 0.5]), { r: 12, g: 34, b: 56, a: 0.5 });
});

test('rejects junk instead of guessing', () => {
  for (const bad of [null, undefined, '', 'not-a-colour', '#12345', {}, [1, 2], [1, 2, 'x']]) {
    assert.equal(normalizeColor(bad), null, JSON.stringify(bad));
  }
});

test('toCss round-trips and clamps', () => {
  assert.equal(toCss({ r: 0, g: 96, b: 223 }), 'rgb(0, 96, 223)');
  assert.equal(toCss({ r: 0, g: 0, b: 0, a: 0.5 }), 'rgba(0, 0, 0, 0.5)');
  assert.equal(toCss({ r: 300, g: -20, b: 12.6 }), 'rgb(255, 0, 13)');
});

/* ── Colour maths ── */

test('mix interpolates and clamps its weight', () => {
  assert.deepEqual(mix(BLACK, WHITE, 0.5), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.deepEqual(mix(BLACK, WHITE, 0), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(mix(BLACK, WHITE, 2), { r: 255, g: 255, b: 255, a: 1 });
});

test('relative luminance matches the WCAG reference points', () => {
  assert.equal(relativeLuminance(WHITE), 1);
  assert.equal(relativeLuminance(BLACK), 0);
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 0, b: 0 }) - 0.2126) < 1e-9);
});

test('contrast ratio is symmetric and spans 1 to 21', () => {
  assert.ok(Math.abs(contrastRatio(BLACK, WHITE) - 21) < 1e-9);
  assert.equal(contrastRatio(WHITE, WHITE), 1);
  assert.equal(contrastRatio(BLACK, WHITE), contrastRatio(WHITE, BLACK));
});

test('isDark agrees with the Firefox palettes', () => {
  for (const c of ['#42414d', '#2b2a33', '#1c1b22', '#000000']) {
    assert.ok(isDark(normalizeColor(c)), c);
  }
  for (const c of ['#ffffff', '#f9f9fb', '#f0f0f4']) {
    assert.ok(!isDark(normalizeColor(c)), c);
  }
});

/* ── Token derivation ── */

test('the default theme yields no tokens, leaving CSS in charge', () => {
  assert.equal(deriveTokens(undefined), null);
  assert.equal(deriveTokens({}), null);
  assert.equal(deriveTokens({ images: {} }), null);
});

test("Firefox's Dark theme derives a dark token set", () => {
  const { dark, tokens } = deriveTokens(FIREFOX_DARK);
  assert.equal(dark, true);
  assert.deepEqual(tokens['--bg'], { r: 66, g: 65, b: 77, a: 1 });
  assert.deepEqual(tokens['--text'], { r: 251, g: 251, b: 254, a: 1 });
  assert.deepEqual(tokens['--accent'], { r: 0, g: 96, b: 223, a: 1 });
  assert.deepEqual(tokens['--accent-text'], { r: 255, g: 255, b: 255, a: 1 });
  // #0060df on #42414d is only 1.77:1 — fine for a filled button, useless as
  // a focus ring, so that token falls back to the text colour.
  assert.ok(contrastRatio(tokens['--accent'], tokens['--bg']) < 3);
  assert.deepEqual(tokens['--focus-ring'], tokens['--text']);
  // The raised surface must actually lift off the popup background.
  assert.ok(relativeLuminance(tokens['--bg-raised']) > relativeLuminance(tokens['--bg']));
});

test("Firefox's Light theme derives a light token set", () => {
  const { dark, tokens } = deriveTokens(FIREFOX_LIGHT);
  assert.equal(dark, false);
  assert.deepEqual(tokens['--bg'], { r: 255, g: 255, b: 255, a: 1 });
  assert.ok(contrastRatio(tokens['--text'], tokens['--bg']) > 4.5);
});

test('falls back to toolbar, then frame, when there is no popup colour', () => {
  assert.deepEqual(deriveTokens({ toolbar: '#2b2a33' }).tokens['--bg'], { r: 43, g: 42, b: 51, a: 1 });
  assert.deepEqual(deriveTokens({ frame: '#1c1b22' }).tokens['--bg'], { r: 28, g: 27, b: 34, a: 1 });
});

test('unreadable theme text is replaced rather than obeyed', () => {
  // A custom theme setting near-black text on a near-black popup.
  const { tokens } = deriveTokens({ popup: '#101010', popup_text: '#181818' });
  assert.ok(contrastRatio(tokens['--text'], tokens['--bg']) >= 4.5);
  assert.deepEqual(tokens['--text'], { r: 255, g: 255, b: 255, a: 1 });
});

test('derived text always clears AA against its background', () => {
  const themes = [
    { popup: '#ffffff', popup_text: '#eeeeee' },
    { popup: '#000000', popup_text: '#111111' },
    { popup: '#7f7f7f' },
    { popup: '#767676' },
    { popup: '#8a8a8a' },
    { popup: '#0060df', popup_text: '#0a84ff' }
  ];
  for (const colors of themes) {
    const { tokens } = deriveTokens(colors);
    assert.ok(
      contrastRatio(tokens['--text'], tokens['--bg']) >= 4.5,
      `${JSON.stringify(colors)} -> ${toCss(tokens['--text'])}`
    );
  }
});

test('a low-contrast accent is dropped so the stylesheet default survives', () => {
  // Accent nearly identical to the background: adopting it would make the
  // primary button vanish.
  const { tokens } = deriveTokens({ popup: '#2b2a33', popup_text: '#ffffff', popup_highlight: '#2c2b34' });
  assert.equal(tokens['--accent'], undefined);
  assert.equal(tokens['--accent-text'], undefined);
  assert.equal(tokens['--focus-ring'], undefined);
});

test('readableOn picks the better of black and white, not the palette default', () => {
  // Mid grey is "dark" by luminance, yet black text beats white on it.
  const grey = normalizeColor('#7f7f7f');
  assert.ok(isDark(grey));
  assert.deepEqual(readableOn(grey), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(readableOn(normalizeColor('#1c1b22')), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(readableOn(normalizeColor('#ffffff')), { r: 0, g: 0, b: 0, a: 1 });
});

test('readableOn clears AA at every luminance, including the crossover', () => {
  // The worst case is the grey where black and white are equally readable;
  // sweeping the whole range proves no background falls through the gap.
  let worst = Infinity;
  for (let v = 0; v <= 255; v++) {
    const bg = { r: v, g: v, b: v, a: 1 };
    worst = Math.min(worst, contrastRatio(readableOn(bg), bg));
  }
  assert.ok(worst >= 4.5, `worst contrast over the grey ramp was ${worst.toFixed(3)}`);
});

test('a bright accent keeps the focus ring on the accent', () => {
  const { tokens } = deriveTokens({
    popup: '#2b2a33',
    popup_text: '#fbfbfe',
    popup_highlight: '#00ddff'
  });
  assert.ok(contrastRatio(tokens['--accent'], tokens['--bg']) >= 3);
  assert.deepEqual(tokens['--focus-ring'], tokens['--accent']);
});

test('accent text is forced readable when the theme supplies a bad one', () => {
  const { tokens } = deriveTokens({
    popup: '#ffffff',
    popup_text: '#000000',
    popup_highlight: '#0060df',
    popup_highlight_text: '#0a84ff'
  });
  assert.ok(contrastRatio(tokens['--accent-text'], tokens['--accent']) >= 4.5);
});

/* ── Applying to the document ── */

test('applyTheme sets data-theme, color-scheme and the custom properties', () => {
  const root = fakeRoot();
  assert.equal(applyTheme(root, { colors: FIREFOX_DARK }), true);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(root.props.get('--bg'), 'rgb(66, 65, 77)');
  assert.equal(root.props.get('--text'), 'rgb(251, 251, 254)');
});

test('applyTheme reverts to stylesheet control for the default theme', () => {
  const root = fakeRoot();
  applyTheme(root, { colors: FIREFOX_DARK });
  assert.equal(applyTheme(root, {}), false);
  assert.equal(root.dataset.theme, undefined);
  assert.equal(root.props.size, 0);
  assert.equal(root.style.colorScheme, '');
});

test('switching themes does not leak tokens from the previous one', () => {
  const root = fakeRoot();

  // Dark theme first: its dim accent pushes the focus ring onto the text colour.
  applyTheme(root, { colors: FIREFOX_DARK });
  assert.equal(root.props.get('--focus-ring'), 'rgb(251, 251, 254)');

  // Then a light theme with no highlight colour of its own. The near-white
  // focus ring must not survive onto a white popup.
  applyTheme(root, { colors: FIREFOX_LIGHT });
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.props.get('--bg'), 'rgb(255, 255, 255)');
  assert.equal(root.props.has('--focus-ring'), false);
  assert.equal(root.props.has('--accent'), false);
});

test('a saturated theme is classified by its text, not its background', () => {
  // Hot pink is dark by luminance, but black text reads better on it, so the
  // light palette (and a light color-scheme for native widgets) is correct.
  const root = fakeRoot();
  applyTheme(root, { colors: { popup: '#ff2f92', popup_text: '#ff59a8' } });
  assert.equal(root.props.get('--text'), 'rgb(0, 0, 0)');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.colorScheme, 'light');

  const { dark, tokens } = deriveTokens({ popup: '#ff2f92', popup_text: '#ff59a8' });
  assert.equal(dark, false);
  assert.ok(contrastRatio(tokens['--text'], tokens['--bg']) >= 4.5);
});

test('data-theme always agrees with the text colour being painted', () => {
  const backgrounds = ['#ffffff', '#f9f9fb', '#42414d', '#1c1b22', '#7f7f7f', '#ff2f92', '#ffe600', '#003b6f'];
  for (const popup of backgrounds) {
    const { dark, tokens } = deriveTokens({ popup });
    const textIsLight = relativeLuminance(tokens['--text']) > relativeLuminance(tokens['--bg']);
    assert.equal(dark, textIsLight, `${popup} -> text ${toCss(tokens['--text'])}`);
  }
});

test('the error colour keeps its red only while the red stays legible', () => {
  // Firefox's own themes: the matching Photon red survives.
  assert.deepEqual(deriveTokens(FIREFOX_LIGHT).tokens['--danger'], { r: 197, g: 0, b: 66, a: 1 });
  assert.deepEqual(deriveTokens(FIREFOX_DARK).tokens['--danger'], { r: 255, g: 154, b: 162, a: 1 });

  // Hot pink: neither red is readable, so the error falls back to the text
  // colour rather than disappearing into the background.
  const { tokens } = deriveTokens({ popup: '#ff2f92', popup_text: '#ff59a8' });
  assert.deepEqual(tokens['--danger'], tokens['--text']);
  assert.ok(contrastRatio(tokens['--danger'], tokens['--bg']) >= 4.5);
});

test('the error colour is readable on every background', () => {
  const backgrounds = ['#ffffff', '#f9f9fb', '#42414d', '#1c1b22', '#7f7f7f', '#ff2f92', '#ffe600', '#003b6f', '#c50042'];
  for (const popup of backgrounds) {
    const { tokens } = deriveTokens({ popup });
    assert.ok(
      contrastRatio(tokens['--danger'], tokens['--bg']) >= 4.5,
      `${popup} -> danger ${toCss(tokens['--danger'])}`
    );
  }
});

test('applyTheme survives a missing or malformed theme object', () => {
  for (const theme of [undefined, null, {}, { colors: null }, { colors: 'nope' }]) {
    const root = fakeRoot();
    assert.equal(applyTheme(root, theme), false);
    assert.equal(root.dataset.theme, undefined);
  }
});
