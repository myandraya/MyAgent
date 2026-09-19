/**
 * 图像生成调用 —— 阿里云百炼 Qwen-Image（DashScope 原生接口）。
 *
 * 环境变量：
 *   DASHSCOPE_API_KEY      Bearer token（百炼控制台获取）
 *   DASHSCOPE_WORKSPACE_ID 业务空间 ID（可选，用于专属域名）
 *   QWEN_IMAGE_MODEL       默认 qwen-image-3.0（同时支持生成与编辑）
 *
 * Qwen-Image 只返回 URL，这里额外 fetch 下载 PNG → base64 供矢量化使用。
 * 未配置 key 时返回 null，由上层降级到参数化生成器。
 */

export function hasImageGenConfig(): boolean {
  const key = process.env.DASHSCOPE_API_KEY;
  return Boolean(key && !/placeholder|replace|your[_-]?dashscope/i.test(key));
}

export type GeneratedImage = {
  /** PNG base64（不含 data: 前缀） */
  base64: string;
  size: number;
};

function endpoint(): string {
  const ws = process.env.DASHSCOPE_WORKSPACE_ID;
  if (ws) return `https://${ws}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
  return "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
}

type QwenImageContent = { image: string } | { text: string };

async function requestQwenImage(
  content: QwenImageContent[],
  parameters: Record<string, unknown>,
  signal: AbortSignal,
): Promise<GeneratedImage | null> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY!}` },
    signal,
    body: JSON.stringify({
      model: process.env.QWEN_IMAGE_MODEL || "qwen-image-3.0",
      input: { messages: [{ role: "user", content }] },
      parameters,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as {
    output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
  };
  const imageUrl = payload.output?.choices?.[0]?.message?.content?.find((item) => typeof item.image === "string")?.image;
  if (!imageUrl) return null;
  const imageResponse = await fetch(imageUrl, { signal });
  if (!imageResponse.ok) return null;
  return { base64: Buffer.from(await imageResponse.arrayBuffer()).toString("base64"), size: 1024 };
}

/** 场景主体类型，决定 Qwen prompt 策略。 */
export type SubjectType = "city" | "nature";

/** 通用约束：黑白、镂空、高对比、激光切割友好。 */
const COMMON_CONSTRAINTS = [
  "White background, pure black foreground mass, no text, no gradient, no shading, no border, no fine lines.",
  "Minimalist, high contrast, centered composition, suitable for laser cutting.",
  "Design for laser cutting: white areas are holes to be cut out, fully enclosed by black mass.",
  "Every black region and every white hole must have a complete closed boundary; no open strokes or loose line ends.",
].join(" ");

/** 根据检索后的城市视觉简报构建 Qwen prompt。 */
function buildPrompt(input: {
  landmark: string;
  landmarkEn?: string;
  city: string;
  cityEn?: string;
  country?: string;
  visualAnchors?: string[];
  composition?: string;
  subjectType: SubjectType;
}): string {
  const location = [input.cityEn || input.city, input.country].filter(Boolean).join(", ");
  const subject = input.landmarkEn && input.landmarkEn !== input.landmark
    ? `${input.landmark} (${input.landmarkEn})`
    : input.landmark;
  const anchors = input.visualAnchors?.filter(Boolean).slice(0, 4).join(", ");
  const identity = anchors ? `Recognizable visual anchors: ${anchors}.` : "";
  const composition = input.composition ? `Composition: ${input.composition}` : "";
  switch (input.subjectType) {
    case "nature":
      return [
        `Create a recognizable black-and-white laser engraving silhouette of ${subject} in ${location}.`,
        identity,
        composition,
        "Show one geographically coherent real landscape, not a symbolic or imaginary composite.",
        "Keep the main landform as the dominant connected black silhouette; use enclosed white openings only for meaningful geographic gaps.",
        COMMON_CONSTRAINTS,
      ].filter(Boolean).join(" ");
    case "city":
    default:
      return [
        `Create a recognizable black-and-white laser engraving silhouette centered on ${subject} in ${location}.`,
        identity,
        composition,
        "Depict this one real landmark or streetscape only; do not combine unrelated landmarks or invent architecture.",
        "Preserve its characteristic roofline, towers, arches, facade rhythm, and enclosed window or doorway openings.",
        "Remove cars, crowds, signs, sky texture, floating ornaments, and detached background fragments.",
        COMMON_CONSTRAINTS,
      ].filter(Boolean).join(" ");
  }
}

/**
 * 生成黑白镂空剪影。Qwen-Image prompt 根据 subjectType 动态调整：
 *   - city: 建筑外轮廓 + 窗户/门孔洞
 *   - nature: 真实自然地理景观轮廓 + 自然间隙孔洞
 */
export async function generateCitySilhouetteImage(input: {
  city: string;
  cityEn?: string;
  country?: string;
  landmark: string;
  landmarkEn?: string;
  visualAnchors?: string[];
  composition?: string;
  subjectType?: SubjectType;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<GeneratedImage | null> {
  if (!hasImageGenConfig()) return null;
  const subjectType = input.subjectType ?? "city";
  const prompt = buildPrompt({ ...input, subjectType });
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 30_000)]);
  try {
    return await requestQwenImage(
      [{ text: prompt }],
      { size: "1024*1024", n: 1, prompt_extend: false, watermark: false },
      signal,
    );
  } catch {
    return null;
  }
}

/** 用 Qwen 图像编辑提取照片主体，输出适合矢量化的纯黑白图。失败时返回 null。 */
export async function extractPhotoSubjectImage(input: {
  base64: string;
  signal: AbortSignal;
  timeoutMs?: number;
  feedback?: string;
}): Promise<GeneratedImage | null> {
  if (!hasImageGenConfig()) return null;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 45_000)]);
  const prompt = [
    input.feedback ? "Revise the current black-and-white subject using the vector audit feedback below." : "Identify the single main subject in this image and isolate it.",
    input.feedback ? `Vector audit feedback: ${input.feedback}` : "",
    "Remove the entire background and every unrelated object, person, shadow, texture, sky mark, ground mark, and floating fragment.",
    "Preserve the subject's recognizable outer silhouette and meaningful enclosed openings.",
    "Render the retained subject as one connected pure black mass on a pure white background.",
    "The black subject must contain 2 to 8 large, clearly visible, fully enclosed white cutouts derived from real structural openings or recognizable internal negative spaces.",
    "Each white cutout must be at least 24 pixels wide at 1024px output and must not touch the outside white background.",
    "Use only pure black and pure white: no gray, no gradient, no shading, no text, no border, no isolated marks.",
    "Do not invent new structures or change the subject's proportions.",
  ].filter(Boolean).join(" ");
  try {
    return await requestQwenImage(
      [{ image: `data:image/png;base64,${input.base64}` }, { text: prompt }],
      { n: 1, prompt_extend: false, watermark: false },
      signal,
    );
  } catch {
    return null;
  }
}
