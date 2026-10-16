import sharp, { type Sharp } from "sharp";

/**
 * 从 URL 下载图片并拼接成一张左右并排的参考图，供 Qwen 图像编辑使用。
 *
 * 用途：搜到 top5 真实景色照片后，随机抽 2 张拼接成单图，
 * 让模型同时"看到"两个视角，提升忠实度与多样性。
 */

/** 下载一张图并缩放到统一高度（保持比例），返回 sharp 实例。 */
/** 下载一张图并缩放到统一高度（保持比例），返回 sharp 实例。带重试退避，应对源站偶发限流。 */
async function fetchAndNormalize(url: string, targetHeight: number, signal: AbortSignal): Promise<Sharp> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Wikimedia 要求请求必须带 User-Agent，否则返回 403。
      const response = await fetch(url, { signal, headers: { "User-Agent": "MakerMuse/0.1 (scene photo stitching for laser designs)" } });
      if (!response.ok) throw new Error(`download-failed:${response.status}`);
      const buf = Buffer.from(await response.arrayBuffer());
      return sharp(buf).rotate().resize({ height: targetHeight, fit: "inside", withoutEnlargement: true });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error("download-failed");
}

/**
 * 拼接两张图片为左右并排的一张 PNG（base64，不含 data: 前缀）。
 * 两张图缩放到相同高度后水平拼接，中间留一条白色分隔线。
 */
export async function stitchTwoImages(urlA: string, urlB: string, signal: AbortSignal): Promise<{ base64: string; width: number; height: number }> {
  const targetHeight = 512;
  const [imgA, imgB] = await Promise.all([
    fetchAndNormalize(urlA, targetHeight, signal),
    fetchAndNormalize(urlB, targetHeight, signal),
  ]);

  const metaA = await imgA.metadata();
  const metaB = await imgB.metadata();
  const wA = metaA.width ?? 512;
  const wB = metaB.width ?? 512;
  const hA = metaA.height ?? 512;
  const hB = metaB.height ?? 512;
  const height = Math.max(hA, hB);

  // 输出到白色画布，两张图居中并排
  const bufA = await imgA.resize({ height, fit: "inside" }).flatten({ background: "#ffffff" }).png().toBuffer();
  const bufB = await imgB.resize({ height, fit: "inside" }).flatten({ background: "#ffffff" }).png().toBuffer();

  const finalA = await sharp(bufA).metadata();
  const finalB = await sharp(bufB).metadata();
  const fwA = finalA.width ?? wA;
  const fwB = finalB.width ?? wB;
  const totalWidth = fwA + 16 + fwB; // 16px 白色分隔线

  const canvas = sharp({ create: { width: totalWidth, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } });
  const composite = await canvas
    .composite([
      { input: bufA, left: 0, top: Math.round((height - (finalA.height ?? height)) / 2) },
      { input: bufB, left: fwA + 16, top: Math.round((height - (finalB.height ?? height)) / 2) },
    ])
    .png()
    .toBuffer();

  return { base64: composite.toString("base64"), width: totalWidth, height };
}

/** 从 URL 数组中随机抽取 n 个（不改变原数组）。 */
export function sampleRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}
