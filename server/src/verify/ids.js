// Identifier normalisation. IDs are always handled as digit STRINGS — never numbers — so Excel's
// 9.99912E+11, "999912340001.0", leading apostrophes or spaces can't change them.
import { CFG } from '../config.js';

export function normId(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : String(v);
  s = s.trim().replace(/^'+/, '');
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  if (/^\d(\.\d+)?E\+\d+$/i.test(s)) s = Number(s).toFixed(0); // scientific notation from Excel
  return s.replace(/[\s-]/g, '');
}

export const isUan = (id) => new RegExp(`^\\d{${CFG.UAN_DIGITS}}$`).test(id);
export const isIp = (id) => new RegExp(`^\\d{${CFG.IP_DIGITS_MIN},${CFG.IP_DIGITS_MAX}}$`).test(id);
