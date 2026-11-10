// One entry point used by the API, the CLI, the evaluator and the tests: files -> result (+ optional AI notes).
import { loadInputs } from './ingest/index.js';
import { verify } from './verify/index.js';
import { addNameOpinions } from './ai/nameOpinion.js';
import { CFG } from './config.js';

export async function runVerification(files) {
  const t0 = Date.now();
  const inputs = await loadInputs(files);
  const result = verify(inputs);
  if (CFG.AI_NAME_OPINION) await addNameOpinions(result);
  result.meta.ms = Date.now() - t0;
  return result;
}
