# ECR Verifier: Case Study 2 (Wagesheet vs PF/ESIC ECR)

This tool checks, **employee by employee**, that the PF and ESIC a vendor deducted in its wagesheet was actually deposited with EPFO and ESIC: **right person, right identifier, right amount**. The output is a downloadable **Excel report** with a verdict and reason per employee for **PF and ESIC separately**, plus summary counts.

- **Free and local:** no API keys, no cloud, no database required.
- **Deterministic:** the same files always give the same verdicts, and every verdict carries a human-readable reason (what compliance needs).
- **Built for real volumes:** tested on a 175-page PF ECR + 197-page ESIC ECR (8,000 employees) in about 3 seconds.

> Setting it up on another computer? See **`HOW_TO_RUN.md`**. Full design: **`DETAILS.md`**. Study guide with diagrams and review questions: open **`explainer.html`** in a browser.

---

## 1. Run it locally (≈5 minutes)

Needs **Node.js 20+** only.

```bash
cd code
npm install
npm test                 # 54 tests, ~1 s
```

**Web app**
```bash
npm run build            # once
npm start                # → http://localhost:4100
```
Choose the three files (wagesheet, PF ECR, ESIC ECR) and click **Verify**, or click *"try the provided sample files"*. You get summary cards, the reconciliation checks, a filterable table, and **Download report (.xlsx)**.

**Command line**
```bash
npm run verify -- --wagesheet "test-data/Sample_Wagesheet_Aug25.xlsx - Sheet1.pdf" \
                  --pf "test-data/PF ECR AUG-25 SAMPLE.pdf" \
                  --esic "test-data/ESIC ECR AUG-25 SAMPLE.pdf" \
                  -o outputs/sample_report.xlsx
```
This writes `report.xlsx` and `report.csv` (add `--json` for the full result).

**Scale test (optional)**
```bash
npm run generate -- --n 8000 --out test-data/synthetic_large   # multi-page ECRs + answer key
npm run eval                                                     # → outputs/eval.md
```

Inputs: the wagesheet can be **.xlsx, .csv or PDF** (the provided sample was a PDF export of the Excel file). The ECRs are the **PDFs downloaded from the EPFO / ESIC portals**.

---

## 2. Verdicts

For every wagesheet employee, separately for PF and ESIC:

| Verdict | Meaning |
|---|---|
| **MATCHED** | ID found, name matches (exactly or as an accepted variant), amount within ±₹1 |
| **NAME_MISMATCH** | ID found, but the ECR name is a different person by our tolerance rules. Both names and the failing part are shown; if the amount also differs, that is reported too |
| **AMOUNT_MISMATCH** | ID and name match, amount differs by more than ₹1. Shows deducted, deposited, the signed difference, and what the statutory rate on the ECR wages gives (so you can tell whether the wagesheet or the deposit is off) |
| **MISSING** | UAN / IP Number not in the ECR, or blank or invalid in the wagesheet. Shows the deducted amount at risk |
| **NOT_APPLICABLE** | ID absent from the ECR **and** nothing was deducted (e.g. above the ESIC wage ceiling), so there is nothing to deposit |

Precedence follows the brief: Missing → Name mismatch → Amount mismatch → Matched.

---

## 3. Name-matching tolerance (the core decision)

Names are compared only **after** the identifier has matched, so the question is "is this the same person, written differently?". I used **layered, explainable rules** rather than one fuzzy score, because a score of ~0.8 can't tell `REKHA SHARMA` from `RENU SHARMA` (they share a surname).

**Accepted as the same person (no false alarms):**

| Variation | Example | Shown as |
|---|---|---|
| Case, punctuation, spacing | `Anil  Kumar.` = `ANIL KUMAR` | EXACT |
| Word order | `KUMAR ANIL` = `ANIL KUMAR` | VARIANT |
| Phonetic spelling (Indian-name aware: OO/U, EE/I, TH/T, SH/S, PH/F, W/V, double letters) | `POOJA` = `PUJA`, `KAVITHA` = `KAVITA` | VARIANT |
| Honorifics | `SMT. SUNITA DEVI` = `SUNITA DEVI` | VARIANT |
| Abbreviations | `MOHD` = `MOHAMMAD`, `KR` = `KUMAR` | VARIANT |
| Relation suffix | `RAMESH S/O SURESH` = `RAMESH` | VARIANT |
| Joined / split words | `RAMKUMAR` = `RAM KUMAR` | VARIANT |
| One extra or missing letter (5+ letter words) | `RAJESHH` = `RAJESH` | VARIANT |
| Extra middle or father's name | `RAJESH SHARMA` ≈ `RAJESH KUMAR SHARMA` | PARTIAL (matched, with a note) |

**Flagged as different people (genuine mismatches caught):**

