import {
  generatePassword,
  generatePassphrase,
  estimateEntropy,
  strengthFor,
  crackTime
} from '../src/generator.js';
import { WORDLIST } from '../src/wordlist.js';
import {
  ACCENTS,
  APPEARANCE_DEFAULTS,
  SNAPSHOT_KEY,
  applyAppearance,
  detectBrowserName,
  isWaterfox,
  resolveStyle,
  sanitizePrefs,
  takeSnapshot
} from '../src/appearance.js';
import { mix, normalizeColor, toCss } from '../src/theme.js';

const $ = (id) => document.getElementById(id);

// Deliberately still the old product name: renaming this key would orphan the
// settings of anyone who installed the extension before the rename, silently
// resetting them to defaults. Users never see it.
const STORAGE_KEY = 'passforge:settings';

const DEFAULTS = {
  mode: 'password',
  // password
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  symbolSet: 'standard',
  customSymbols: '',
  requireEach: true,
  excludeAmbiguous: false,
  noRepeats: false,
  excludeChars: '',
  // passphrase
  wordCount: 6,
  separator: '-',
  capitalize: true,
  addNumber: true,
  addSymbol: false
};

const PRESETS = {
  pin: { mode: 'password', length: 6, uppercase: false, lowercase: false, digits: true, symbols: false, requireEach: true, noRepeats: false, excludeAmbiguous: false },
  readable: { mode: 'password', length: 16, uppercase: true, lowercase: true, digits: true, symbols: false, requireEach: true, excludeAmbiguous: true, noRepeats: false },
  strong: { mode: 'password', length: 24, uppercase: true, lowercase: true, digits: true, symbols: true, symbolSet: 'standard', requireEach: true, excludeAmbiguous: false, noRepeats: false },
  paranoid: { mode: 'password', length: 48, uppercase: true, lowercase: true, digits: true, symbols: true, symbolSet: 'standard', requireEach: true, excludeAmbiguous: false, noRepeats: false }
};

/** Maps a settings key to its control and the property holding its value. */
const CONTROLS = {
  length: ['length', 'value', Number],
  uppercase: ['uppercase', 'checked'],
  lowercase: ['lowercase', 'checked'],
  digits: ['digits', 'checked'],
  symbols: ['symbols', 'checked'],
  symbolSet: ['symbol-set', 'value'],
  customSymbols: ['custom-symbols', 'value'],
  requireEach: ['require-each', 'checked'],
  excludeAmbiguous: ['exclude-ambiguous', 'checked'],
  noRepeats: ['no-repeats', 'checked'],
  excludeChars: ['exclude-chars', 'value'],
  wordCount: ['word-count', 'value', Number],
  separator: ['separator', 'value'],
  capitalize: ['capitalize', 'checked'],
  addNumber: ['add-number', 'checked'],
  addSymbol: ['add-symbol', 'checked']
};

let settings = { ...DEFAULTS };

// Appearance lives under its own key so the generator settings and the look
// can change independently.
const APPEARANCE_KEY = 'passmint:appearance';
const root = document.documentElement;
const appearance = { prefs: { ...APPEARANCE_DEFAULTS }, browserName: '', theme: null };
let appearanceOpen = false;

/* ── Storage (browser.* in Firefox, chrome.* elsewhere, memory as a last resort) ── */

const storageArea = globalThis.browser?.storage?.local ?? globalThis.chrome?.storage?.local;

async function loadSettings() {
  if (!storageArea) return { ...DEFAULTS };
  try {
    const stored = await storageArea.get(STORAGE_KEY);
    return { ...DEFAULTS, ...(stored?.[STORAGE_KEY] ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveSettings() {
  if (!storageArea) return;
  try {
    await storageArea.set({ [STORAGE_KEY]: settings });
  } catch {
    /* Storage is a convenience; generation must not depend on it. */
  }
}

/* ── Reading and writing the form ── */

function readForm() {
  const next = { mode: settings.mode };
  for (const [key, [id, prop, cast]] of Object.entries(CONTROLS)) {
    const raw = $(id)[prop];
    next[key] = cast ? cast(raw) : raw;
  }
  return next;
}

function writeForm() {
  for (const [key, [id, prop]] of Object.entries(CONTROLS)) {
    $(id)[prop] = settings[key];
  }
  $('length-number').value = settings.length;
  $('word-count-number').value = settings.wordCount;
  $('custom-symbols-row').hidden = settings.symbolSet !== 'custom';

  const isPassword = settings.mode === 'password';
  $('panel-password').hidden = appearanceOpen || !isPassword;
  $('panel-passphrase').hidden = appearanceOpen || isPassword;
  document.querySelector('.presets').hidden = appearanceOpen;
  $('panel-appearance').hidden = !appearanceOpen;
  $('appearance-toggle').setAttribute('aria-pressed', String(appearanceOpen));
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.mode === settings.mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}

/* ── Generating ── */

function showError(message) {
  const el = $('error');
  el.textContent = message;
  el.hidden = !message;
}

function updateStrength() {
  const bits = estimateEntropy(settings.mode, settings, WORDLIST.length);
  const { label, level } = strengthFor(bits);
  document.querySelector('.meter').dataset.level = String(level);
  $('strength-label').textContent = label;
  $('entropy').textContent = `${Math.round(bits)} bits of entropy`;
  $('crack-time').textContent = `Brute force at a trillion guesses/second: ${crackTime(bits)}`;
}

function generate() {
  try {
    const value =
      settings.mode === 'passphrase'
        ? generatePassphrase(WORDLIST, settings)
        : generatePassword(settings);
    $('result').textContent = value;
    showError('');
    updateStrength();
  } catch (err) {
    $('result').textContent = '';
    document.querySelector('.meter').dataset.level = '';
    $('strength-label').textContent = '—';
    $('entropy').textContent = '';
    $('crack-time').textContent = '';
    showError(err.message);
  }
}

/** Called on every control change: sync state, persist, re-roll. */
function onChange() {
  settings = readForm();
  writeForm();
  saveSettings();
  generate();
}

async function copyResult() {
  const text = $('result').textContent;
  if (!text) return;

  const btn = $('copy');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older/locked-down contexts: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  btn.textContent = 'Copied';
  btn.classList.add('is-copied');
  setTimeout(() => {
    btn.textContent = 'Copy';
    btn.classList.remove('is-copied');
  }, 1200);
}

/* ── Appearance ── */

function styleHint(resolved) {
  if (appearance.prefs.style !== 'auto') {
    return resolved === 'nova'
      ? 'Always the Waterfox Nova look.'
      : 'Always the Firefox look.';
  }
  return isWaterfox(appearance.browserName)
    ? 'Waterfox detected, so using its Nova look.'
    : 'Using the Firefox look. Switches to Nova automatically in Waterfox.';
}

function renderAppearanceControls(resolved) {
  const groups = [
    ['appearance-style', appearance.prefs.style],
    ['appearance-mode', appearance.prefs.mode],
    ['accent', appearance.prefs.accent]
  ];
  for (const [name, value] of groups) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
      input.checked = input.value === value;
    }
  }
  // Waterfox's theme colours only mean something in the Nova look.
  $('accent-block').hidden = resolved !== 'nova';
  $('style-hint').textContent = styleHint(resolved);
}

function paintAppearance() {
  const style = resolveStyle(appearance.prefs.style, appearance.browserName);
  applyAppearance(root, { ...appearance.prefs, style }, appearance.theme);
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(takeSnapshot(root)));
  } catch {
    /* Only costs a flash of the default look on the next open. */
  }
  renderAppearanceControls(style);
}

