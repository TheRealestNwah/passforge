/**
 * Passmint core generation logic.
 *
 * Every random choice goes through the Web Crypto CSPRNG with rejection
 * sampling, so there is no modulo bias and no reliance on Math.random().
 */

export const CHARSETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~'
};

/** Characters that are easy to confuse with one another in most fonts. */
export const AMBIGUOUS = 'Il1|O0oB8S5Z2G6q9';

/** Symbols that survive shells, CSVs, and legacy password fields unharmed. */
export const SAFE_SYMBOLS = '!@#$%^&*()-_=+';

class GeneratorError extends Error {}

/**
 * Uniform random integer in [0, max) using rejection sampling.
 */
export function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) {
    throw new GeneratorError(`randomInt requires a positive integer, got ${max}`);
  }
  if (max === 1) return 0;
  // Largest multiple of `max` that fits in a uint32; anything at or above it
  // would skew the distribution, so we redraw instead.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

export function randomItem(list) {
  return list[randomInt(list.length)];
}

/** In-place Fisher-Yates shuffle driven by the CSPRNG. */
export function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function dedupe(str) {
  return [...new Set(str)].join('');
}

function stripChars(str, banned) {
  const bannedSet = new Set(banned);
  return [...str].filter((c) => !bannedSet.has(c)).join('');
}

/**
 * Turn the UI options into the concrete character pools we will draw from.
 * Returns { pools, combined } where `pools` is one string per enabled class.
 */
export function buildPools(options) {
  const {
    lowercase = true,
    uppercase = true,
    digits = true,
    symbols = true,
    symbolSet = 'standard',
    customSymbols = '',
    excludeAmbiguous = false,
    excludeChars = ''
  } = options;

  const symbolPool =
    symbolSet === 'safe' ? SAFE_SYMBOLS
    : symbolSet === 'custom' ? dedupe(customSymbols)
    : CHARSETS.symbols;

  const requested = [
    lowercase && CHARSETS.lowercase,
    uppercase && CHARSETS.uppercase,
    digits && CHARSETS.digits,
    symbols && symbolPool
  ].filter(Boolean);

  const banned = (excludeAmbiguous ? AMBIGUOUS : '') + excludeChars;

  const pools = requested
    .map((pool) => stripChars(dedupe(pool), banned))
    .filter((pool) => pool.length > 0);

  return { pools, combined: dedupe(pools.join('')) };
}

/**
 * Generate a random-character password.
 *
 * options:
 *   length            number of characters
 *   lowercase/uppercase/digits/symbols  enable a character class
 *   symbolSet         'standard' | 'safe' | 'custom'
 *   customSymbols     used when symbolSet === 'custom'
 *   excludeAmbiguous  drop look-alike characters (Il1O0 ...)
 *   excludeChars      extra characters to forbid
 *   requireEach       guarantee >=1 character from every enabled class
 *   noRepeats         never reuse the same character twice
 */
export function generatePassword(options = {}) {
  const { length = 20, requireEach = true, noRepeats = false } = options;

  if (!Number.isInteger(length) || length < 1) {
    throw new GeneratorError('Length must be a positive whole number.');
  }

  const { pools, combined } = buildPools(options);
  if (combined.length === 0) {
    throw new GeneratorError('Pick at least one character type.');
  }
  if (noRepeats && length > combined.length) {
    throw new GeneratorError(
      `Only ${combined.length} distinct characters available — reduce the length or allow repeats.`
    );
  }
  if (requireEach && pools.length > length) {
    throw new GeneratorError(
      `Length ${length} is too short to include all ${pools.length} selected character types.`
    );
  }

  const chars = [];
  const used = new Set();
  const draw = (pool) => {
    let c;
    do {
      c = pool[randomInt(pool.length)];
    } while (noRepeats && used.has(c));
    used.add(c);
    return c;
  };

  if (requireEach) {
    for (const pool of pools) chars.push(draw(pool));
  }
  while (chars.length < length) chars.push(draw(combined));

  return shuffle(chars).join('');
}

/**
 * Generate a passphrase from the bundled wordlist.
 *
 * options:
 *   wordCount    how many words
 *   separator    string placed between words
 *   capitalize   Title Case each word
 *   addNumber    append a digit to one random word
 *   addSymbol    append a symbol to one random word
 */
export function generatePassphrase(wordlist, options = {}) {
  const {
    wordCount = 5,
    separator = '-',
    capitalize = false,
    addNumber = false,
    addSymbol = false
  } = options;

  if (!Number.isInteger(wordCount) || wordCount < 1) {
    throw new GeneratorError('Word count must be a positive whole number.');
  }
  if (!wordlist || wordlist.length === 0) {
    throw new GeneratorError('The wordlist is empty.');
  }

  const words = Array.from({ length: wordCount }, () => {
    const word = randomItem(wordlist);
    return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
  });

  if (addNumber) {
    const i = randomInt(words.length);
    words[i] += randomItem(CHARSETS.digits);
  }
  if (addSymbol) {
    const i = randomInt(words.length);
    words[i] += randomItem(SAFE_SYMBOLS);
  }

  return words.join(separator);
}

/**
 * Entropy in bits. For passwords this is length * log2(poolSize); for
 * passphrases it is wordCount * log2(wordlistSize) plus any extra character.
 *
 * Note: `requireEach` shaves a fraction of a bit off the true figure, so the
 * number below is an upper bound — accurate enough for a strength meter.
 */
export function estimateEntropy(mode, options, wordlistSize = 0) {
  if (mode === 'passphrase') {
    const { wordCount = 5, addNumber = false, addSymbol = false } = options;
    let bits = wordCount * Math.log2(wordlistSize);
    if (addNumber) bits += Math.log2(10 * wordCount);
    if (addSymbol) bits += Math.log2(SAFE_SYMBOLS.length * wordCount);
    return bits;
  }

  const { combined } = buildPools(options);
  if (combined.length === 0) return 0;
  const { length = 20, noRepeats = false } = options;

  if (noRepeats) {
    // Sampling without replacement: log2(n! / (n-k)!)
    let bits = 0;
    for (let i = 0; i < length && i < combined.length; i++) {
      bits += Math.log2(combined.length - i);
    }
    return bits;
  }
  return length * Math.log2(combined.length);
}

const STRENGTH_TIERS = [
  { min: 0, label: 'Very weak', level: 0 },
  { min: 45, label: 'Weak', level: 1 },
  { min: 65, label: 'Good', level: 2 },
  { min: 90, label: 'Strong', level: 3 },
  { min: 120, label: 'Overkill', level: 4 }
];

export function strengthFor(bits) {
  let tier = STRENGTH_TIERS[0];
  for (const t of STRENGTH_TIERS) if (bits >= t.min) tier = t;
  return { ...tier, bits };
}

/** Human-readable time to exhaust half the keyspace at 1e12 guesses/second. */
export function crackTime(bits) {
  const GUESSES_PER_SECOND = 1e12;
  const seconds = Math.pow(2, bits - 1) / GUESSES_PER_SECOND;
  if (seconds < 1) return 'instantly';

  const units = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 365.25],
    ['year', 1000]
  ];

  let value = seconds;
  for (const [name, factor] of units) {
    if (value < factor) {
      const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
      return `${rounded.toLocaleString()} ${name}${rounded === 1 ? '' : 's'}`;
    }
    value /= factor;
  }

  // `value` is now in millennia.
  if (value > 1e15) return 'longer than the universe has existed';
  const rounded = Math.round(value);
  return `${rounded.toLocaleString()} millenni${rounded === 1 ? 'um' : 'a'}`;
}
