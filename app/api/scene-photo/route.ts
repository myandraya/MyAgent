import { extractSceneFaithfulImage, hasImageGenConfig } from "../../../lib/image-gen.ts";
import { vectorizePhoto } from "../../../lib/photo-vectorize.ts";
import { allow, clientIp } from "../../../lib/rate-limit.ts";
import { stitchTwoImages, sampleRandom } from "../../../lib/photo-stitch.ts";

/**
 * 忠实实景转 SVG API：接收真实景色照片 URL 数组（top5），
 * 随机抽 2 张拼接成一张参考图，用"忠实还原"模式转成黑白剪影，再矢量化。
 *
 * 与 /api/photo 的区别：
 *   - 用 extractSceneFaithfulImage（保留真实结构，不删背景、不补孔洞）
 *   - 不做"补 2~8 个孔洞"的修复循环
 *   - 输出里带 source 标记，前端用于区分"真实照片还原" vs "写意兜底"
 */

export const maxDuration = 180;

export type ScenePhotoResponse = {
  ok: boolean;
  cutPath: string;
  widthMm: number;
  heightMm: number;
  source: "faithful" | "local";
  error?: string;
};

export async function POST(request: Request): Promise<Response> {
  if (!allow(clientIp(request), 1, 15_000)) {
    return Response.json({ error: "生成太频繁，请稍后再试。" }, { status: 429 });
  }

  let imageUrls: string[] = [];
  try {
    const body = await request.json() as { images?: unknown };
    if (!Array.isArray(body.images) || body.images.length === 0) throw new Error("invalid");
    imageUrls = body.images
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, 5);
    if (imageUrls.length === 0) throw new Error("invalid");
  } catch {
    return Response.json({ error: "请提供有效的参考照片。" }, { status: 400 });
  }

  const signal = AbortSignal.timeout(90_000);

  // 1. 随机抽 2 张照片，拼接成一张参考图（后端随机，职责集中）
  let stitched: { base64: string } | null = null;
  try {
    const two = sampleRandom(imageUrls, 2);
    stitched = await stitchTwoImages(two[0], two[1], signal);
  } catch (error) {
    console.error("[scene-photo] 拼接参考图失败:", error);
    // 拼接失败则降级：用第一张单图
    try {
      const response = await fetch(imageUrls[0], { signal, headers: { "User-Agent": "MakerMuse/0.1 (scene photo retrieval)" } });
      if (response.ok) {
        const buf = Buffer.from(await response.arrayBuffer());
        stitched = { base64: buf.toString("base64") };
      }
    } catch {
      /* 单图兜底也失败，走本地 Otsu */
    }
  }

  if (!stitched) {
    return Response.json({ error: "无法下载参考照片。" }, { status: 422 });
  }

  // 2. 忠实还原：Qwen 转黑白剪影（保留真实结构）
  let result;
  let source: "faithful" | "local" = "local";
  if (hasImageGenConfig()) {
    const faithful = await extractSceneFaithfulImage({ base64: stitched.base64, signal: AbortSignal.timeout(90_000), timeoutMs: 80_000 });
    if (faithful) {
      const candidate = await vectorizePhoto(faithful.base64, { thresholdBias: 0 });
      if (candidate.ok) {
        result = candidate;
        source = "faithful";
      }
    }
  }

  // 3. 降级：直接对拼接图 Otsu 二值化 + 矢量化（不做 AI 改造，最忠实）
  if (!result) {
    const local = await vectorizePhoto(stitched.base64, { thresholdBias: 0 });
    if (!local.ok) {
      return Response.json({ error: local.error ?? "照片对比度不足，无法提取轮廓。" }, { status: 422 });
    }
    result = local;
    source = "local";
  }

  return Response.json({
    ok: true,
    cutPath: result.cutPath,
    widthMm: 180,
    heightMm: 120,
    source,
  } satisfies ScenePhotoResponse);
}
