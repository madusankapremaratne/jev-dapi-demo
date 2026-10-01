import { EvaluationError, parseInput } from '@/lib/evaluation';
import { evaluate } from '@/lib/providers/classify';
export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_BYTES = 32000;
export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    // Bound the streamed body as well as Content-Length, which clients can omit.
    const reader = req.body?.getReader();
    if (!reader) throw new EvaluationError('Missing request body.');
    const decoder = new TextDecoder(); let text = '', bytes = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new EvaluationError('Request is too large (32 KB maximum).', 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new EvaluationError('Request must be valid JSON.'); }
    const input = parseInput(raw);
    // Comparison mode always uses the caller's own key. No public server-key fallback.
    const key = req.headers.get(input.provider === 'openai' ? 'x-openai-key' : 'x-typesafe-key')?.trim();
    if (!key) throw new EvaluationError(`Provide your ${input.provider === 'openai' ? 'OpenAI' : 'TypeSafe'} API key.`, 401);
    if (key.length > 512 || /\s/.test(key)) throw new EvaluationError('Invalid API key format.', 401);
    return Response.json(await evaluate(input, key, req.signal), { headers });
  } catch (e) {
    return Response.json({ error: e instanceof EvaluationError ? e.message : 'Classification failed. Please try again.' }, { status: e instanceof EvaluationError ? e.status : 500, headers });
  }
}
