import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARSETS,
  SAFE_SYMBOLS,
  AMBIGUOUS,
  randomInt,
  buildPools,
  generatePassword,
  generatePassphrase,
  estimateEntropy,
  strengthFor,
  crackTime
} from '../src/generator.js';
import { WORDLIST } from '../src/wordlist.js';

const ALL_ON = {
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  symbolSet: 'standard'
};

test('randomInt stays in range and covers every value', () => {
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60_000; i++) {
    const v = randomInt(6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6);
    counts[v]++;
  }
  // 60k draws over 6 buckets: ~10k each. A bucket below 9k would mean a
  // badly skewed distribution, not bad luck.
  for (const c of counts) assert.ok(c > 9000, `bucket too small: ${counts}`);
});

test('randomInt rejects nonsense bounds', () => {
  assert.throws(() => randomInt(0));
  assert.throws(() => randomInt(-3));
  assert.throws(() => randomInt(2.5));
});

test('password honours the requested length', () => {
  for (const length of [4, 12, 20, 64, 128]) {
    assert.equal(generatePassword({ ...ALL_ON, length }).length, length);
  }
});

test('only selected character classes appear', () => {
  const pw = generatePassword({
    length: 40,
    lowercase: true,
    uppercase: false,
    digits: true,
    symbols: false
  });
  assert.match(pw, /^[a-z0-9]+$/);
  assert.ok(/[a-z]/.test(pw) && /[0-9]/.test(pw));
});

test('requireEach guarantees one of every class', () => {
  for (let i = 0; i < 300; i++) {
    const pw = generatePassword({ ...ALL_ON, length: 4, requireEach: true });
    assert.ok(/[a-z]/.test(pw), pw);
    assert.ok(/[A-Z]/.test(pw), pw);
    assert.ok(/[0-9]/.test(pw), pw);
    assert.ok([...pw].some((c) => CHARSETS.symbols.includes(c)), pw);
  }
});

test('excludeAmbiguous removes look-alike characters', () => {
  const banned = new Set(AMBIGUOUS);
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword({ ...ALL_ON, length: 30, excludeAmbiguous: true });
    assert.ok([...pw].every((c) => !banned.has(c)), pw);
  }
});

test('excludeChars is respected', () => {
  for (let i = 0; i < 100; i++) {
    const pw = generatePassword({ ...ALL_ON, length: 30, excludeChars: 'aeiou0123456789' });
    assert.ok(!/[aeiou0-9]/.test(pw), pw);
  }
});

test('noRepeats produces all-distinct characters', () => {
  for (let i = 0; i < 100; i++) {
    const pw = generatePassword({ ...ALL_ON, length: 40, noRepeats: true });
    assert.equal(new Set(pw).size, pw.length);
  }
});

test('noRepeats past the pool size is an error, not a hang', () => {
  assert.throws(
    () => generatePassword({ length: 20, lowercase: false, uppercase: false, digits: true, symbols: false, noRepeats: true }),
    /distinct characters available/
  );
});

test('custom symbol set restricts the symbol pool', () => {
  const { combined } = buildPools({ ...ALL_ON, symbolSet: 'custom', customSymbols: '#$' });
  assert.ok(combined.includes('#') && combined.includes('$'));
  assert.ok(!combined.includes('!'));
});

test('safe symbol set excludes shell-hostile characters', () => {
  const { combined } = buildPools({ ...ALL_ON, symbolSet: 'safe' });
  for (const c of SAFE_SYMBOLS) assert.ok(combined.includes(c));
  assert.ok(!combined.includes('<') && !combined.includes(';'));
});

test('no character classes selected is a clear error', () => {
  assert.throws(
    () => generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    /at least one character type/
  );
});

test('a length too short for every required class is an error', () => {
  assert.throws(() => generatePassword({ ...ALL_ON, length: 3, requireEach: true }), /too short/);
});

test('generated passwords are not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(generatePassword({ ...ALL_ON, length: 16 }));
  assert.equal(seen.size, 500);
});

test('passphrase word count and separator', () => {
  const phrase = generatePassphrase(WORDLIST, {
    wordCount: 5,
    separator: '-',
    capitalize: false,
    addNumber: false,
    addSymbol: false
  });
  const parts = phrase.split('-');
  assert.equal(parts.length, 5);
  for (const p of parts) assert.ok(WORDLIST.includes(p), p);
});

test('passphrase capitalisation and extras', () => {
  const phrase = generatePassphrase(WORDLIST, {
    wordCount: 4,
    separator: '.',
    capitalize: true,
    addNumber: true,
    addSymbol: true
  });
  assert.equal(phrase.split('.').length, 4);
  assert.match(phrase, /^[A-Z]/);
  assert.match(phrase, /[0-9]/);
  assert.ok([...phrase].some((c) => SAFE_SYMBOLS.includes(c)));
});

test('wordlist is clean and large enough to matter', () => {
  assert.ok(WORDLIST.length > 2000, `only ${WORDLIST.length} words`);
  assert.equal(new Set(WORDLIST).size, WORDLIST.length, 'wordlist has duplicates');
  for (const w of WORDLIST) assert.match(w, /^[a-z]{3,9}$/);
});

test('entropy tracks length and pool size', () => {
  const short = estimateEntropy('password', { ...ALL_ON, length: 8 });
  const long = estimateEntropy('password', { ...ALL_ON, length: 32 });
  assert.ok(long > short);
  // 26+26+10+27 = 89 characters -> log2(89) ~ 6.48 bits each
  assert.ok(Math.abs(short - 8 * Math.log2(89)) < 0.01);
  assert.equal(estimateEntropy('password', { lowercase: false, uppercase: false, digits: false, symbols: false }), 0);
});

test('passphrase entropy uses the wordlist size', () => {
  const bits = estimateEntropy('passphrase', { wordCount: 6 }, WORDLIST.length);
  assert.ok(Math.abs(bits - 6 * Math.log2(WORDLIST.length)) < 0.01);
});

test('strength tiers climb with entropy', () => {
  assert.equal(strengthFor(20).level, 0);
  assert.equal(strengthFor(50).level, 1);
  assert.equal(strengthFor(70).level, 2);
  assert.equal(strengthFor(100).level, 3);
  assert.equal(strengthFor(200).level, 4);
});

test('crack time is readable at both extremes', () => {
  assert.equal(crackTime(10), 'instantly');
  assert.match(crackTime(60), /second|minute|hour|day|year/);
  assert.match(crackTime(128), /millenni|universe/);
  assert.equal(crackTime(4096), 'longer than the universe has existed');
});
