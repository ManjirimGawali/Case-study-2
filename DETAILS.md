# ECR Verifier: Detailed Design

The README covers the overview, results and how to run it. This document explains how each part works, why it works that way, and how to change it.

1. Data flow
2. PDF reading and header-driven tables
3. Document parsers (PF ECR, ESIC ECR, wagesheet)
4. Reconciliation
5. Identifiers
6. Name matching algorithm
7. Amount rules
8. Verdict gates
9. Report
10. Testing, evaluation, and bugs the tests caught
11. Configuration
12. API
13. Extension guide (live-review cheat sheet)
14. Trade-offs considered

---

## 1. Data flow

```
files ─► ingest/index.js  loadInputs()
           ├─ isPdf? readPdf() ─► detectKind()  (refuses a file in the wrong slot, or a scan with no text layer)
           ├─ wagesheet.js  parseWagesheet()     → rows {name, uan, ip, agency, state, pfAmount, esicAmount}
           ├─ ecr.js        parsePfEcr()         → rows {id, ecrName, uanName, epfWages, amount(EE), eps, er, …} + printed totals
           └─ ecr.js        parseEsicEcr()       → rows {id, ecrName, wages, amount(IP), reason, …} + printed totals
      ─► verify/index.js  verify()
           ├─ reconcile()   parsed vs printed totals
           ├─ verdictFor('PF' | 'ESIC', employee, index-by-id)   (names.js + amounts.js)
           ├─ summary, extras (ECR rows not in the wagesheet), data issues
      ─► report/workbook.js  buildWorkbook()  → .xlsx (6 sheets) · toCsv()
```

`server/src/run.js` (`runVerification`) is the single entry point used by the API, the CLI, the evaluator and the tests. Everything after loading is a pure function of its inputs.

## 2. PDF reading and header-driven tables (`ingest/pdfText.js`, `ingest/table.js`)

`readPdf` uses `pdfjs-dist` to get every text item with its position, then groups items into lines (baseline within 2.5 pt) for each page.

`extractTable(pages, spec)` is layout-agnostic. A *spec* gives:
- `anchors`: regexes that must all appear on the header line (e.g. PF: `^UAN$` and `NAME`).
- `columns`: key → header regex (e.g. `ee: /^EE( SHARE)?$|EMPLOYEE SHARE/`). Each header is used once, in spec order. That's why `epsWages` (`EPS WAGES`) is listed before `eps` (`^EPS$`).
- `idKey` + `idPattern`: a line is a **data row only if its ID cell has the right shape**. Repeated headers, footers ("Page 1 of 1"), establishment stamps and totals are skipped automatically.
- `wrapKeys`: columns whose text may wrap onto a second line.

On each page:
1. **Find the header line** by its anchors.
2. **Merge multi-line headers.** Word-only lines within 16 pt **above or below** the anchor line are merged into overlapping header cells: `Name as per` + `UAN Repository`, `Gross` + `Wages`. The real EPFO PDF puts the fragment above; other generators put it below; both are handled.
3. **Assign cells to columns:**
   1. The column whose header x-range overlaps the cell most (handles left- and centre-aligned text and most numbers).
   2. No overlap and numeric: the item is right-aligned, so pick the last header that starts at or before its right edge. In the real PF ECR, `ER = 496` (x 532–543) doesn't overlap its header `ER` (520–529).
   3. Otherwise, the nearest header centre.
4. **Continuation pages** with no header reuse the previous page's columns (the ESIC style).
5. **Wrapped text:** a line with no ID whose only text sits in wrap columns, within 14 pt under the previous row, is appended to that row (e.g. `FARHAN KUMAR` / `MANDAL` in both PF name columns).

`findTotal(pages, label)` reads printed totals whether the value is to the right of the label (PF: `Total Members 11`) or below it (ESIC: `Total IP Contribution` / `933.00`).

## 3. Document parsers

| Document | Header keywords (synonyms) | Notes |
|---|---|---|
| PF ECR | UAN · Name as per ECR · Name as per UAN Repository · Gross/EPF/EPS/EDLI Wages · EE · EPS · ER · NCP Days | `amount` = **EE share**; totals: Total Members, Total EPF Contribution, Total EPS Contribution, Total EPF-EPS Contribution; wage month from "Wage Month" |
| ESIC ECR | IP Number · IP Name · Is Disable · No. Of Days · Total Wages · IP Contribution · Reason | `amount` = **IP contribution**; totals: Total IP Contribution, Total Monthly Wages; "Reason" and "Is Disable" are carried into notes |
| Wagesheet | Name/Employee Name · UAN · IP Number/ESIC No · Agency/Vendor · State · ESIC… · PF/EPF… | .xlsx (exceljs; header row searched in the first 30 rows, first matching sheet), .csv, or PDF (positional, a row = has a name, so **blank-UAN employees are never dropped**); "Total" rows skipped |

**Document detection** (`detectKind`): PF needs "Provident Fund / Electronic Challan" + "UAN". ESIC needs "State Insurance / Contribution History / IP Contribution" + "IP Number". The wagesheet itself mentions "ESIC" and "IP Number", so plain "ESIC" is not enough to call a file an ESIC ECR (a bug caught in development). A file in the wrong slot is refused with a clear message.