| Case | Example | Why |
|---|---|---|
| Shared surname, different given name | `DINESH PRASAD` ≠ `DEVENDRA PRASAD` (sample) | a common surname never makes a match on its own |
| Similar given name | `REKHA SHARMA` ≠ `RENU SHARMA` (sample) | different tokens, phonetic keys differ |
| One-letter **substitution** | `RAJESH` ≠ `RAKESH`, `SUNITA` ≠ `SUNITI` | substitutions only count via phonetic rules (typo rule = insert/delete only) |
| Short names that differ by a letter | `ANIL` ≠ `SUNIL`, `NEHA` ≠ `SNEHA` | typo tolerance only for words of 5+ letters |
| Prefix names | `PRIYA` ≠ `PRIYANKA` | different names |
| Only an initial + common surname | `R. KUMAR SHARMA` vs `RAJESH KUMAR SHARMA` | too weak for a compliance sign-off (switch with `ALLOW_INITIAL_ONLY=true`) |

**PF has two names per member** ("Name as per ECR" and "Name as per UAN Repository"). The wagesheet name is compared with both, the better result wins, and the detail says which one matched.

All of the above is a test suite of 39 labelled name pairs (`server/test/names.test.js`). Tunable switches: `ALLOW_PARTIAL_NAMES`, `ALLOW_INITIAL_ONLY` (see `.env.example`).

## 4. Amount tolerance

- PF @ 12% (wagesheet) vs **EE share** (PF ECR). ESIC @ 0.75% vs **IP contribution** (ESIC ECR).
- Equal if **|ECR − wagesheet| ≤ ₹1** (`AMOUNT_TOLERANCE`). EPFO rounds to the nearest rupee and ESIC rounds up, so ±₹1 absorbs rounding but never a real gap.
- Difference = ECR − wagesheet (negative = short-deposited).
- Evidence column: **expected from ECR wages** (12% of EPF wages; 0.75% of wages rounded up). For example: *"Deposited ₹1,354 vs deducted ₹1,654, short by ₹300. 12% of ECR EPF wages = ₹1,654 (matches the wagesheet)"*, which tells the reviewer the deposit is the problem.

---

## 5. How it works

```
wagesheet (.xlsx/.csv/.pdf) ─┐
PF ECR PDF ──► positional parse ─► reconcile vs printed totals ─┐
ESIC ECR PDF ─► positional parse ─► reconcile vs printed totals ─┼─► join on UAN / IP ─► name rules ─► amount rule ─► verdict + reason ─► report.xlsx
                                                                 ┘
```

1. **Header-driven positional parsing (no hard-coding to the sample).** PDF text is read with coordinates (`pdfjs-dist`). On every page the header row is found by keywords (`UAN`, `Name as per ECR`, `EE`, `IP Number`, `IP Contribution`…), including headers split over two lines, above or below. Cells are assigned to columns by header overlap; right-aligned numbers go by their right edge. Only lines with a valid ID shape are data. Continuation pages without a header reuse the previous columns, and wrapped long names are re-joined. The two adjacent PF name columns, which run together as `ANIL KUMAR ANIL KUMAR` in plain text, are separated correctly.
2. **Reconciliation, so the parse proves itself.** Parsed rows are checked against the totals printed on each ECR: member count, Σ EE, Σ EPS, Σ ER, Σ IP contribution, Σ wages. Any failure is shown in red at the top of the report, so a partial parse can't pass silently on a 300-page file.
3. **Join by identifier** (UAN for PF, IP Number for ESIC), with IDs normalised as text (Excel numbers, `9.99E+11`, `.0`, spaces).
4. **Name rules → amount rule → verdict with reason.**
5. **Report** (`exceljs`), with these sheets:

| Sheet | Contents |
|---|---|
| Summary | counts per verdict (PF, ESIC), ₹ deducted / deposited / short, reconciliation ✔/✖, rules used |
| Verification | one row per employee, PF and ESIC side by side: status, reason, ECR name, match type, deducted, deposited, difference, expected |
| PF · ESIC | the same verdicts, one sheet per authority |
| In ECR not in wagesheet | deposits for people who aren't on the vendor's sheet |
| Data issues | blank or invalid IDs, duplicates, wage-month mismatch, parser warnings |

Status cells are colour-coded; every sheet has frozen headers and filters.

**Stack:** Node.js + Express + React (Vite). PDFs via `pdfjs-dist`, Excel via `exceljs`. Storage is a JSON file by default (`data/runs`) or MongoDB if `MONGO_URL` is set. There is **no LLM in the verdict path**: compliance answers must be reproducible and auditable. An optional local LLM (`AI_NAME_OPINION=true`, Ollama, free) only adds an *advisory* note on borderline names.

