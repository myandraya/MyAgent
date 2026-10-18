import { allow, clientIp } from "../../../lib/rate-limit.ts";
import { searchLandmarkPhotos, type PhotoCandidate } from "../../../lib/photo-search.ts";

/**
 * 参考照片搜索 API：根据地名检索真实景色照片。
 * 检索逻辑已提取到 lib/photo-search.ts（与文字入口 scene 共用）。
 */

export type PhotoSearchResponse = {
  ok: boolean;
  query: string;
  candidates: PhotoCandidate[];
};

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  if (!allow(clientIp(request), 10, 10_000, "photo-search")) {
    return Response.json({ error: "搜索太频繁，请稍后再试。" }, { status: 429 });
  }
  let query = "";
  try {
    const body = await request.json() as { query?: unknown };
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 120) throw new Error("invalid");
    query = body.query.trim();
  } catch {
    return Response.json({ error: "请输入有效的搜索地名。" }, { status: 400 });
  }

  try {
    const signal = AbortSignal.timeout(12_000);
    const candidates = await searchLandmarkPhotos(query, signal);
    return Response.json({ ok: true, query, candidates } satisfies PhotoSearchResponse);
  } catch (error) {
    console.error("[photo-search] 搜索异常:", error);
    return Response.json({ ok: true, query, candidates: [] } satisfies PhotoSearchResponse);
  }
}
