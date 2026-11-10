// Name matching: "is the ECR name the same person as the wagesheet name?" (the ID has already matched).
// Layered, explainable rules instead of one similarity score. Every rule is unit-tested in test/names.test.js.
//
//  normalise -> exact? -> token alignment (exact / phonetic / insertion-deletion typo / initial / concatenation)
//  -> every token of the shorter name must match
//  -> given-name guard: a shared COMMON token (KUMAR, SHARMA, PRASAD...) never makes a match on its own
import { CFG } from '../config.js';

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'SMT', 'SHRI', 'SRI', 'SHREE', 'DR', 'LATE', 'KUM', 'MST', 'SUSHRI']);
const ABBREV = {
  MOHD: 'MOHAMMAD', MD: 'MOHAMMAD', MOHAMMED: 'MOHAMMAD', MOHAMED: 'MOHAMMAD', MUHAMMAD: 'MOHAMMAD', MUHAMMED: 'MOHAMMAD', MOHAMAD: 'MOHAMMAD', MOHAMMAD: 'MOHAMMAD',
  KR: 'KUMAR', KM: 'KUMARI', KU: 'KUMARI', PD: 'PRASAD', PRASHAD: 'PRASAD', SK: 'SHEIKH', SHAIKH: 'SHEIKH', SHEK: 'SHEIKH',
};
// Very frequent surnames / suffixes: matching only these says little about identity.
export const COMMON = new Set([
  'KUMAR', 'KUMARI', 'DEVI', 'SINGH', 'SHARMA', 'PRASAD', 'YADAV', 'GUPTA', 'VERMA', 'MISHRA', 'RAM', 'LAL', 'CHAND', 'BAI',
  'BEGUM', 'KHAN', 'SAH', 'SAHU', 'SHAH', 'PATEL', 'MOHAMMAD', 'DAS', 'KAUR', 'RAI', 'THAKUR', 'PANDEY', 'TIWARI', 'SHEIKH',
  'ANSARI', 'CHAUHAN', 'JHA', 'PASWAN', 'MAHTO', 'MANDAL', 'NATH', 'BANO', 'KHATUN', 'BIBI', 'SAHA', 'REDDY', 'NAIK', 'RAO',
]);

/** Uppercase, strip honorifics, relation suffixes (S/O ...), punctuation; expand abbreviations. Keeps a log of what changed. */
export function normaliseName(raw) {
  const notes = new Set();
  let s = String(raw ?? '').toUpperCase();
  const rel = s.match(/\b[SDWC]\s*[/\\.]\s*O\b/);
  if (rel) { s = s.slice(0, rel.index); notes.add('relation suffix removed'); }
  s = s.replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  let tokens = s ? s.split(' ') : [];
  const before = tokens.length;
  tokens = tokens.filter((t, i) => !(HONORIFICS.has(t) && (i === 0 || t !== 'KUM')));
  if (tokens.length !== before) notes.add('honorific removed');
  tokens = tokens.map((t) => {
    if (ABBREV[t] && ABBREV[t] !== t) { notes.add(`abbreviation ${t}→${ABBREV[t]}`); return ABBREV[t]; }
    return t;
  });
  return { tokens, notes: [...notes] };
}

/** Indian-name-aware phonetic key: spelling variants that sound alike collapse to the same key. */
export function phonetic(t) {
  let s = t;
  s = s.replace(/PH/g, 'F').replace(/SH/g, 'S').replace(/TH/g, 'T').replace(/DH/g, 'D').replace(/KH/g, 'K')
    .replace(/BH/g, 'B').replace(/GH/g, 'G').replace(/CK/g, 'K').replace(/Q/g, 'K').replace(/W/g, 'V').replace(/Z/g, 'J');
  s = s.replace(/EE/g, 'I').replace(/OO/g, 'U').replace(/AA/g, 'A').replace(/II/g, 'I').replace(/Y$/, 'I');
  s = s.replace(/(.)\1+/g, '$1');      // double letters
  s = s.replace(/(.)H$/, '$1');        // trailing H (RAJESHH, AMITABH->AMITAB handled above)
  return s;
}