---

## 6. Results

### Provided sample (`outputs/sample_report.xlsx`)
**24/24 verdicts match the hand-worked answer.** All 6 reconciliation checks pass.

| | Matched | Name mismatch | Amount mismatch | Missing | Short-deposited |
|---|---|---|---|---|---|
| **PF** | 9 | 1: DINESH PRASAD vs ECR "DEVENDRA PRASAD" | 1: VIKRAM THAKUR, ₹1,354 vs ₹1,654 (−₹300) | 1: SANJAY PASWAN | ₹1,610 |
| **ESIC** | 8 | 1: REKHA SHARMA vs ECR "RENU SHARMA" | 1: NEHA MISHRA, ₹66 vs ₹86 (−₹20) | 2: SANJAY PASWAN, POOJA GUPTA | ₹194 |

### Synthetic scale sets (`outputs/eval.md`)
Generated with `tools/generate.js`. Each set has an answer key. They include name variants, genuine look-alike mismatches, ±₹1 rounding, shortfalls, missing and extra IDs, blank UANs, wrapped long names, a PF header repeated on every page, ESIC continuation pages with no header, and an `.xlsx` wagesheet with title rows and numeric IDs.

| Set | Pages (PF / ESIC) | Verdicts correct | Missed real name mismatches | False name alarms | Time |
|---|---|---|---|---|---|
| 1,500 employees | 34 / 38 | 3,000 / 3,000 | 0 | 0 | ~0.6 s |
| 8,000 employees | 175 / 197 | 16,000 / 16,000 | 0 | 0 | ~3 s |

These synthetic sets prove scale and parsing robustness, but **I chose their variations myself**. They aren't evidence that every real-world name variant is covered. The three bugs this testing caught are listed in `DETAILS.md` §10.

---

## 7. Assumptions
- The identifier is the key: a UAN or IP Number match decides **who** the ECR row is; the name only confirms it.
- The employee share is what's verified (PF EE share; ESIC IP contribution), as the brief specifies.
- One wagesheet and one ECR of each type per run, for the same wage month (a month mismatch is reported as a data issue).
- ECR PDFs have a text layer (as downloaded from the portals).
- UAN = 12 digits; IP Number = 10–17 digits (configurable).

## 8. Known limitations
- **Scanned (image-only) PDFs** are refused with a clear message. There's no OCR yet.
- **Header wording** is matched by keyword synonyms. A portal redesign that renames a column needs one synonym added (an unmapped column is reported as a warning, and reconciliation catches gaps).
- **Names:** nicknames and rare transliterations (`BABLU` for `RAJESH`) can't be resolved by rules. They surface as NAME_MISMATCH, which is the safe direction. Partial matches are counted as MATCHED with a note (configurable).
- **The name rules are tuned for Indian names** (common-surname list, phonetic map). Other naming conventions would need the lists extended.
- **Tested formats:** the provided sample layouts plus synthetic imitations. Real ECR variants I haven't seen (other portal versions, other export tools) may need a synonym or a tweak.
- Only the employee share is checked. Employer share, wage-ceiling compliance and NCP-day consistency are not.

## 9. What I'd improve with more time
1. OCR fallback for scanned ECRs (tesseract), with reconciliation as the safety net.
2. A reviewer workflow: accept/reject each NAME_MISMATCH, remember approved pairs per vendor, and export an audit trail.
3. Multi-month and multi-vendor batches with trend dashboards (repeat offenders, chronic short deposits).
4. More checks: employer share, ESIC wage ceiling, EPF wage cap, NCP days vs wages.
5. An optional LLM-assisted column mapping for unknown wagesheet layouts, always confirmed by a human.

---

## 10. Project structure
```
code/
├── README.md · DETAILS.md · HOW_TO_RUN.md · explainer.html
├── package.json · .env.example · .gitignore
├── server/src/
│   ├── index.js · cli.js · run.js · config.js
│   ├── ingest/   pdfText.js (positions) · table.js (header-driven tables) · ecr.js (PF, ESIC) · wagesheet.js · index.js (detect + load)
│   ├── verify/   ids.js · names.js · amounts.js · reconcile.js · verdict.js · index.js
│   ├── report/   workbook.js (xlsx + csv)
│   ├── routes/   runs.js       store/  fileStore.js · mongoStore.js
│   └── ai/       nameOpinion.js (optional, advisory)
├── server/test/  names (39 pairs) · verdict · sample end-to-end
├── client/       React page
├── tools/        generate.js (synthetic multi-page data + answer key) · evaluate.js
├── test-data/    provided sample · synthetic (1,500) · synthetic_large (8,000)
└── outputs/      sample_report.xlsx/.csv/.json · synthetic*_report.xlsx · eval.md
```
