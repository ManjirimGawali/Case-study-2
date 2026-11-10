// Every tunable rule in one place. Defaults are the documented decisions (see README "Matching tolerance").
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(ROOT, '.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

export const CFG = {
  PORT: num(process.env.PORT, 4100),
  MONGO_URL: process.env.MONGO_URL || '',

  // Amounts: |ECR - wagesheet| <= tolerance (rupees) counts as equal. ±1 absorbs statutory rounding
  // (EPFO rounds to nearest rupee, ESIC rounds up) but never hides a real shortfall.
  AMOUNT_TOLERANCE: num(process.env.AMOUNT_TOLERANCE, 1),

  // Names
  ALLOW_PARTIAL_NAMES: bool(process.env.ALLOW_PARTIAL_NAMES, true),   // extra middle/father name allowed -> MATCHED with note
  ALLOW_INITIAL_ONLY: bool(process.env.ALLOW_INITIAL_ONLY, false),    // "R KUMAR" vs "RAJESH KUMAR" -> mismatch unless true

  // Identifier shapes (digits only, after removing spaces). Configurable in case a portal changes format.
  UAN_DIGITS: num(process.env.UAN_DIGITS, 12),
  IP_DIGITS_MIN: num(process.env.IP_DIGITS_MIN, 10),
  IP_DIGITS_MAX: num(process.env.IP_DIGITS_MAX, 17),

  // Statutory rates, only used for the "expected from ECR wages" evidence column
  PF_RATE: 0.12,
  ESIC_RATE: 0.0075,

  // Optional local-LLM second opinion on borderline names (advisory only, never changes a verdict)
  AI_NAME_OPINION: bool(process.env.AI_NAME_OPINION, false),
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  AI_MODEL: process.env.AI_MODEL || 'qwen2.5:3b',

  MAX_FILE_MB: num(process.env.MAX_FILE_MB, 50),
};
