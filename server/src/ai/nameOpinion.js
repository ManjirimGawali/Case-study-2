// OPTIONAL (AI_NAME_OPINION=true): a local LLM (Ollama, free) adds a short second-opinion note on
// borderline name pairs (NAME_MISMATCH or PARTIAL). It NEVER changes a verdict — the rules decide;
// the note only helps a reviewer prioritise. Failures are silent (the run must not depend on the model).
import { CFG } from '../config.js';

const SCHEMA = {
  type: 'object',
  properties: { same_person_likely: { type: 'boolean' }, note: { type: 'string' } },
  required: ['same_person_likely', 'note'],
};

async function ask(a, b) {
  const res = await fetch(`${CFG.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: CFG.AI_MODEL, stream: false, format: SCHEMA, options: { temperature: 0 },
      messages: [{
        role: 'user',
        content: `Two Indian employee names belong to the same PF/ESIC identifier.\nA: "${a}"\nB: "${b}"\nCould they be the same person written differently (spelling, transliteration, nickname, order), or are they different people? Answer in JSON with a one-sentence note.`,
      }],
    }),
  });
  const body = await res.json();
  return JSON.parse(body.message.content);
}

export async function addNameOpinions(result) {
  for (const { emp, pf, esic } of result.employees) {
    for (const v of [pf, esic]) {
      if (!(v.status === 'NAME_MISMATCH' || v.nameMatch === 'PARTIAL') || !v.ecrName) continue;
      try {
        const o = await ask(emp.name, v.ecrName);
        v.notes.push(`AI second opinion (advisory): ${o.same_person_likely ? 'possibly the same person' : 'likely different people'} — ${o.note}`);
      } catch {
        /* model unavailable: no note */
      }
    }
  }
}
