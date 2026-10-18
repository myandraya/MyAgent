import { extractSceneFaithfulImage, hasImageGenConfig } from "../../../lib/image-gen.ts";
import { vectorizePhoto } from "../../../lib/photo-vectorize.ts";
import { buildCityNameXml, computeCityNameLayout } from "../../../lib/text-path.ts";
import { resolveEnglishCityName } from "../../../data/cities.ts";
import { callDeepSeekJson, hasDeepSeekKey } from "../../../lib/deepseek.ts";
import { allow, clientIp } from "../../../lib/rate-limit.ts";
import sharp from "sharp";

/**
 * 忠实实景转 SVG API：接收「已确认同一地标」的真实照片，转成正面视角黑白剪影，再矢量化。
 *
 * 可靠性要点（对齐方案 §3.5 / §7）：
 *   - 参考照片必须属于同一已确认地标，不再跨实体随机拼接；
 *   - 主参考图取质量最好的第一张，第二张仅当确为同一地标互补视角时拼接；
 *   - 下载后统一转 PNG（sharp 解码），避免 JPEG 直接进入仅按 PNG 解码的矢量化流程；
 *   - 保留并返回图片来源信息（供前端展示真实来源）。
 */

export const maxDuration = 180;

export type ScenePhotoResponse = {
  ok: boolean;
  cutPath: string;
  widthMm: number;
  heightMm: number;
  source: "faithful" | "local";
  cityNameXml?: string;
  cityNameText?: string;
  cityNamePath?: string;
  cityNameLayout?: { x: number; baselineY: number; glyphTopY: number };
  /** 锁定的地点身份 + 实际使用的参考图来源（供前端展示，不冒充实景） */
  attribution?: { title: string; pageUrl: string; license: string };
  error?: string;
};

/**
 * 下载一张图并统一转 PNG base64（不含 data: 前缀）。
 * 校验：限定超时与体积、解码成功、分辨率达标；失败返回 null。
 */