## 4. Reconciliation (`verify/reconcile.js`)

| Check | Tolerance |
|---|---|
| PF member rows = "Total Members" | exact |
| Σ EE = "Total EPF Contribution" | ±₹0.5 |
| Σ EPS = "Total EPS Contribution" | ±₹0.5 |
| Σ ER = "Total EPF-EPS Contribution" | ±₹0.5 |
| Σ IP contribution = "Total IP Contribution" | ±₹0.5 |
| Σ wages = "Total Monthly Wages" | ±₹0.5 |

A total that isn't printed is shown as "n/a". A failure **doesn't stop the run**: it appears in red in the Summary sheet and the UI ("verdicts may be incomplete"). This is what makes "don't hard-code to the sample" safe. If an unseen layout breaks a column, the sums stop matching and you see it.

## 5. Identifiers (`verify/ids.js`)
IDs are always digit **strings**: `999912340001` (number), `9.99912340001E+11`, `999912340001.0`, `'9912340001`, `9912 340 001` all normalise to the same ID. UAN must be 12 digits; IP Number 10–17 (configurable).

## 6. Name matching algorithm (`verify/names.js`)

1. **Normalise:** uppercase; cut relation suffixes (`S/O`, `D/O`, `W/O`, `C/O` and everything after); strip punctuation and digits; drop honorifics (`MR MRS MS MISS SMT SHRI SRI SHREE DR LATE MST SUSHRI`, and `KUM` only as the first word, since `KUMARI` is a real name part); expand abbreviations (`MOHD/MD/MOHAMMED… → MOHAMMAD`, `KR → KUMAR`, `KM/KU → KUMARI`, `PD → PRASAD`, `SK → SHEIKH`).
2. **Shortcuts:** identical after uppercase → **EXACT**. Identical after normalisation → **VARIANT** (honorific/abbreviation/punctuation). Identical with spaces removed → **VARIANT (spacing)**.
3. **Spacing merges:** `RAM KUMAR` ↔ `RAMKUMAR` when the merged form exists on the other side.
4. **Token match** (strongest first): exact (4) · phonetic key equal (3) · one inserted/deleted letter, both words ≥ 5 letters (2) · initial = first letter (1).
   - Phonetic key: `PH→F SH→S TH→T DH→D KH→K BH→B GH→G CK→K Q→K W→V Z→J EE→I OO→U AA→A II→I`, final `Y→I`, double letters collapsed, final `H` dropped.
   - **Substitutions are not typos:** `RAJESH`/`RAKESH`, `SUNITA`/`SUNITI` are different names.
5. **Alignment:** the best one-to-one assignment of the shorter name's tokens to the longer name's (exhaustive search; names are short). An unmatched token costs −5.
6. **Decision:**
   - Any token of the shorter name unmatched → **MISMATCH** (the detail lists the unmatched tokens on both sides).
   - Same number of tokens, no initials → **VARIANT** (word order and/or spelling).
   - Otherwise (initials or extra tokens) the **given-name guard** applies: at least one non-initial matched pair must involve a token that isn't a *common* name (`KUMAR, KUMARI, DEVI, SINGH, SHARMA, PRASAD, YADAV, GUPTA, VERMA, MISHRA, THAKUR, KHAN, …` ~40 entries). If none → **MISMATCH** ("only an initial and common names match") unless `ALLOW_INITIAL_ONLY`.
   - Passes → **PARTIAL** (extra name parts / initials, with a note) unless `ALLOW_PARTIAL_NAMES=false`.
7. **PF:** compared with both the ECR name and the UAN-repository name; best of EXACT > VARIANT > PARTIAL > MISMATCH wins; the detail records which. If the two PF names differ from each other, a note is added.

**Optional AI note** (`ai/nameOpinion.js`, `AI_NAME_OPINION=true`): for NAME_MISMATCH and PARTIAL rows only, a local Ollama model is asked "same person written differently, or different people?" and its one-line answer is appended to the notes, labelled *advisory*. It can't change a verdict, and if the model is unavailable the note is simply skipped.

## 7. Amount rules (`verify/amounts.js`)
- `diff = ECR − wagesheet` (2-decimal rounding); equal when `|diff| ≤ AMOUNT_TOLERANCE` (default ₹1).
- Evidence: `expectedPf = round(EPF wages × 12%)`; `expectedEsic = ceil(wages × 0.75%)`. The reason says whether the expectation "matches the wagesheet", "matches the deposit" or "matches neither".

## 8. Verdict gates (`verify/verdict.js`)
1. ID blank → MISSING ("No UAN in wagesheet, but ₹X was deducted"), or NOT_APPLICABLE if nothing was deducted.
2. ID malformed → MISSING ("not a valid UAN — fix the wagesheet").
3. ID not in the ECR → MISSING with the amount at risk, or NOT_APPLICABLE if nothing was deducted.
4. Name MISMATCH → NAME_MISMATCH (if the amount also differs, the reason says so).
5. `|diff| > tolerance` → AMOUNT_MISMATCH.
6. Otherwise → MATCHED (notes: name variant/partial, rounding within tolerance, ESIC reason, duplicates).

