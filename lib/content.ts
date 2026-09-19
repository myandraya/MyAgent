import type { City } from "./types.ts";

export type GeneratedContent = {
  poem: [string, string];
  summary: string;
  source: "deepseek" | "offline";
};

export function fallbackContent(city: City, date: string, tags: string[] = []): GeneratedContent {
  const memory = tags.length ? `，记忆关键词：${tags.join("、")}` : "";
  return {
    poem: city.poem,
    summary: `${city.name} · ${date} · 当地 22:00${memory}`,
    source: "offline"
  };
}

export function parseGeneratedContent(value: unknown, fallback: GeneratedContent): GeneratedContent {
  let candidate = value;
  if (typeof value === "string") {
    try { candidate = JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
    catch { return fallback; }
  }
  if (!candidate || typeof candidate !== "object") return fallback;
  const record = candidate as Record<string, unknown>;
  if (!Array.isArray(record.poem) || record.poem.length !== 2 || typeof record.poem[0] !== "string" || typeof record.poem[1] !== "string" || typeof record.summary !== "string") return fallback;
  const chinese = record.poem[0].trim();
  const english = record.poem[1].trim();
  const summary = record.summary.trim();
  if (!chinese || !english || !summary || chinese.length > 48 || english.length > 120 || summary.length > 100) return fallback;
  return { poem: [chinese, english], summary, source: "deepseek" };
}