async function saveAppearance() {
  if (!storageArea) return;
  try {
    await storageArea.set({ [APPEARANCE_KEY]: appearance.prefs });
  } catch {
    /* Convenience only. */
  }
}

function buildSwatches() {
  const container = $('accent-swatches');
  for (const accent of ACCENTS) {
    const label = document.createElement('label');
    label.className = 'swatch';
    label.title = accent.name;
    const fill = normalizeColor(accent.dark);
    label.style.setProperty('--swatch', toCss(fill));
    label.style.setProperty('--swatch-hi', toCss(mix(fill, { r: 255, g: 255, b: 255 }, 0.4)));

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'accent';
    input.value = accent.id;

    const dot = document.createElement('span');
    dot.className = 'swatch-dot';
    dot.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'swatch-name';
    name.textContent = accent.name;

    label.append(input, dot, name);
    container.append(label);
  }
}

async function initAppearance() {
  const themeApi = globalThis.browser?.theme;
  const [stored, browserName, theme] = await Promise.all([
    storageArea
      ? storageArea.get(APPEARANCE_KEY).then((r) => r?.[APPEARANCE_KEY], () => null)
      : null,
    detectBrowserName(),
    themeApi?.getCurrent ? themeApi.getCurrent().catch(() => null) : null
  ]);
  appearance.prefs = sanitizePrefs(stored);
  appearance.browserName = browserName;
  appearance.theme = theme;
  paintAppearance();

  // Fires when the user switches browser themes while the popup is open.
  themeApi?.onUpdated?.addListener((info) => {
    appearance.theme = info?.theme ?? null;
    paintAppearance();
  });
}

/* ── Wiring ── */

function bind() {
  for (const [id] of Object.values(CONTROLS)) {
    $(id).addEventListener('input', onChange);
  }

  // The slider and the number box are two views of one value.
  const pairs = [
    ['length', 'length-number'],
    ['word-count', 'word-count-number']
  ];
  for (const [slider, number] of pairs) {
    $(number).addEventListener('input', () => {
      const el = $(number);
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;
      // Clamp silently rather than fighting the user mid-typing.
      const clamped = Math.min(Math.max(value, Number(el.min)), Number(el.max));
      $(slider).value = String(clamped);
      onChange();
    });
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      settings.mode = tab.dataset.mode;
      appearanceOpen = false;
      writeForm();
      saveSettings();
      generate();
    });
  }

  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      settings = { ...settings, ...PRESETS[chip.dataset.preset] };
      writeForm();
      saveSettings();
      generate();
    });
  }

  $('regenerate').addEventListener('click', generate);

  $('appearance-toggle').addEventListener('click', () => {
    appearanceOpen = !appearanceOpen;
    writeForm();
  });

  const appearanceInputs = [
    ['appearance-style', 'style'],
    ['appearance-mode', 'mode'],
    ['accent', 'accent']
  ];
  for (const [name, key] of appearanceInputs) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
      input.addEventListener('change', () => {
        appearance.prefs = sanitizePrefs({ ...appearance.prefs, [key]: input.value });
        saveAppearance();
        paintAppearance();
      });
    }
  }

  $('copy').addEventListener('click', copyResult);
  $('result').addEventListener('click', () => getSelection().selectAllChildren($('result')));

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      generate();
    } else if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey) && !getSelection().toString()) {
      e.preventDefault();
      copyResult();
    }
  });
}

async function init() {
  // popup/boot.js has already repainted the last look; this confirms it
  // against the real browser, theme and saved preference. It runs alongside
  // the rest of init rather than holding it up. The swatches must exist
  // first, because the appearance lookup can finish before bind() runs.
  buildSwatches();
  initAppearance();

  settings = await loadSettings();
  $('wordlist-size').textContent = WORDLIST.length.toLocaleString();
  $('bits-per-word').textContent = Math.log2(WORDLIST.length).toFixed(1);
  writeForm();
  bind();
  generate();
}

init();