Duplicates (same ID twice in the wagesheet or the ECR) are noted on the row and listed in Data issues. The first ECR row is used.

## 9. Report (`report/workbook.js`)
Six sheets: Summary, Verification, PF, ESIC, In ECR not in wagesheet, Data issues. Status fills are blue (matched), red (name), orange (amount), black (missing) and grey (n/a). Frozen header row, autofilter, ₹ number format with negatives in red, and wrapped reason text. A CSV of the Verification view is also produced.

## 10. Testing, evaluation, and bugs the tests caught

| Suite | What |
|---|---|
| `test/names.test.js` | 39 labelled name pairs + phonetic keys + PF best-of-two |
| `test/verdict.test.js` | every gate, amounts, rounding, ID normalisation |
| `test/sample.test.js` | the provided files end to end (24 verdicts, shortfalls, reconciliation, workbook sheets, wrong-slot refusal, detection) |
| `tools/generate.js` + `tools/evaluate.js` | synthetic multi-page sets with an answer key: 1,500 and 8,000 employees |

Bugs found **by these tests during development** (all fixed):
1. The name alignment search started at score −1, so alignments containing an unmatched token were never kept and different names came back as matches. Caught by the trap pairs in the name suite.
2. The wagesheet was detected as an ESIC ECR (it mentions "ESIC" and "IP Number"). Caught on the first sample run.
3. Right-aligned 3-digit numbers sat closer to the next header's centre, so `EE` values landed in `EPS`. Caught by reconciliation (Σ EE ≠ printed total) on the synthetic set. The overlap / right-edge rule fixed it.
4. Header fragments printed **below** the anchor line weren't merged, so "EPS" (the wages column) was taken as EPS contribution. Caught by reconciliation.
5. Long names wrapping in **both** PF name columns were cut, which caused false name alarms. Caught by the answer key.

## 11. Configuration (`.env`, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4100 | API + UI |
| `AMOUNT_TOLERANCE` | 1 | ₹ difference treated as equal |
| `ALLOW_PARTIAL_NAMES` | true | extra/missing middle name → MATCHED with note |
| `ALLOW_INITIAL_ONLY` | false | initial + common names only → accept |
| `UAN_DIGITS` / `IP_DIGITS_MIN` / `IP_DIGITS_MAX` | 12 / 10 / 17 | ID shapes |
| `MONGO_URL` | (empty) | empty = `data/runs/*.json` |
| `AI_NAME_OPINION`, `OLLAMA_URL`, `AI_MODEL` | false, localhost:11434, qwen2.5:3b | optional advisory notes |
| `MAX_FILE_MB` | 50 | upload limit per file |

## 12. API

| Method | Path | |
|---|---|---|
| POST | `/api/runs` | multipart `wagesheet`, `pf`, `esic` → `{id, result}` (422 with a clear message on bad input) |
| POST | `/api/runs/sample` | run on the bundled sample |
| GET | `/api/runs` · `/api/runs/:id` | history · one run |
| GET | `/api/runs/:id/report.xlsx` · `.csv` | downloads |
| GET | `/api/health` | settings in use |

## 13. Extension guide (live-review cheat sheet)

| Ask | Change |
|---|---|
| "Our ECR calls the column 'Member Name'" | add it to the regex in `ingest/ecr.js` `PF_SPEC.columns.ecrName` |
| "Tolerance should be ₹0" | `AMOUNT_TOLERANCE=0` |
| "Accept initials" | `ALLOW_INITIAL_ONLY=true` |
| "SHK means SHEIKH" | `ABBREV` in `verify/names.js` + a pair in `names.test.js` |
| "Add a surname to the common list" | `COMMON` in `verify/names.js` |
| "Also verify the employer share" | read `er` (already parsed) → compare in `verdict.js` → new columns in `workbook.js` |
| "Why is X a name mismatch?" | the reason names the unmatched tokens and the rule; the Verification sheet has the match type |
| "Check the ESIC wage ceiling" | `wages` is parsed; add a note/gate in `verdict.js` |

## 14. Trade-offs considered

| Option | Decision |
|---|---|
| Single fuzzy score (e.g. token-sort ratio ≥ 0.8) | **Rejected:** scores `REKHA SHARMA`/`RENU SHARMA` as a match; not explainable |
| LLM decides name matches | **Rejected for verdicts:** not reproducible or auditable. Kept as an optional advisory note |
| Regex per text line for PDFs | **Rejected:** can't split the two adjacent PF name columns. Positional parsing does |
| Python (pdfplumber + rapidfuzz) | Viable; Node + pdfjs was enough and keeps one stack across case studies |
| Hard fail on reconciliation mismatch | **Rejected:** a reviewer still gets value from a mostly-correct run, but the warning is unmissable |
| Treat PARTIAL names as mismatches | Configurable; default MATCHED-with-note to avoid crying wolf on missing middle names |
