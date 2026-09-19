import { callDeepSeekJson, hasDeepSeekKey } from "../../../lib/deepseek.ts";
import { generateCitySilhouetteImage, hasImageGenConfig } from "../../../lib/image-gen.ts";
import { potraceVectorize } from "../../../lib/potrace-vectorize.ts";
import { composeSilhouette, composeSilhouetteSelection } from "../../../lib/silhouette.ts";
import { generateFallbackSilhouette } from "../../../lib/silhouette-generators.ts";
import { allow, clientIp } from "../../../lib/rate-limit.ts";

type SceneResult = {
  city: string;
  landmark: string;
  cutPaths: string[];
  scorePaths: string[];
  engravePaths: string[];
  fillPaths: string[];
  paths: string[];   // 兼容旧客户端：合并所有层
  source: "image-gen" | "offline";
  agent?: { rounds: number; status: "completed" | "degraded"; events: SceneAgentEvent[] };
};

type LandmarkCandidate = { title: string; snippet: string; language: "en" | "zh" };
type SceneBrief = {
  city: string;
  cityEn: string;
  country: string;
  explicitLandmark: string;
  landmark: string;
  landmarkEn: string;
  subjectType: "city" | "nature";
  visualAnchors: string[];
  composition: string;
};
type SceneAgentAction = "search_landmarks" | "revise_brief" | "finish";
type SceneAgentEvent = { round: number; action: SceneAgentAction; decision: string; observation: string };

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&quot;/g, "\"").replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** 从中英文 Wikipedia 搜索真实地标候选；失败时返回空数组，不阻断生成。 */
export async function searchLandmarkCandidates(input: {
  city: string;
  cityEn?: string;
  explicitLandmark?: string;
  signal: AbortSignal;
}): Promise<LandmarkCandidate[]> {
  const queries = [
    { language: "en" as const, query: input.explicitLandmark ? `${input.explicitLandmark} ${input.cityEn || input.city}` : `${input.cityEn || input.city} landmark architecture attraction` },
    { language: "zh" as const, query: input.explicitLandmark ? `${input.explicitLandmark} ${input.city}` : `${input.city} 地标 建筑 景点` },
  ];
  const results = await Promise.all(queries.map(async ({ language, query }) => {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "search", srsearch: query, srlimit: "6", srprop: "snippet" });
    try {
      const response = await fetch(`https://${language}.wikipedia.org/w/api.php?${params}`, {
        headers: { "Api-User-Agent": "Shike/0.1 (landmark retrieval for laser designs)" },
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(4_000)]),
      });
      if (!response.ok) return [];
      const payload = await response.json() as { query?: { search?: { title?: unknown; snippet?: unknown }[] } };
      return (payload.query?.search ?? []).flatMap((item) => typeof item.title === "string"
        ? [{ title: plainText(item.title).slice(0, 100), snippet: plainText(typeof item.snippet === "string" ? item.snippet : "").slice(0, 280), language }]
        : []);
    } catch {
      return [];
    }
  }));
  const seen = new Set<string>();
  return results.flat().filter((candidate) => {
    const key = candidate.title.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function shortString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function updateSceneBrief(current: SceneBrief, value: unknown): { brief: SceneBrief; action: SceneAgentAction; decision: string } | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Record<string, unknown>;
  const rawBrief = response.brief && typeof response.brief === "object" ? response.brief as Record<string, unknown> : response;
  const visualAnchors = Array.isArray(rawBrief.visualAnchors)
    ? rawBrief.visualAnchors.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 4).map((item) => item.trim().slice(0, 100))
    : current.visualAnchors;
  const brief: SceneBrief = {
    city: shortString(rawBrief.city, 40) || current.city,
    cityEn: shortString(rawBrief.cityEn, 60) || current.cityEn,
    country: shortString(rawBrief.country, 60) || current.country,
    explicitLandmark: shortString(rawBrief.explicitLandmark, 80) || current.explicitLandmark,
    landmark: shortString(rawBrief.landmark, 80) || current.landmark,
    landmarkEn: shortString(rawBrief.landmarkEn, 100) || current.landmarkEn,
    subjectType: rawBrief.subjectType === "nature" ? "nature" : rawBrief.subjectType === "city" ? "city" : current.subjectType,
    visualAnchors,
    composition: shortString(rawBrief.composition, 240) || current.composition,
  };
  const requested = response.action;
  const action: SceneAgentAction = requested === "search_landmarks" || requested === "revise_brief" || requested === "finish"
    ? requested
    : brief.landmark && brief.visualAnchors.length >= 2 ? "finish" : "search_landmarks";
  return { brief, action, decision: shortString(response.decision, 120) || "根据已知事实更新场景生成简报。" };
}

