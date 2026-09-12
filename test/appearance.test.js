import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACCENTS,
  ACCENT_TEXT,
  APPEARANCE_DEFAULTS,
  NOVA_SURFACES,
  accentTokens,
  applyAppearance,
  isWaterfox,
  resolveStyle,
  sanitizePrefs,
  takeSnapshot
} from '../src/appearance.js';
import { contrastRatio, normalizeColor } from '../src/theme.js';

const CSS = readFileSync(new URL('../popup/popup.css', import.meta.url), 'utf8');

const FIREFOX_DARK = {
  popup: '#42414d',
  popup_text: '#fbfbfe',
  popup_highlight: '#0060df',
  popup_highlight_text: '#ffffff'
};

/** Minimal stand-in for documentElement. */
function fakeRoot() {
  const props = new Map();
  const root = {
    dataset: {},
    props,
    style: {
      colorScheme: '',
      setProperty: (k, v) => props.set(k, v),
      set cssText(_) {
        props.clear();
        this.colorScheme = '';
      },
      get cssText() {
        return [...props].map(([k, v]) => `${k}: ${v};`).join(' ');
      }
    },
    removeAttribute(name) {
      if (name === 'data-theme') delete root.dataset.theme;
    }
  };
  return root;
}

const c = (value) => normalizeColor(value);

/** The declarations inside the first rule whose selector is exactly `selector`. */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

function declarations(body) {
  return Object.fromEntries(
    [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [
      k,
      v.trim()
    ])
  );
}

/* ── Preferences and style resolution ── */

test('auto resolves to Nova in Waterfox and Photon anywhere else', () => {
  assert.equal(resolveStyle('auto', 'Waterfox'), 'nova');
  assert.equal(resolveStyle('auto', 'waterfox'), 'nova');
  assert.equal(resolveStyle('auto', 'Firefox'), 'photon');
  assert.equal(resolveStyle('auto', ''), 'photon');
  assert.equal(resolveStyle('auto', undefined), 'photon');
});

test('an explicit style wins over detection', () => {
  assert.equal(resolveStyle('photon', 'Waterfox'), 'photon');
  assert.equal(resolveStyle('nova', 'Firefox'), 'nova');
});

test('isWaterfox only matches Waterfox', () => {
  assert.ok(isWaterfox('Waterfox'));
  for (const name of ['Firefox', 'Firefox Nightly', 'LibreWolf', '', null]) assert.ok(!isWaterfox(name));
});

test('stored preferences are sanitised back to known values', () => {
  assert.deepEqual(sanitizePrefs(undefined), { ...APPEARANCE_DEFAULTS });
  assert.deepEqual(sanitizePrefs('garbage'), { ...APPEARANCE_DEFAULTS });
  assert.deepEqual(sanitizePrefs({ style: 'nova', mode: 'dark', accent: 'pine' }), {
    style: 'nova',
    mode: 'dark',
    accent: 'pine'
  });
  assert.deepEqual(sanitizePrefs({ style: 'metro', mode: 'sepia', accent: 'chartreuse', extra: 1 }), {
    ...APPEARANCE_DEFAULTS
  });
});

/* ── The Waterfox colours ── */

test("the accents are Waterfox's twelve, in its order", () => {
  assert.deepEqual(
    ACCENTS.map((a) => a.name),
    ['Default', 'Smoke', 'Ash', 'Sun', 'Spark', 'Flame', 'Flare', 'Lavender', 'Dusk', 'Lagoon', 'Tide', 'Pine']
  );
  assert.equal(new Set(ACCENTS.map((a) => a.id)).size, ACCENTS.length);
});

test('every accent is readable in both modes, including hover and pressed', () => {
  for (const accent of ACCENTS) {
    const t = accentTokens(accent.id);
    for (const mode of ['d', 'l']) {
      const text = c(t[`--nova-accent-text-${mode}`]);
      for (const state of ['accent', 'accent-hover', 'accent-active']) {
        const fill = c(t[`--nova-${state}-${mode}`]);
        assert.ok(
          contrastRatio(text, fill) >= 4.5,
          `${accent.name} ${state} (${mode}): ${contrastRatio(text, fill).toFixed(2)}`
        );
      }
    }
  }
});

