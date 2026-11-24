/**
 * Minimal OpenAI-compatible chat client. Works with any provider exposing
 * POST {base}/chat/completions (OpenAI, Azure OpenAI, OpenRouter, Together,
 * local servers such as Ollama or vLLM).
 *
 *   STRATUM_LLM_API_KEY   required to enable the LLM reviewer
 *   STRATUM_LLM_BASE_URL  default https://api.openai.com/v1
 *   STRATUM_LLM_MODEL     default gpt-4o-mini
 */
export function llmEnabled(): boolean {
  return !!process.env.STRATUM_LLM_API_KEY;
}

export async function chat(system: string, user: string, timeoutMs = 45_000): Promise<string> {
  const base = (process.env.STRATUM_LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.STRATUM_LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.STRATUM_LLM_MODEL ?? 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
