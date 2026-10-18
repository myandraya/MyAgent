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
  if (!response.ok) {
    console.error(`[image-gen] DashScope HTTP ${response.status}:`, (await response.text()).slice(0, 400));
    return null;
  }
  const payload = await response.json() as {
    output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
  };
  const imageUrl = payload.output?.choices?.[0]?.message?.content?.find((item) => typeof item.image === "string")?.image;
  if (!imageUrl) {
    console.error("[image-gen] 响应中无 image URL:", JSON.stringify(payload).slice(0, 400));
    return null;
  }
  const imageResponse = await fetch(imageUrl, { signal });
  if (!imageResponse.ok) {
    console.error(`[image-gen] 图片下载 HTTP ${imageResponse.status}`);
    return null;
  }
  return { base64: Buffer.from(await imageResponse.arrayBuffer()).toString("base64"), size: 1024 };
}

/** 场景主体类型，决定 Qwen prompt 策略。 */
export type SubjectType = "city" | "nature";

/**
 * 共享几何镂空风格指令（§风格统一）：
 * 主路径（extractSceneFaithfulImage）与备用文生图路径（buildPrompt）共用，
 * 保证两条链路输出同一套「简洁几何镂空」视觉语言，不再出现风格分歧。
 *
 * 核心语义（对齐参考风格，不复制参考内容）：
 *   - 黑色 = 保留材料；白色 = 候选切穿开孔。
 *   - 开孔必须是宽阔、规整的几何区域，不是细白线/密集划痕。
 *   - 实体建筑用主要体块 + 开孔表达；钢架建筑用简化支撑表达，不共用一种模板。
 */
const GEOMETRIC_OPENWORK_STYLE = [
  // 目标定义：参考照片只决定「画什么」，不要求逐像素描摹。
  "Redesign the building as a clean, regular geometric openwork pattern for laser-cut wood: keep its identity and key proportions, but actively simplify the details.",
  "Keep only a few identity-defining features: the main silhouette, tower count, roof shape, clock faces, domes, arches and platforms.",
  "Merge repetitive windows, railings and ornaments into a small number of rhythmic, clearly separated geometric openings.",
  "Black means retained material; interior white areas are the cut-through openings. Every white opening must be a clear, WIDE geometric region — never thin white lines, dense scratches or speckles.",
  "Keep major supports and walls of coordinated, uniform thickness: no ultra-thin connections, no pinhole openings, no tiny isolated black fragments.",
  "Solid masonry buildings: express them with a few large masses and openings. Open steel-frame structures: express them with simplified bold struts and braces. Do not force one structural template onto both.",
  "Frontal or mildly-perspective view of the most recognizable angle; remove background, adjacent buildings and all clutter.",
  "Keep a symmetric building symmetric; keep an asymmetric building's true asymmetric character.",
  "Output ONLY the building body. No text, no frame, no horizon bar, no decorative border — those are added later by code layout.",
].join(" ");

/** 通用约束（备用文生图路径）：单主体、纯黑白、无背景、连通完整。 */
const COMMON_CONSTRAINTS = [
  "Show exactly one real landmark (or one coherent landscape), recognizable by its main structure and proportions.",
  "Pure black shapes on a pure white background: no gray, no shading, no hatching, no gradient, no texture, no text, no border, no watermark.",
  "The whole artwork must be ONE single connected piece: every black shape connects to the main body, no isolated floating islands, no thin fragile spikes.",
].join(" ");

/** 根据检索后的城市视觉简报构建 Qwen prompt（导出供测试与主路径风格对照）。 */
export function buildPrompt(input: {
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
        `Create a bold black-and-white openwork illustration of ${subject} in ${location}.`,
        identity,
        composition,
        "Show one geographically coherent real landscape, not a symbolic or imaginary composite.",
        "Draw the ridgeline and terrain structures as bold solid black masses; suggest form with a few wide, clean geometric white openings (contours, texture breaks), kept simple and sparse.",
        GEOMETRIC_OPENWORK_STYLE,
        COMMON_CONSTRAINTS,
      ].filter(Boolean).join(" ");
    case "city":
    default:
      return [
        `Create a bold black-and-white openwork illustration of exactly ONE single building: ${subject} in ${location}.`,
        identity,
        composition,
        "Show only this one building, viewed from the front (frontal or mildly-perspective elevation, like an architectural wall-art plaque). Do not draw a city skyline, a panorama, a street scene, or multiple buildings.",
        "Frame the building large in a portrait composition, occupying most of the canvas height, with generous empty white margin around it.",
        GEOMETRIC_OPENWORK_STYLE,
        COMMON_CONSTRAINTS,
      ].filter(Boolean).join(" ");
  }
}

