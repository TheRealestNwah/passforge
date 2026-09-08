import {
  generatePassword,
  generatePassphrase,
  estimateEntropy,
  strengthFor,
  crackTime
} from '../src/generator.js';
import { WORDLIST } from '../src/wordlist.js';

const $ = (id) => document.getElementById(id);

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
  $('panel-password').hidden = !isPassword;
  $('panel-passphrase').hidden = isPassword;
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
  settings = await loadSettings();
  $('wordlist-size').textContent = WORDLIST.length.toLocaleString();
  $('bits-per-word').textContent = Math.log2(WORDLIST.length).toFixed(1);
  writeForm();
  bind();
  generate();
}

init();
