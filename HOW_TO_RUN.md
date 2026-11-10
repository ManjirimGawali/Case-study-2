# How to Run: ECR Verifier (any device)

Works on **macOS, Windows and Linux**. Free and local: no API keys, no database, no Docker, no Python. Setup takes about **5 minutes**.

## 0. Requirements
| | Minimum |
|---|---|
| Node.js | v20 or newer |
| RAM / disk | 2 GB / 500 MB |
| Internet | only for `npm install` |

## 1. Copy the project
Copy the `code/` folder to the new machine, **without `node_modules/`**. Packages are installed per machine in step 3.

```bash
# macOS / Linux, from the folder that contains code/
zip -r ecr-verifier.zip code -x "code/node_modules/*" "code/*/node_modules/*" "code/data/*"
```

## 2. Install Node.js
Check with `node -v` (it should print v20 or higher).
| OS | Install |
|---|---|
| macOS | `brew install node` or the LTS installer from https://nodejs.org |
| Windows | LTS `.msi` from https://nodejs.org (keep "Add to PATH"), then re-open the terminal |
| Ubuntu/Debian | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt-get install -y nodejs` |

## 3. Install and test
```bash
cd path/to/code
npm install
npm test        # expect: pass 54, fail 0
```

## 4. Run

**Web app**
```bash
npm run build   # first time only
npm start       # open http://localhost:4100
```
1. Pick the **wagesheet** (.xlsx / .csv / .pdf), the **PF ECR** PDF and the **ESIC ECR** PDF.
2. Click **Verify**, or click "try the provided sample files".
3. Read the summary cards and reconciliation, filter the table, and click **Download report (.xlsx)**.

**Command line**
```bash
npm run verify -- --wagesheet <wagesheet file> --pf <PF ECR.pdf> --esic <ESIC ECR.pdf> -o outputs/report.xlsx
```
On Windows, quote paths that contain spaces: `--pf "C:\Users\me\PF ECR AUG-25.pdf"`.

**Scale test**
```bash
npm run generate -- --n 8000 --out test-data/synthetic_large
npm run eval     # → outputs/eval.md
```

**Developer mode:** `npm run dev` (UI on http://localhost:5174, API on :4100).

## 5. Optional settings
Copy `.env.example` to `.env` (`cp` on macOS/Linux, `copy` on Windows cmd, `Copy-Item` in PowerShell) and change what you need:
```ini
AMOUNT_TOLERANCE=1          # ₹ difference treated as equal
ALLOW_PARTIAL_NAMES=true    # extra middle name -> matched with note
ALLOW_INITIAL_ONLY=false    # "R KUMAR" vs "RAJESH KUMAR" -> mismatch
MONGO_URL=                  # empty = files in data/runs; or mongodb://… / Atlas URL
AI_NAME_OPINION=false       # optional advisory notes from a local Ollama model
```
For the optional AI notes: install Ollama (https://ollama.com), run `ollama pull qwen2.5:3b`, then set `AI_NAME_OPINION=true`. Verdicts don't depend on it.

## 6. Troubleshooting
| Problem | Fix |
|---|---|
| `node` not found / older than 20 | Install Node 20+, re-open the terminal |
| Error mentioning `pdfjs` or `exceljs` after copying | Delete all `node_modules` folders and `package-lock.json`, then `npm install` |
| "has no text layer (scanned image?)" | The PDF is a scan. Download the ECR from the portal as a PDF, or OCR it first |
| "uploaded as the PF ECR but looks like the ESIC ECR" | The files are in the wrong slots |
| "required column(s) not found" (wagesheet) | The header row needs Name, UAN, IP Number, ESIC and PF columns (synonyms such as "Employee Name", "ESIC No", "EPF" are accepted) |
| Red reconciliation warning | Some ECR rows weren't read. Check the PDF is complete and send the layout so a header synonym can be added |
| Port in use | `PORT=4101 npm start` (macOS/Linux) or set `PORT` in `.env` |
| "UI not built" | `npm run build` |
