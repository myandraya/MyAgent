import { allow, clientIp } from "../../../lib/rate-limit.ts";

/**
 * 参考照片搜索 API：根据定位结果检索真实景色照片，自动选最相关的一张做主参考。
 *
 * 来源：Wikimedia Commons（公开 API，无需 key）。
 *   - 先按地名搜文件标题（generator=search，namespace=6 文件）
 *   - 再用 imageinfo 拉缩略图 URL 与来源/许可信息
 *   - 过滤掉图标、地图、旗帜等非景色图片
 *
 * 找不到可靠照片时返回空数组，前端据此引导用户上传照片，不冒充实景生成。
 */

export type PhotoCandidate = {
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  license: string;
};

export type PhotoSearchResponse = {
  ok: boolean;
  query: string;
  candidates: PhotoCandidate[];
};

const WIKI_API = "https://commons.wikimedia.org/w/api.php";

/** 这些关键词命中的文件通常是图标/地图/旗帜/徽章，不是景色照片，要过滤掉。 */
const NON_PHOTO_HINT = /(?:coat of arms|flag|map|locator|logo|icon|seal|diagram|chart|diagram|symbol)/i;

async function searchFiles(query: string, signal: AbortSignal): Promise<PhotoCandidate[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: "20", gsrprop: "",
    prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "640",
  });
  const response = await fetch(`${WIKI_API}?${params}`, {
    headers: { "Api-User-Agent": "MakerMuse/0.1 (scene photo retrieval for laser designs)" },
    signal,
  });
  if (!response.ok) return [];
  const payload = await response.json() as {
    query?: { pages?: { title?: string; imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; width?: number; height?: number; extmetadata?: { LicenseShortName?: { value?: string } } }[] }[] };
  };
  const pages = payload.query?.pages ?? [];
  const out: PhotoCandidate[] = [];
  for (const page of pages) {
    const title = typeof page.title === "string" ? page.title : "";
    if (!title || NON_PHOTO_HINT.test(title)) continue;
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const imageUrl = typeof info.url === "string" ? info.url : "";
    const thumbUrl = typeof info.thumburl === "string" ? info.thumburl : imageUrl;
    if (!imageUrl) continue;
    const width = typeof info.width === "number" ? info.width : 0;
    const height = typeof info.height === "number" ? info.height : 0;
    // 过滤掉过小的图标（真实景色照片通常 ≥ 400px）
    if (width > 0 && height > 0 && Math.min(width, height) < 300) continue;
    out.push({
      title,
      thumbUrl,
      imageUrl,
      pageUrl: typeof info.descriptionurl === "string" ? info.descriptionurl : "",
      width,
      height,
      license: info.extmetadata?.LicenseShortName?.value ?? "",
    });
    if (out.length >= 10) break;
  }
  return out;
}

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  if (!allow(clientIp(request), 10, 10_000)) {
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
    const signal = AbortSignal.timeout(10_000);
    // 用「地点 + 景色」扩展搜索词，提高命中真实照片的概率
    const candidates = await searchFiles(`${query} landscape`, signal);
    if (!candidates.length) {
      const fallback = await searchFiles(query, signal);
      if (!fallback.length) {
        return Response.json({ ok: true, query, candidates: [] } satisfies PhotoSearchResponse);
      }
      return Response.json({ ok: true, query, candidates: fallback } satisfies PhotoSearchResponse);
    }
    return Response.json({ ok: true, query, candidates } satisfies PhotoSearchResponse);
  } catch (error) {
    console.error("[photo-search] 搜索异常:", error);
    return Response.json({ ok: true, query, candidates: [] } satisfies PhotoSearchResponse);
  }
}
