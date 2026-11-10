// Load the three inputs, detect what each document really is, and parse it.
import { readPdf } from './pdfText.js';
import { parsePfEcr, parseEsicEcr } from './ecr.js';
import { parseWagesheet } from './wagesheet.js';

const isPdf = (b) => b.length > 4 && b.subarray(0, 5).toString() === '%PDF-';

export function detectKind(text) {
  const T = text.toUpperCase();
  if (/PROVIDENT FUND|ELECTRONIC CHALLAN|\bEPFO\b/.test(T) && /\bUAN\b/.test(T)) return 'PF';
  // the wagesheet itself mentions "ESIC" and "IP Number", so ESIC needs markers only the authority's document has
  if (/STATE INSURANCE|CONTRIBUTION HISTORY|IP CONTRIBUTION/.test(T) && /IP NUMBER|IP NO/.test(T)) return 'ESIC';
  if (/\bUAN\b/.test(T) && /\bNAME\b/.test(T)) return 'WAGESHEET';
  return 'UNKNOWN';
}

async function loadEcr(file, expected) {
  if (!isPdf(file.buffer)) throw new Error(`${expected} ECR "${file.name}" is not a PDF`);
  const pdf = await readPdf(file.buffer);
  if (!pdf.hasText) throw new Error(`${expected} ECR "${file.name}" has no text layer (scanned image?). Download the ECR from the portal as a PDF, or OCR it first.`);
  const kind = detectKind(pdf.text);
  if (kind !== expected) throw new Error(`"${file.name}" was uploaded as the ${expected} ECR but looks like ${kind === 'UNKNOWN' ? 'a different document' : `the ${kind === 'WAGESHEET' ? 'wagesheet' : kind + ' ECR'}`}`);
  const parsed = expected === 'PF' ? parsePfEcr(pdf) : parseEsicEcr(pdf);
  if (!parsed.rows.length) throw new Error(`${expected} ECR "${file.name}": no member rows recognised (${parsed.warnings.join('; ') || 'header not found'})`);
  return { ...parsed, file: file.name };
}

/**
 * @param {{wagesheet:{name,buffer}, pf:{name,buffer}, esic:{name,buffer}}} files
 */
export async function loadInputs(files) {
  const ws = files.wagesheet;
  let pdf = null;
  if (isPdf(ws.buffer)) {
    pdf = await readPdf(ws.buffer);
    if (!pdf.hasText) throw new Error(`Wagesheet "${ws.name}" has no text layer (scanned image?)`);
    const k = detectKind(pdf.text);
    if (k === 'PF' || k === 'ESIC') throw new Error(`"${ws.name}" was uploaded as the wagesheet but looks like the ${k} ECR`);
  }
  const wagesheet = { ...(await parseWagesheet(ws.buffer, ws.name, pdf)), file: ws.name };
  const [pf, esic] = await Promise.all([loadEcr(files.pf, 'PF'), loadEcr(files.esic, 'ESIC')]);
  return { wagesheet, pf, esic };
}
