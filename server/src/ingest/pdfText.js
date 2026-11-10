// PDF -> positioned text, grouped into lines, for every page. No layout knowledge here.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const LINE_TOL = 2.5; // items whose baselines differ by <= this many points are on the same line

/**
 * @returns {Promise<{pages: Array<{num, lines: Array<{y, items: Array<{x0,x1,cx,s}>}>}>, text: string, hasText: boolean}>}
 */
export async function readPdf(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  let chars = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => {
        const x0 = i.transform[4];
        const x1 = x0 + (i.width || i.str.length * 4);
        return { x0, x1, cx: (x0 + x1) / 2, y: i.transform[5], s: i.str.trim() };
      });
    chars += items.reduce((s, i) => s + i.s.length, 0);
    pages.push({ num: n, lines: groupLines(items) });
    page.cleanup();
  }
  await doc.destroy();
  const text = pages.map((p) => p.lines.map((l) => l.items.map((i) => i.s).join(' ')).join('\n')).join('\n');
  return { pages, text, hasText: chars > 20 };
}

/** Group items into lines top-to-bottom (PDF y grows upwards), items left-to-right. */
function groupLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= LINE_TOL);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x0 - b.x0);
  return lines.sort((a, b) => b.y - a.y);
}