async function fetchAsPng(url: string, signal: AbortSignal): Promise<{ base64: string; width: number; height: number } | null> {
  try {
    const response = await fetch(url, {
      signal,
      headers: { "User-Agent": "MakerMuse/0.1 (scene photo retrieval)" },
    });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") ?? "0");
    // 拒绝异常大文件（> 15MB），防止恶意/损坏输入。
    if (length > 15 * 1024 * 1024) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    // sharp 解码任意格式（JPEG/PNG/WebP），统一转 PNG，保证下游 pngjs 可解。
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200) return null;
    const png = await sharp(buf).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
    return { base64: png.toString("base64"), width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/** 把用户输入（城市名或地标名）经 DeepSeek 归一化成英文城市名。 */
async function resolveCityEnViaDeepSeek(input: string, signal: AbortSignal): Promise<string> {
  if (!hasDeepSeekKey()) return "";
  const result = await callDeepSeekJson({
    signal,
    timeoutMs: 5_000,
    system: `你是地名归一化器。把输入的地点（城市名或著名地标名，可能是中文或英文）映射成它所属城市的英文名。只输出 JSON：{"cityEn":"英文城市名"}。若输入本身是城市就直接返回该城市英文名；若输入是地标则返回地标所在城市英文名；无法确定则 cityEn 为空串。不要输出其他内容。`,
    user: { input },
  });
  const cityEn = (result as { cityEn?: unknown } | null)?.cityEn;
  return typeof cityEn === "string" ? cityEn.trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  if (!allow(clientIp(request), 1, 15_000, "scene-photo")) {
    return Response.json({ error: "生成太频繁，请稍后再试。" }, { status: 429 });
  }

  let imageUrls: string[] = [];
  let cityQuery = "";
  let landmarkQuery = "";
  let attribution: { title: string; pageUrl: string; license: string } | undefined;
  try {
    const body = await request.json() as { images?: unknown; city?: unknown; landmark?: unknown; attribution?: unknown };
    if (!Array.isArray(body.images) || body.images.length === 0) throw new Error("invalid");
    imageUrls = body.images
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, 3);
    if (imageUrls.length === 0) throw new Error("invalid");
    if (typeof body.city === "string") cityQuery = body.city.trim();
    // 已确认的地标名（S03 身份贯穿）：写进图像转换指令，锁定主体不漂移。
    if (typeof body.landmark === "string") landmarkQuery = body.landmark.trim().slice(0, 80);
    if (body.attribution && typeof body.attribution === "object") {
      const a = body.attribution as Record<string, unknown>;
      attribution = {
        title: typeof a.title === "string" ? a.title : "",
        pageUrl: typeof a.pageUrl === "string" ? a.pageUrl : "",
        license: typeof a.license === "string" ? a.license : "",
      };
    }
  } catch {
    return Response.json({ error: "请提供有效的参考照片。" }, { status: 400 });
  }

  const signal = AbortSignal.timeout(90_000);

  // 1. 下载并统一转 PNG。候选按「同一地标」排序传入，主参考图 = 第一张。
  const downloaded: { base64: string; width: number; height: number }[] = [];
  for (const url of imageUrls) {
    const png = await fetchAsPng(url, signal);
    if (png) downloaded.push(png);
    if (downloaded.length >= 2) break; // 最多两张（主 + 同地标互补视角）
  }
  if (!downloaded.length) {
    return Response.json({ error: "参考照片下载失败或不可用。" }, { status: 422 });
  }

  // 2. 拼接参考图：主图必用；有第二张且为同一地标互补视角时才拼接。
  let stitched: { base64: string } | null = null;
  if (downloaded.length >= 2) {
    try {
      const combined = await stitchTwoImagesBase64(downloaded[0].base64, downloaded[1].base64);
      stitched = { base64: combined };
    } catch (error) {
      console.error("[scene-photo] 拼接参考图失败，回退单图:", error);
      stitched = { base64: downloaded[0].base64 };
    }
  } else {
    stitched = { base64: downloaded[0].base64 };
  }

  // 3. 忠实还原：Qwen 转黑白剪影（保留真实结构）。
  let result;
  let source: "faithful" | "local" = "local";
  if (hasImageGenConfig()) {
    const faithful = await extractSceneFaithfulImage({
      base64: stitched.base64,
      landmark: landmarkQuery || undefined,
      signal: AbortSignal.timeout(90_000),
      timeoutMs: 80_000,
    });
    if (faithful) {
      const candidate = await vectorizePhoto(faithful.base64, { thresholdBias: 0 });
      if (candidate.ok) {
        result = candidate;
        source = "faithful";
      }
    }
  }

  // 4. 降级：直接对主图 Otsu 二值化 + 矢量化（不做 AI 改造，最忠实）。
  if (!result) {
    const local = await vectorizePhoto(downloaded[0].base64, { thresholdBias: 0 });
    if (!local.ok) {
      return Response.json({ error: local.error ?? "照片对比度不足，无法提取轮廓。" }, { status: 422 });
    }
    result = local;
    source = "local";
  }

  // 5. 城市英文名 → 建筑下方艺术字雕刻。
  let cityNameEn = cityQuery ? resolveEnglishCityName(cityQuery) : "";
  if (!cityNameEn && cityQuery) {
    cityNameEn = await resolveCityEnViaDeepSeek(cityQuery, signal);
  }
  const nameLayout = cityNameEn ? computeCityNameLayout(cityNameEn) : null;
  const cityNameXml = nameLayout ? buildCityNameXml(cityNameEn) : "";

  return Response.json({
    ok: true,
    cutPath: result.cutPath,
    widthMm: 120,
    heightMm: 180,
    source,
    cityNameXml: cityNameXml || undefined,
    cityNameText: cityNameEn || undefined,
    cityNamePath: nameLayout ? nameLayout.path : undefined,
    cityNameLayout: nameLayout ? { x: nameLayout.x, baselineY: nameLayout.baselineY, glyphTopY: nameLayout.glyphTopY } : undefined,
    attribution,
  } satisfies ScenePhotoResponse);
}

/** 两张已是 PNG 的 base64 拼成左右并排单图（复用 sharp，避免二次下载）。 */
async function stitchTwoImagesBase64(base64A: string, base64B: string): Promise<string> {
  const targetHeight = 512;
  const imgA = sharp(Buffer.from(base64A, "base64")).resize({ height: targetHeight, fit: "inside", withoutEnlargement: true });
  const imgB = sharp(Buffer.from(base64B, "base64")).resize({ height: targetHeight, fit: "inside", withoutEnlargement: true });
  const [bufA, bufB] = await Promise.all([
    imgA.flatten({ background: "#ffffff" }).png().toBuffer(),
    imgB.flatten({ background: "#ffffff" }).png().toBuffer(),
  ]);
  const metaA = await sharp(bufA).metadata();
  const metaB = await sharp(bufB).metadata();
  const height = Math.max(metaA.height ?? 512, metaB.height ?? 512);
  const widthA = metaA.width ?? 512;
  const widthB = metaB.width ?? 512;
  const canvas = sharp({ create: { width: widthA + 16 + widthB, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } });
  const composite = await canvas
    .composite([
      { input: bufA, left: 0, top: Math.round((height - (metaA.height ?? height)) / 2) },
      { input: bufB, left: widthA + 16, top: Math.round((height - (metaB.height ?? height)) / 2) },
    ])
    .png()
    .toBuffer();
  return composite.toString("base64");
}
