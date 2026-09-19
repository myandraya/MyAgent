export function hasDeepSeekKey(key = process.env.DEEPSEEK_API_KEY) {
  return Boolean(key && !/placeholder|replace|your[_-]?deepseek/i.test(key));
}

export async function callDeepSeekJson(input: { system: string; user: unknown; signal: AbortSignal; timeoutMs?: number }): Promise<unknown | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!hasDeepSeekKey(apiKey)) return null;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 6_000)]),
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
        response_format: { type: "json_object" },
        stream: false,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: JSON.stringify(input.user) }
        ]
      })
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: { message?: { content?: unknown } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
}