/**
 * 生成黑白线稿。Qwen-Image prompt 根据 subjectType 动态调整：
 *   - city: 建筑外轮廓 + 窗户/门结构线
 *   - nature: 真实自然地理景观轮廓 + 地形结构线
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
  } catch (error) {
    console.error("[image-gen] 场景生图异常:", error);
    return null;
  }
}

/** 用 Qwen 图像编辑把照片主体转成线稿，输出适合矢量化的纯黑白线稿。失败时返回 null。 */
export async function extractPhotoSubjectImage(input: {
  base64: string;
  signal: AbortSignal;
  timeoutMs?: number;
  feedback?: string;
}): Promise<GeneratedImage | null> {
  if (!hasImageGenConfig()) return null;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 45_000)]);
  const prompt = [
    input.feedback ? "Revise the current black-and-white stencil drawing using the vector audit feedback below." : "This photo may contain one building or many. Identify the single most typical / prominent building in this image and convert only it into a bold black stencil illustration.",
    input.feedback ? `Vector audit feedback: ${input.feedback}` : "",
    "Keep only that one chosen building, shown straight-on from the front (frontal elevation view). Remove every other building, the entire background, and all unrelated objects, people, vehicles, shadows, textures, sky, ground marks, and floating fragments.",
    "Do not output a skyline, a street scene, or multiple buildings — even if the photo shows them; pick exactly one building.",
    "Render the retained building as a bold papercut-style stencil: solid black filled shapes with clean white interior cut-out lines on a pure white background.",
    "Keep the building's recognizable outer contour as one continuous closed black mass, and add a few simple white cut-out lines (panel lines, edges, windows, doors, trusses) to preserve recognizability — minimal and clean, like the Eiffel Tower's lattice.",
    "Keep white cut-out gaps wide enough to stay visible; avoid dense thin scratches or gray tones.",
    "The whole artwork must be one single connected black piece: no isolated floating islands, no thin fragile spikes.",
    "Use only pure black shapes on pure white: no gray, no shading, no outline-only line art, no text, no border.",
    "Do not invent new structures or change the building's proportions.",
  ].filter(Boolean).join(" ");
  try {
    return await requestQwenImage(
      [{ image: `data:image/png;base64,${input.base64}` }, { text: prompt }],
      { n: 1, prompt_extend: false, watermark: false },
      signal,
    );
  } catch (error) {
    console.error("[image-gen] 照片主体提取异常:", error);
    return null;
  }
}

/**
 * 构建主路径（忠实实景转几何镂空）的图像编辑指令。
 * 独立导出供测试验证「主体锁定」契约：传地标名时指令必须锁定该主体。
 */
export function buildFaithfulPrompt(landmark?: string): string {
  const subjectRule = landmark
    ? `The reference photos show the landmark "${landmark}". You MUST draw exactly this building — never pick a different "most iconic" building from the photos, and never add neighboring buildings.`
    : "Pick the SINGLE most iconic building or landmark visible in the reference photos, and draw only that one building.";
  return [
    "This input image shows one or two real reference photos of a place (if two, they are stitched side by side with a thin white gap).",
    subjectRule,
    "Use the reference photos to decide WHAT to draw (identity, key proportions, most recognizable angle); use frontal or mildly-perspective view even if the photo shows it at an angle, in a panorama, or inside a skyline.",
    "Omit everything else: no skyline, no panorama, no neighboring buildings, no terrain spread, no ground clutter — only the one chosen building, large in frame on a pure white background.",
    GEOMETRIC_OPENWORK_STYLE,
    "If the input has two views, choose the building and its details from whichever view shows it best; output one unified drawing, not two.",
  ].filter(Boolean).join(" ");
}

/**
 * 忠实实景转几何镂空（主路径）：把「已确认同一地标」的真实参考照片，
 * 主动重设计为简洁、规整的几何镂空图案。
 *
 * 与旧版“照片描摹”指令的区别（本次风格修正的核心）：
 *   - 参考照片只决定「画什么」（建筑身份），不要求逐像素、逐窗格描摹。
 *   - 地标名（landmark）显式传入并写进指令，模型必须遵守选定主体，
 *     不再自行挑选“画面里最具代表性”的另一栋建筑。
 *   - 白色必须是宽阔、规整的几何开孔，不再是细白线/密集划痕。
 *   - 共享 GEOMETRIC_OPENWORK_STYLE，与备用文生图路径保持同一风格。
 */
export async function extractSceneFaithfulImage(input: {
  base64: string;
  /** 已确认的地标名（中/英均可），用于锁定主体；缺省时退化为“挑最具代表性的一栋”。 */
  landmark?: string;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<GeneratedImage | null> {
  if (!hasImageGenConfig()) return null;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 45_000)]);
  const prompt = buildFaithfulPrompt(input.landmark);
  try {
    return await requestQwenImage(
      [{ image: `data:image/png;base64,${input.base64}` }, { text: prompt }],
      { n: 1, prompt_extend: false, watermark: false },
      signal,
    );
  } catch (error) {
    console.error("[image-gen] 忠实还原异常:", error);
    return null;
  }
}
