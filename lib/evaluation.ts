import { CATEGORY_QUESTION, DEFAULT_SCORE_QUESTION, MAX_BODY_CHARS, type Label, type ScoreQuestion } from './config';

export const PROVIDERS = ['jev', 'openai'] as const;
export type Provider = typeof PROVIDERS[number];
export const PROVIDER_NAMES: Record<Provider, string> = { jev: 'TypeSafe JEV', openai: 'OpenAI Responses' };
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
export const CATEGORIES = Object.keys(CATEGORY_QUESTION.criteria);
export const PROMPT_VERSION = 'email-comparison-v1';
export type EvaluationInput = { provider: Provider; model: string; subject: string; body: string; scoreQuestion: ScoreQuestion | null };
export type Evaluation = {
  provider: Provider; model: string; label: Label; category: string;
  spamProbability: number | null; categoryConfidence: number | null;
  score: number | null; scoreName: string | null; scoreLevels: string[];
  latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  promptVersion: string;
};
export type Outcome = { result?: Evaluation; error?: string };
export type ComparisonRow = { id: number; subject: string; truth?: Label; outcomes: Partial<Record<Provider, Outcome>> };
export class EvaluationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvaluationError('Expected an object.');
  return value as Record<string, unknown>;
}
export function parseInput(raw: unknown): EvaluationInput {
  const v = object(raw);
  if (!PROVIDERS.includes(v.provider as Provider)) throw new EvaluationError('Choose JEV or OpenAI Responses. Decisions API is not configured.');
  for (const field of ['subject', 'body']) if (typeof v[field] !== 'string') throw new EvaluationError(`${field} must be text.`);
  if (!(v.subject as string).trim() && !(v.body as string).trim()) throw new EvaluationError('Enter an email subject or body.');
  if ((v.subject as string).length > 1000) throw new EvaluationError('Subject must be at most 1,000 characters.');
  let sq: ScoreQuestion | null = DEFAULT_SCORE_QUESTION;
  if (v.scoreQuestion === null) sq = null;
  else if (v.scoreQuestion !== undefined) {
    const q = object(v.scoreQuestion);
    if (typeof q.name !== 'string' || !/^[a-z][a-z0-9_]{0,49}$/.test(q.name) || ['is_spam', 'category'].includes(q.name)) throw new EvaluationError('Use a unique score name: lowercase letters, numbers and underscores.');
    if (typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 2000) throw new EvaluationError('Score instructions must contain 1–2,000 characters.');
    if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some(c => typeof c !== 'string' || !c.trim() || c.length > 1000)) throw new EvaluationError('Provide 2–10 non-empty score levels, each at most 1,000 characters.');
    sq = { name: q.name, instructions: q.instructions, criteria: q.criteria as string[] };
  }
  const model = v.model === undefined ? DEFAULT_OPENAI_MODEL : v.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model)) throw new EvaluationError('Enter a valid OpenAI model ID.');
  return { provider: v.provider as Provider, model, subject: v.subject as string, body: (v.body as string).slice(0, MAX_BODY_CHARS), scoreQuestion: sq };
}
export const probability = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
export function validateChoice(v: unknown): string {
  if (typeof v !== 'string' || !CATEGORIES.includes(v)) throw new EvaluationError('Provider returned an unknown category.', 502);
  return v;
}
export function validateScore(v: unknown, sq: ScoreQuestion | null, integer = false): number | null {
  if (!sq) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > sq.criteria.length - 1 || (integer && !Number.isInteger(v))) throw new EvaluationError('Provider returned an invalid score.', 502);
  return v;
}
export function summary(rows: ComparisonRow[], provider: Provider) {
  const results = rows.flatMap(r => r.outcomes[provider]?.result ? [r.outcomes[provider]!.result!] : []);
  // Accuracy comparison only uses emails successfully classified by BOTH providers.
  const paired = rows.filter(r => r.truth && PROVIDERS.every(p => r.outcomes[p]?.result));
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of paired) {
    const pred = r.outcomes[provider]!.result!.label;
    if (r.truth === 'spam') pred === 'spam' ? tp++ : fn++;
    else pred === 'spam' ? fp++ : tn++;
  }
  const latencies = results.map(r => r.latencyMs).sort((a,b) => a-b);
  return {
    successes: results.length, failures: rows.filter(r => r.outcomes[provider]?.error).length,
    paired: paired.length, tp, tn, fp, fn,
    accuracy: paired.length ? (tp + tn) / paired.length : null,
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
    p50: latencies.length ? latencies[Math.ceil(latencies.length * .5) - 1] : null,
    p95: latencies.length ? latencies[Math.ceil(latencies.length * .95) - 1] : null,
    inputTokens: results.some(r => r.inputTokens !== null) ? results.reduce((n,r) => n + (r.inputTokens ?? 0), 0) : null,
    outputTokens: results.some(r => r.outputTokens !== null) ? results.reduce((n,r) => n + (r.outputTokens ?? 0), 0) : null,
  };
}
export function comparisonCsv(rows: ComparisonRow[]) {
  // Neutralise spreadsheet formulas in untrusted subjects/errors before quoting.
  const cell = (x: unknown) => { const s = String(x ?? ''); return '"' + (/^\s*[=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"'; };
  const header = ['message_id', 'truth', 'provider', 'model', 'prediction', 'category', 'spam_probability', 'category_confidence', 'score_name', 'score', 'latency_ms', 'input_tokens', 'output_tokens', 'error', 'subject'];
  return [header, ...rows.flatMap(r => PROVIDERS.filter(p => r.outcomes[p]).map(p => {
    const o = r.outcomes[p]!, v = o.result;
    return [r.id, r.truth, p, v?.model, v?.label, v?.category, v?.spamProbability, v?.categoryConfidence, v?.scoreName, v?.score, v?.latencyMs, v?.inputTokens, v?.outputTokens, o.error, r.subject];
  }))].map(r => r.map(cell).join(',')).join('\n');
}
