// Name-tolerance test set: every row is a documented decision (README "Name matching tolerance").
// MATCH = same person (EXACT / VARIANT / PARTIAL), MISMATCH = flag for compliance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareNames, compareWithBest, phonetic } from '../src/verify/names.js';

const CASES = [
  // [wagesheet, ECR, expected type, why]
  ['ANIL KUMAR', 'ANIL KUMAR', 'EXACT', 'identical'],
  ['Anil  Kumar.', 'ANIL KUMAR', 'EXACT', 'case / punctuation / spaces'],
  ['KUMAR ANIL', 'ANIL KUMAR', 'VARIANT', 'word order'],
  ['DEVI SUNITA', 'SUNITA DEVI', 'VARIANT', 'word order'],
  ['POOJA GUPTA', 'PUJA GUPTA', 'VARIANT', 'OO/U spelling'],
  ['KAVITHA KUMARI', 'KAVITA KUMARI', 'VARIANT', 'TH/T spelling'],
  ['SHABNAM BANO', 'SABNAM BANO', 'VARIANT', 'SH/S spelling'],
  ['DEEPAK SINGH', 'DIPAK SINGH', 'VARIANT', 'EE/I spelling'],
  ['MOHD SALIM', 'MOHAMMAD SALIM', 'VARIANT', 'abbreviation'],
  ['MD. IRFAN', 'MOHAMMED IRFAN', 'VARIANT', 'abbreviation both sides'],
  ['SMT. SUNITA DEVI', 'SUNITA DEVI', 'VARIANT', 'honorific'],
  ['MR RAKESH VERMA', 'RAKESH VERMA', 'VARIANT', 'honorific'],
  ['RAMESH S/O SURESH', 'RAMESH', 'VARIANT', 'relation suffix removed'],
  ['RAMKUMAR', 'RAM KUMAR', 'VARIANT', 'spacing'],
  ['RAM KUMAR YADAV', 'RAMKUMAR YADAV', 'VARIANT', 'spacing within longer name'],
  ['RAJESHH KUMAR', 'RAJESH KUMAR', 'VARIANT', 'extra letter typo'],
  ['SRINIVASN', 'SRINIVASAN', 'VARIANT', 'missing letter typo'],
  ['VIKAS KR', 'VIKAS KUMAR', 'VARIANT', 'KR abbreviation'],
  ['RAJESH SHARMA', 'RAJESH KUMAR SHARMA', 'PARTIAL', 'missing middle name'],
  ['PRIYA', 'PRIYA SINGH', 'PARTIAL', 'surname missing, given name distinctive'],
  ['R. RAJESH KUMAR', 'RAJESH KUMAR', 'PARTIAL', 'extra initial'],
  ['A. PRIYADARSHINI', 'ANAND PRIYADARSHINI', 'PARTIAL', 'initial + distinctive token'],
  // ---- genuine mismatches (must be caught) ----
  ['DINESH PRASAD', 'DEVENDRA PRASAD', 'MISMATCH', 'sample trap: shared surname, different given name'],
  ['REKHA SHARMA', 'RENU SHARMA', 'MISMATCH', 'sample trap: similar given name, shared surname'],
  ['RAJESH KUMAR', 'RAKESH KUMAR', 'MISMATCH', 'one-letter substitution = different name'],
  ['ANIL KUMAR', 'SUNIL KUMAR', 'MISMATCH', 'different given name'],
  ['SURESH KUMAR', 'RAMESH KUMAR', 'MISMATCH', 'different given name'],
  ['SUNITA DEVI', 'SUNITI DEVI', 'MISMATCH', 'vowel substitution in given name'],
  ['MOHAMMAD SALIM', 'MOHAMMAD ASLAM', 'MISMATCH', 'only common prefix shared'],
  ['KUMAR', 'RAJESH KUMAR', 'MISMATCH', 'only a common surname matches'],
  ['R. KUMAR SHARMA', 'RAJESH KUMAR SHARMA', 'MISMATCH', 'only initial + common names (strict default)'],
  ['PRIYA SINGH', 'PRIYANKA SINGH', 'MISMATCH', 'prefix is not the same name'],
  ['AMIT YADAV', 'SUMIT YADAV', 'MISMATCH', 'different given name'],
  ['NEHA MISHRA', 'SNEHA MISHRA', 'MISMATCH', 'one added letter on a short name is a different name'],
  ['VIKRAM THAKUR', 'ANIL KUMAR', 'MISMATCH', 'completely different'],
  ['ANIL KUMAR', '', 'MISMATCH', 'ECR name missing'],
];

for (const [ws, ecr, expected, why] of CASES) {
  test(`${expected}: "${ws}" vs "${ecr}" (${why})`, () => {
    const r = compareNames(ws, ecr);
    assert.equal(r.type, expected, `got ${r.type} (${r.detail})`);
  });
}

test('phonetic keys', () => {
  assert.equal(phonetic('POOJA'), phonetic('PUJA'));
  assert.equal(phonetic('KAVITHA'), phonetic('KAVITA'));
  assert.notEqual(phonetic('REKHA'), phonetic('RENU'));
  assert.notEqual(phonetic('RAJESH'), phonetic('RAKESH'));
});

test('PF: best of ECR name and UAN-repository name, and says which', () => {
  const r = compareWithBest('DINESH PRASAD', [['ECR name', 'D PRASAD'], ['UAN repository name', 'DINESH PRASAD']]);
  assert.equal(r.type, 'EXACT');
  assert.equal(r.against, 'UAN repository name');
});

test('mismatch detail names the failing tokens', () => {
  const r = compareNames('DINESH PRASAD', 'DEVENDRA PRASAD');
  assert.match(r.detail, /DINESH/);
  assert.match(r.detail, /DEVENDRA/);
});
