import { allow, clientIp } from "../../../lib/rate-limit.ts";
import { parsePlace } from "../../../lib/place-parse.ts";

/**
 * 地点解析 API：把用户整句自然语言 → 结构化地点（城市/地标/国家/氛围/置信度/是否需确认）。
 *
 * 前端主链路第一步调用：解析成功且高置信 → 用 landmark/city 去搜图；
 * 低置信 / needsConfirmation → 前端展示提示或要求用户补充，不冒充成功。
 */

export const maxDuration = 20;

export async function POST(request: Request): Promise<Response> {
  if (!allow(clientIp(request), 10, 10_000, "place-parse")) {
    return Response.json({ error: "请求太频繁，请稍后再试。" }, { status: 429 });
  }
  let text = "";
  try {
    const body = await request.json() as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 160) throw new Error("invalid");
    text = body.text.trim();
  } catch {
    return Response.json({ error: "请输入有效的描述。" }, { status: 400 });
  }

  const signal = AbortSignal.timeout(8_000);
  const place = await parsePlace(text, signal);
  return Response.json({ ok: true, place });
}