test('every accent makes a visible focus ring on every Nova surface', () => {
  for (const accent of ACCENTS) {
    const t = accentTokens(accent.id);
    for (const [mode, suffix] of [['dark', 'd'], ['light', 'l']]) {
      const ring = c(t[`--nova-focus-${suffix}`]);
      for (const [surface, value] of Object.entries(NOVA_SURFACES[mode])) {
        const ratio = contrastRatio(ring, c(value));
        assert.ok(ratio >= 3, `${accent.name} on ${mode} ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('accent text matches ACCENT_TEXT and an unknown id falls back to Default', () => {
  const t = accentTokens('default');
  assert.deepEqual(c(t['--nova-accent-text-d']), c(ACCENT_TEXT.dark));
  assert.deepEqual(c(t['--nova-accent-text-l']), c(ACCENT_TEXT.light));
  assert.deepEqual(accentTokens('no-such-colour'), t);
});

/* ── The stylesheet agrees with the JavaScript ── */

test("popup.css's Nova surfaces match NOVA_SURFACES", () => {
  const light = declarations(block(':root[data-style="nova"]'));
  const dark = declarations(block(':root[data-style="nova"][data-theme="dark"]'));
  for (const [mode, decls] of [['light', light], ['dark', dark]]) {
    const s = NOVA_SURFACES[mode];
    assert.equal(decls['--bg'], s.bg, `${mode} --bg`);
    assert.equal(decls['--bg-sunken'], s.sunken, `${mode} --bg-sunken`);
    assert.equal(decls['--bg-raised'], s.raised, `${mode} --bg-raised`);
  }
});

test('the two copies of each dark palette are identical', () => {
  const pairs = [
    [':root:not([data-theme="light"])', ':root[data-theme="dark"]'],
    [':root[data-style="nova"]:not([data-theme="light"])', ':root[data-style="nova"][data-theme="dark"]']
  ];
  for (const [viaMedia, forced] of pairs) {
    assert.deepEqual(declarations(block(viaMedia)), declarations(block(forced)), `${viaMedia} vs ${forced}`);
  }
});

test("the stylesheet's accent fallbacks are the Default accent", () => {
  const t = accentTokens('default');
  const light = declarations(block(':root[data-style="nova"]'));
  const dark = declarations(block(':root[data-style="nova"][data-theme="dark"]'));
  const fallback = (value) => /var\(\s*(--[\w-]+)\s*,\s*([^)]+)\)/.exec(value);
  for (const decls of [light, dark]) {
    for (const key of ['--accent', '--accent-hover', '--accent-active', '--accent-text', '--focus-ring']) {
      const [, variable, value] = fallback(decls[key]);
      const expected = c(t[variable]);
      const actual = c(value.trim());
      for (const channel of ['r', 'g', 'b']) {
        assert.ok(Math.abs(expected[channel] - actual[channel]) <= 1, `${key} fallback ${value} vs ${t[variable]}`);
      }
    }
  }
});

/* ── Painting ── */

test('a forced mode wins over the browser theme and adopts none of its colours', () => {
  const root = fakeRoot();
  applyAppearance(root, { style: 'photon', mode: 'light', accent: 'default' }, { colors: FIREFOX_DARK });
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(root.props.has('--bg'), false);
});

test('Photon in system mode follows the browser theme colours', () => {
  const root = fakeRoot();
  applyAppearance(root, { style: 'photon', mode: 'system', accent: 'default' }, { colors: FIREFOX_DARK });
  assert.equal(root.dataset.style, 'photon');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.props.get('--bg'), 'rgb(66, 65, 77)');
  assert.equal(root.props.has('--nova-accent-d'), false);
});

test('Nova in system mode takes light-or-dark from the theme but keeps its own colours', () => {
  const root = fakeRoot();
  applyAppearance(root, { style: 'nova', mode: 'system', accent: 'pine' }, { colors: FIREFOX_DARK });
  assert.equal(root.dataset.style, 'nova');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.props.has('--bg'), false);
  assert.equal(root.props.get('--nova-accent-d'), accentTokens('pine')['--nova-accent-d']);
});

test('with no theme colours, system mode defers to prefers-color-scheme', () => {
  for (const style of ['photon', 'nova']) {
    const root = fakeRoot();
    root.dataset.theme = 'dark';
    applyAppearance(root, { style, mode: 'system', accent: 'default' }, {});
    assert.equal(root.dataset.theme, undefined, style);
  }
});

test('switching style leaves nothing of the previous one behind', () => {
  const root = fakeRoot();
  applyAppearance(root, { style: 'photon', mode: 'system', accent: 'default' }, { colors: FIREFOX_DARK });
  applyAppearance(root, { style: 'nova', mode: 'light', accent: 'sun' }, { colors: FIREFOX_DARK });
  assert.equal(root.props.has('--bg'), false);
  assert.equal(root.dataset.theme, 'light');

  applyAppearance(root, { style: 'photon', mode: 'light', accent: 'sun' }, null);
  assert.equal(root.dataset.style, 'photon');
  assert.equal([...root.props.keys()].some((k) => k.startsWith('--nova-')), false);
});

test('the snapshot carries everything boot.js needs to repaint', () => {
  const root = fakeRoot();
  applyAppearance(root, { style: 'nova', mode: 'dark', accent: 'lagoon' }, null);
  const snap = takeSnapshot(root);
  assert.equal(snap.style, 'nova');
  assert.equal(snap.theme, 'dark');
  assert.match(snap.css, /--nova-accent-d: rgb\(143, 200, 255\)/);
});