/** True if a and b differ by exactly one inserted/deleted letter (no substitutions: RAJESH≠RAKESH). */
function oneIndel(a, b) {
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

/** How two single tokens relate. Higher score = stronger evidence. */
export function tokenMatch(a, b) {
  if (a === b) return { type: 'exact', score: 4 };
  if (a.length === 1 || b.length === 1) {
    return a[0] === b[0] ? { type: 'initial', score: 1 } : null;
  }
  if (phonetic(a) === phonetic(b)) return { type: 'phonetic', score: 3 };
  if (Math.min(a.length, b.length) >= 5 && oneIndel(a, b)) return { type: 'typo', score: 2 };
  return null;
}

/** Best one-to-one assignment of short-name tokens to long-name tokens (names are tiny: brute force). */
function align(S, L) {
  let best = { score: -Infinity, pairs: [] };
  const used = new Array(L.length).fill(false);
  const pairs = [];
  (function dfs(i, score) {
    if (i === S.length) {
      if (score > best.score) best = { score, pairs: pairs.map((p) => ({ ...p })) };
      return;
    }
    for (let j = 0; j < L.length; j++) {
      if (used[j]) continue;
      const m = tokenMatch(S[i], L[j]);
      if (!m) continue;
      used[j] = true; pairs.push({ s: S[i], l: L[j], ...m });
      dfs(i + 1, score + m.score);
      used[j] = false; pairs.pop();
    }
    // also consider leaving this token unmatched (heavily penalised) so a best alignment always exists
    pairs.push({ s: S[i], l: null, type: 'none', score: -5 });
    dfs(i + 1, score - 5);
    pairs.pop();
  })(0, 0);
  return best;
}

/** Merge adjacent tokens when the merged form exists in the other name ("RAM KUMAR" vs "RAMKUMAR"). */
function mergeSpacing(a, b) {
  const set = new Set(b);
  const out = [];
  let merged = false;
  for (let i = 0; i < a.length; i++) {
    if (i + 1 < a.length && set.has(a[i] + a[i + 1])) { out.push(a[i] + a[i + 1]); i++; merged = true; }
    else out.push(a[i]);
  }
  return { tokens: out, merged };
}

const RANK = { EXACT: 3, VARIANT: 2, PARTIAL: 1, MISMATCH: 0 };

/**
 * Compare two names.
 * @returns {{type:'EXACT'|'VARIANT'|'PARTIAL'|'MISMATCH', match:boolean, detail:string}}
 */
export function compareNames(wsName, ecrName) {
  const A = normaliseName(wsName);
  const B = normaliseName(ecrName);
  if (!A.tokens.length || !B.tokens.length) return res('MISMATCH', `name missing (${!A.tokens.length ? 'wagesheet' : 'ECR'})`);

  const notes = [...new Set([...A.notes, ...B.notes])];
  const plainA = String(wsName).toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  const plainB = String(ecrName).toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  if (plainA === plainB) return res('EXACT', '');
  if (A.tokens.join(' ') === B.tokens.join(' ')) return res('VARIANT', notes.join(', ') || 'punctuation/spacing');
  if (A.tokens.join('') === B.tokens.join('')) return res('VARIANT', [...notes, 'spacing'].join(', '));

  // spacing merges in either direction
  const ma = mergeSpacing(A.tokens, B.tokens);
  const mb = mergeSpacing(B.tokens, ma.tokens);
  let a = ma.tokens, b = mb.tokens;
  if (ma.merged || mb.merged) notes.push('spacing');

  const [S, L] = a.length <= b.length ? [a, b] : [b, a];
  const { pairs } = align(S, L);
  const unmatched = pairs.filter((p) => p.type === 'none');
  if (unmatched.length) {
    const others = L.filter((t) => !pairs.some((p) => p.l === t));
    return res('MISMATCH', `${unmatched.map((p) => p.s).join(' ')} ≠ ${others.join(' ') || '—'}`);
  }
  const strong = pairs.filter((p) => p.type !== 'initial');
  const distinctive = strong.some((p) => !COMMON.has(p.s) || !COMMON.has(p.l));
  const hasInitial = pairs.some((p) => p.type === 'initial');
  const extra = L.length - S.length;
  const spelling = pairs.filter((p) => p.type === 'phonetic' || p.type === 'typo').map((p) => `${p.s}~${p.l}`);
  const order = pairs.map((p) => p.l).join(' ') !== L.slice(0, S.length).join(' ') && extra === 0;

  if (!hasInitial && extra === 0) {
    const d = [...notes];
    if (spelling.length) d.push(`spelling ${spelling.join(', ')}`);
    if (order || (!spelling.length && !notes.length)) d.push('word order');
    return res('VARIANT', d.join(', '));
  }
  if (!distinctive) {
    const why = hasInitial ? 'only an initial and common names match' : `only common name(s) ${strong.map((p) => p.s).join(' ')} match`;
    if (hasInitial && CFG.ALLOW_INITIAL_ONLY) return res('PARTIAL', `${why} (allowed by config)`);
    return res('MISMATCH', `${why} — verify identity`);
  }
  const d = [...notes];
  if (hasInitial) d.push(`initial ${pairs.filter((p) => p.type === 'initial').map((p) => `${p.s}=${p.l}`).join(', ')}`);
  if (extra > 0) d.push(`extra name part(s): ${L.filter((t) => !pairs.some((p) => p.l === t)).join(' ')}`);
  if (spelling.length) d.push(`spelling ${spelling.join(', ')}`);
  if (!CFG.ALLOW_PARTIAL_NAMES) return res('MISMATCH', `partial match not allowed by config (${d.join(', ')})`);
  return res('PARTIAL', d.join(', '));
}

function res(type, detail) {
  return { type, match: type !== 'MISMATCH', detail };
}

/** PF has two names (as per ECR, as per UAN repository): best of the two wins, and we say which. */
export function compareWithBest(wsName, candidates) {
  let best = null;
  for (const [label, name] of candidates) {
    if (!name) continue;
    const r = compareNames(wsName, name);
    if (!best || RANK[r.type] > RANK[best.type]) best = { ...r, against: label, ecrName: name };
  }
  return best || { type: 'MISMATCH', match: false, detail: 'no name in ECR', against: null, ecrName: '' };
}