function briefAudit(brief: SceneBrief): string[] {
  const issues: string[] = [];
  if (!brief.landmark) issues.push("缺少明确主体");
  if (brief.visualAnchors.length < 2) issues.push("可视特征少于 2 个");
  return issues;
}

/** DeepSeek ReAct 场景 Agent：最多 3 轮，只输出结构化动作和可见摘要，不暴露私有思维链。 */
async function runSceneAgent(input: { memory: string; initial: SceneBrief; signal: AbortSignal }): Promise<{ brief: SceneBrief; rounds: number; status: "completed" | "degraded"; events: SceneAgentEvent[] }> {
  let brief = input.initial;
  let candidates: LandmarkCandidate[] = [];
  let searched = false;
  const events: SceneAgentEvent[] = [];
  const observations: string[] = [];
  let rounds = 0;
  for (let round = 1; round <= 3; round += 1) {
    const result = await callDeepSeekJson({
      signal: input.signal,
      timeoutMs: 6_000,
      system: `你是拾刻的场景生成 ReAct 调度器。每轮只输出 JSON，不得输出私有思维链：
{"action":"search_landmarks|revise_brief|finish","decision":"不超过120字的可见决策摘要","brief":{"city":"","cityEn":"","country":"","explicitLandmark":"","landmark":"","landmarkEn":"","subjectType":"city|nature","visualAnchors":["2到4个可见特征"],"composition":"不超过240字的单主体构图指令"}}
动作规则：首轮标准化地点并选 search_landmarks；看到检索观察后用 revise_brief 修订；简报已有真实单主体、2到4个可见特征且无虚构时选 finish。
优先级：用户明确主体 > 检索证据 > 高置信城市典型场景。禁止拼接不相邻地标、虚构建筑或添加背景碎片。`,
      user: { round, maxRounds: 3, memory: input.memory, currentBrief: brief, candidates, observations: observations.slice(-4) },
    });
    rounds = round;
    const parsed = updateSceneBrief(brief, result);
    if (!parsed) {
      events.push({ round, action: "revise_brief", decision: "DeepSeek 未返回有效结构，使用当前简报降级。", observation: "结构化输出无效" });
      break;
    }
    brief = parsed.brief;
    let action = parsed.action;
    let observation = "";
    if (!searched) {
      candidates = await searchLandmarkCandidates({ city: brief.city, cityEn: brief.cityEn, explicitLandmark: brief.explicitLandmark, signal: input.signal });
      searched = true;
      action = "search_landmarks";
      observation = candidates.length
        ? `检索到 ${candidates.length} 个候选：${candidates.map((item) => item.title).join("、")}`
        : "未检索到可用候选，只能使用高置信已知场景。";
    } else {
      const issues = briefAudit(brief);
      observation = issues.length ? `简报待修订：${issues.join("、")}` : "简报已具备真实单主体和足够的可视特征。";
      if (action === "finish" && issues.length === 0) {
        events.push({ round, action, decision: parsed.decision, observation });
        return { brief, rounds, status: "completed", events };
      }
      action = "revise_brief";
    }
    observations.push(observation);
    events.push({ round, action, decision: parsed.decision, observation });
  }
  return { brief, rounds, status: briefAudit(brief).length === 0 ? "completed" : "degraded", events };
}

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  // 限流：同一 IP 每 15 秒最多 1 次，防止脚本刷量盗刷 AI 额度。
  if (!allow(clientIp(request), 1, 15_000)) {
    return Response.json({ error: "生成太频繁，请稍后再试。" }, { status: 429 });
  }

  let prompt = "";
  try {
    const body = await request.json() as { prompt?: unknown };
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 160) throw new Error("invalid");
    prompt = body.prompt.trim();
  } catch {
    return Response.json({ error: "请输入 1..160 个字符的城市记忆。" }, { status: 400 });
  }

  // 1. 离线兜底先行，保证用户立刻有可见剪影。
  const fallback = composeSilhouette(prompt);

  // 2. DeepSeek 先标准化城市与用户意图，不在这一阶段凭空猜地标。
  let sceneBrief: SceneBrief = {
    city: fallback.city.name,
    cityEn: fallback.city.name,
    country: "",
    explicitLandmark: "",
    landmark: fallback.landmarkNames[0] ?? fallback.city.name,
    landmarkEn: "",
    subjectType: "city",
    visualAnchors: [],
    composition: "",
  };
  let agentResult: Awaited<ReturnType<typeof runSceneAgent>> | undefined;
  const canUseDeepSeek = hasDeepSeekKey();
  if (canUseDeepSeek) {
    agentResult = await runSceneAgent({ memory: prompt, initial: sceneBrief, signal: request.signal });
    sceneBrief = agentResult.brief;
  }
  const { city: cityName, cityEn, country, landmark, landmarkEn, visualAnchors, subjectType, composition } = sceneBrief;

  // 4. 检索增强后的视觉简报 → 图像生成 → Potrace 闭合轮廓。
  if (hasImageGenConfig()) {
    const image = await generateCitySilhouetteImage({ city: cityName, cityEn, country, landmark, landmarkEn, visualAnchors, composition, subjectType, signal: request.signal });
    if (image) {
      const result = await potraceVectorize(image.base64, {
        // 抑制碎片并平滑轮廓，保留 Potrace 的闭合复合路径。
        turdSize: 8,
        optCurve: true,
        optTolerance: 0.4,
        alphaMax: 1,
        blackOnWhite: true,
      });
      if (result.ok && result.path.length > 20) {
        // Potrace 描述的是黑色实体与白色孔洞，不是单线稿；保留为 evenodd 填充雕刻层。
        const design = composeSilhouetteSelection(
          cityName, [landmark], "2023-06-01", [],
          { cutPaths: [], scorePaths: [], engravePaths: [], fillPaths: [result.path] },
        );
        const sceneResult: SceneResult = {
          city: design.city.slug,
          landmark,
          cutPaths: design.cutPaths,
          scorePaths: design.scorePaths,
          engravePaths: design.engravePaths,
          fillPaths: design.fillPaths,
          paths: design.paths,
          source: "image-gen",
          agent: agentResult && { rounds: agentResult.rounds, status: agentResult.status, events: agentResult.events },
        };
        return Response.json(sceneResult);
      }
    }
  }

  // 5. 降级：参数化兜底生成器（分层输出，镂空版）。
  const generated = generateFallbackSilhouette(cityName, landmark);
  const design = composeSilhouetteSelection(
    cityName, generated.landmarkNames, "2023-06-01", generated.paths,
    { cutPaths: generated.cutPaths, scorePaths: generated.scorePaths, engravePaths: generated.engravePaths, fillPaths: generated.fillPaths },
  );
  const sceneResult: SceneResult = {
    city: design.city.slug,
    landmark,
    cutPaths: design.cutPaths,
    scorePaths: design.scorePaths,
    engravePaths: design.engravePaths,
    fillPaths: design.fillPaths,
    paths: design.paths,
    source: "offline",
    agent: agentResult && { rounds: agentResult.rounds, status: agentResult.status, events: agentResult.events },
  };
  return Response.json(sceneResult);
}
