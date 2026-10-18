import { callDeepSeekJson, hasDeepSeekKey } from "./deepseek.ts";
import { lookupLandmarkHome, landmarkBelongsToCity, type LandmarkRef } from "./place-identity.ts";

/**
 * 地点解析：把用户整句自然语言 → 结构化地点信息，供「搜图前锁定地点身份」使用。
 *
 * 设计原则（对齐整改方案 S02）：
 *   - LLM 负责提取 + 提出别名候选，不作为地点真实性的唯一依据；
 *   - 先走本地别名索引命中（快、稳定），低置信度/复杂句子再调用模型；
 *   - 本地索引返回所有匹配，不按遍历顺序取第一项；地标匹配优先完整名称；
 *   - 泛称（歌剧院/铁塔）结合城市语境解释，不能无条件映射到唯一海外建筑；
 *   - 中文输入不得作为排除海外地点的依据；
 *   - LLM 输出严格校验，缺失/非法 confidence 不默认 high。
 */

export type ParsedPlace = {
  /** 用户原话（保留，供回显与审计） */
  originalText: string;
  /** 城市（中文或英文标准名） */
  city: string;
  /** 城市英文名（可雕刻 + 可检索） */
  cityEn: string;
  /** 国家/地区 */
  country: string;
  /** 明确提到的地标 */
  landmark: string;
  /** 地标英文名 */
  landmarkEn: string;
  /** 氛围/时间等非地点信息（如「黄昏」），不作为地点身份依据 */
  mood: string;
  /** 解析置信度：高置信可直接搜图，低置信需要用户确认 */
  confidence: "high" | "low";
  /** 是否需要用户确认（同名地点 / 多城市 / 地标城市冲突） */
  needsConfirmation: boolean;
  /** 解析依据/说明（可见，非私有思维链） */
  reason: string;
};

/** 一个可选地点候选（消歧时展示给用户点选）。 */
export type PlaceCandidate = {
  /** 地点名（中文或英文标准名） */
  label: string;
  /** 城市英文名 */
  cityEn: string;
  /** 国家/地区 */
  country: string;
  /** 行政归属（省/州等，用于区分同名地点） */
  administrativeArea: string;
  /** 简短说明，帮助用户区分（如「美国 · 得克萨斯州」） */
  hint: string;
};

export type PlaceParseResult = ParsedPlace & {
  /** 歧义时的候选地点列表（needsConfirmation 为 true 时非空，供前端点选） */
  candidates: PlaceCandidate[];
};

/** 本地城市别名索引（快速命中，不调模型）。key 为小写。 */
const LOCAL_CITY_ALIASES = new Map<string, string>([
  ["巴黎", "Paris"], ["paris", "Paris"],
  ["伦敦", "London"], ["london", "London"],
  ["纽约", "New York"], ["new york", "New York"],
  ["洛杉矶", "Los Angeles"], ["los angeles", "Los Angeles"],
  ["东京", "Tokyo"], ["tokyo", "Tokyo"],
  ["悉尼", "Sydney"], ["sydney", "Sydney"],
  ["北京", "Beijing"], ["beijing", "Beijing"],
  ["上海", "Shanghai"], ["shanghai", "Shanghai"],
  ["香港", "Hong Kong"], ["hong kong", "Hong Kong"],
  ["新加坡", "Singapore"], ["singapore", "Singapore"],
  ["罗马", "Rome"], ["rome", "Rome"],
  ["威尼斯", "Venice"], ["venice", "Venice"],
  ["巴塞罗那", "Barcelona"], ["barcelona", "Barcelona"],
  ["柏林", "Berlin"], ["berlin", "Berlin"],
  ["阿姆斯特丹", "Amsterdam"], ["amsterdam", "Amsterdam"],
  ["迪拜", "Dubai"], ["dubai", "Dubai"],
  ["爱丁堡", "Edinburgh"], ["edinburgh", "Edinburgh"],
  ["墨尔本", "Melbourne"], ["melbourne", "Melbourne"],
  ["布拉格", "Prague"], ["prague", "Prague"],
  ["维也纳", "Vienna"], ["vienna", "Vienna"],
  ["伊斯坦布尔", "Istanbul"], ["istanbul", "Istanbul"],
  ["旧金山", "San Francisco"], ["san francisco", "San Francisco"],
]);

/**
 * 本地地标别名：key 为别名，value 为地标英文标准名。
 * 注意：只放「无歧义的完整地标名」与「无歧义的口语简称」。
 * 「歌剧院」「铁塔」这类泛称不在此表，需结合城市语境在下方单独处理。
 */
const LOCAL_LANDMARK_ALIASES = new Map<string, string>([
  ["埃菲尔铁塔", "Eiffel Tower"], ["eiffel tower", "Eiffel Tower"],
  ["大本钟", "Big Ben"], ["big ben", "Big Ben"],
  ["悉尼歌剧院", "Sydney Opera House"], ["sydney opera house", "Sydney Opera House"],
  ["自由女神像", "Statue of Liberty"], ["statue of liberty", "Statue of Liberty"],
  ["长城", "Great Wall"], ["great wall", "Great Wall"],
  ["金门大桥", "Golden Gate Bridge"], ["golden gate bridge", "Golden Gate Bridge"],
  ["东京塔", "Tokyo Tower"], ["tokyo tower", "Tokyo Tower"],
  ["东方明珠", "Oriental Pearl Tower"],
  ["斗兽场", "Colosseum"], ["罗马斗兽场", "Colosseum"], ["colosseum", "Colosseum"],
]);

/** 泛称 → 按城市语境的地标映射（「歌剧院」「铁塔」等需结合城市解释）。 */
const GENERIC_LANDMARK_BY_CITY: Record<string, string> = {
  // 城市英文名小写 → 该城市的默认「歌剧院/铁塔」等泛称所指地标
  "sydney": "Sydney Opera House",
  "paris": "Eiffel Tower",
  "london": "Big Ben",
};

/** 多城市/歧义信号词（命中则不能走本地快速高置信返回）。 */
const MULTI_CITY_HINT = /和|与|跟|还有|以及|还是|或者|或\b|、|,/;
/** 显式地点冲突信号（「A的B」跨城市）。 */
const CONFLICT_HINT = /的|位于|属于/;

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 在文本中匹配所有命中的城市（按别名长度降序，避免短别名先吞长名）。
 * 返回按「别名长度」降序的命中列表，供后续判断优先级与歧义。
 */
function matchAllCities(text: string): { alias: string; cityEn: string }[] {
  const lowered = norm(text);
  const hits: { alias: string; cityEn: string }[] = [];
  for (const [alias, cityEn] of LOCAL_CITY_ALIASES) {
    // 英文别名用词边界匹配，中文别名用子串匹配。
    const isAscii = /^[a-z\s]+$/.test(alias);
    const matched = isAscii
      ? new RegExp(`(^|[^a-z])${escapeRegExp(alias)}(?=$|[^a-z])`).test(lowered)
      : lowered.includes(alias);
    if (matched) hits.push({ alias, cityEn });
  }
  // 按别名长度降序（长的更具体优先）。
  hits.sort((a, b) => b.alias.length - a.alias.length);
  return hits;
}

/** 在文本中匹配所有命中的地标（按别名长度降序，优先完整名称）。 */
function matchAllLandmarks(text: string): { alias: string; landmarkEn: string }[] {
  const lowered = norm(text);
  const hits: { alias: string; landmarkEn: string }[] = [];
  for (const [alias, landmarkEn] of LOCAL_LANDMARK_ALIASES) {
    const isAscii = /^[a-z\s]+$/.test(alias);
    const matched = isAscii
      ? new RegExp(`(^|[^a-z])${escapeRegExp(alias)}(?=$|[^a-z])`).test(lowered)
      : lowered.includes(alias);
    if (matched) hits.push({ alias, landmarkEn });
  }
  hits.sort((a, b) => b.alias.length - a.alias.length);
  return hits;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把地标英文标准名构造成 LandmarkRef（带归属信息；无归属时 cityEn/country 为空）。 */
function toLandmarkRef(landmarkEn: string): LandmarkRef {
  const home = lookupLandmarkHome(landmarkEn);
  if (!home) return { nameEn: landmarkEn, name: landmarkEn, cityEn: "", country: "" };
  return { nameEn: landmarkEn, name: home.name, cityEn: home.cityEn, country: home.country };
}

/**
 * 结合城市语境解析「歌剧院」「铁塔」等泛称。
 * 返回 { landmarkEn, matched }：matched=true 表示该泛称在语境下可确定地标。
 */
function resolveGenericLandmark(text: string, cityEn: string): { landmarkEn: string; matched: boolean } {
  const lowered = norm(text);
  const genericTerms: { re: RegExp; cityKey: string }[] = [
    { re: /歌剧院|opera\s*house/, cityKey: "sydney" },
    { re: /铁塔|eiffel|tower/, cityKey: "paris" },
  ];
  for (const { re, cityKey } of genericTerms) {
    if (!re.test(lowered)) continue;
    // 只有城市语境与泛称的默认城市一致时，才确定映射；否则视为「地标与城市冲突」。
    if (norm(cityEn) === cityKey) {
      return { landmarkEn: GENERIC_LANDMARK_BY_CITY[cityKey], matched: true };
    }
    // 泛称 + 非默认城市（如「东京的歌剧院」）→ 不能无条件映射，需确认。
    return { landmarkEn: "", matched: false };
  }
  return { landmarkEn: "", matched: false };
}

/**
 * DeepSeek 地点解析（复杂句子/低置信度时调用）。
 * 只输出结构化 JSON，不暴露私有思维链。
 */
async function parseViaDeepSeek(text: string, signal: AbortSignal): Promise<Partial<PlaceParseResult> | null> {
  if (!hasDeepSeekKey()) return null;
  const result = await callDeepSeekJson({
    signal,
    timeoutMs: 6_000,
    system: `你是地点解析器。把用户关于一座城市/一个地标的话解析成结构化 JSON，只输出 JSON，字段：
{"city":"","cityEn":"","country":"","landmark":"","landmarkEn":"","mood":"","confidence":"high|low","needsConfirmation":false,"reason":"","candidates":[{"label":"","cityEn":"","country":"","administrativeArea":"","hint":""}]}
规则：
- city/cityEn：用户想表达的城市（中文名与英文名）；country 为国家/地区，不确定则空。
- landmark/landmarkEn：用户明确提到的具体地标（如埃菲尔铁塔、悉尼歌剧院）；没提则空，不得臆造。泛称（歌剧院/铁塔）必须结合城市判断，不能无条件映射到唯一海外建筑。
- mood：氛围/时间等非地点信息（如「黄昏」「夜晚」），没有则空。
- confidence：地点身份明确且城市-地标归属一致才为 high；同名歧义、多城市、地标与城市冲突、无法确定城市、confidence 字段缺失或非法时一律为 low。
- needsConfirmation：存在多个合理地点、地标城市冲突、或无法唯一确定时为 true，否则 false。
- candidates：当 needsConfirmation 为 true 时，列出 2~4 个合理候选地点；label 为地点名，country/administrativeArea 为国家和行政归属，hint 为一句简短区分说明；无法列出候选时给空数组。
- reason：不超过 60 字，说明判断依据，不要输出私有思维链。
- 中文输入不得被当作只能指国内地点；纽约、洛杉矶、巴黎等海外城市照常识别。`,
    user: { text },
  });
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const candidates: PlaceCandidate[] = Array.isArray(r.candidates)
    ? (r.candidates as Record<string, unknown>[]).slice(0, 4).map((c) => ({
        label: typeof c.label === "string" ? c.label : "",
        cityEn: typeof c.cityEn === "string" ? c.cityEn : "",
        country: typeof c.country === "string" ? c.country : "",
        administrativeArea: typeof c.administrativeArea === "string" ? c.administrativeArea : "",
        hint: typeof c.hint === "string" ? c.hint : "",
      })).filter((c) => c.label)
    : [];
  // 严格校验 confidence：缺失或非法一律 low，不默认 high。
  const confidence: "high" | "low" = r.confidence === "high" ? "high" : "low";
  return {
    city: str("city"),
    cityEn: str("cityEn"),
    country: str("country"),
    landmark: str("landmark"),
    landmarkEn: str("landmarkEn"),
    mood: str("mood"),
    confidence,
    needsConfirmation: r.needsConfirmation === true,
    reason: str("reason"),
    candidates,
  };
}

/**
 * 主入口：解析用户文字为结构化地点。
 */
export async function parsePlace(text: string, signal: AbortSignal): Promise<PlaceParseResult> {
  const trimmed = text.trim();
  const cityHits = matchAllCities(trimmed);
  const landmarkHits = matchAllLandmarks(trimmed);

  // 多城市/歧义信号 → 交给 DeepSeek 或返回需确认，不走本地快速返回。
  const hasMultiCity = cityHits.length > 1 || MULTI_CITY_HINT.test(trimmed);
  const hasConflict = CONFLICT_HINT.test(trimmed);

  const primaryCity = cityHits[0] ?? null;
  const primaryLandmark = landmarkHits[0] ?? null;

  // 情况 1：本地命中且无歧义、无冲突 → 高置信快速返回（但仍校验地标-城市归属）。
  if (primaryCity && !hasMultiCity && !hasConflict) {
    const cityEn = primaryCity.cityEn;
    const landmarkEn = primaryLandmark?.landmarkEn ?? "";
    // 泛称结合城市语境解析。
    const generic = resolveGenericLandmark(trimmed, cityEn);
    const finalLandmarkEn = landmarkEn || (generic.matched ? generic.landmarkEn : "");
    const finalLandmark = primaryLandmark?.alias ?? (generic.matched ? generic.landmarkEn : "");

    // 校验地标-城市归属：明确地标与城市冲突 → 需确认。
    if (finalLandmarkEn) {
      const ref = toLandmarkRef(finalLandmarkEn);
      if (ref.cityEn && !landmarkBelongsToCity(ref, cityEn)) {
        return {
          originalText: trimmed,
          city: primaryCity.alias,
          cityEn,
          country: "",
          landmark: finalLandmark,
          landmarkEn: finalLandmarkEn,
          mood: "",
          confidence: "low",
          needsConfirmation: true,
          reason: "地标与城市归属可能冲突，请确认。",
          candidates: [],
        };
      }
    }

    return {
      originalText: trimmed,
      city: primaryCity.alias,
      cityEn,
      country: "",
      landmark: finalLandmark,
      landmarkEn: finalLandmarkEn,
      mood: "",
      confidence: "high",
      needsConfirmation: false,
      reason: "本地别名命中。",
      candidates: [],
    };
  }

  // 情况 2：有地标但无城市（如「我想念巴黎圣母院」应识别巴黎+圣母院，但本地可能只命中地标）。
  //        或有多城市/冲突信号 → 交给 DeepSeek。
  const ai = await parseViaDeepSeek(trimmed, signal);
  if (ai && (ai.city || ai.landmark)) {
    // DeepSeek 结果同样需校验地标-城市归属。
    const aiCityEn = ai.cityEn ?? primaryCity?.cityEn ?? "";
    const aiLandmarkEn = ai.landmarkEn ?? primaryLandmark?.landmarkEn ?? "";
    let confidence = ai.confidence ?? "low";
    let needsConfirmation = ai.needsConfirmation ?? false;
    if (aiLandmarkEn && aiCityEn) {
      const ref = toLandmarkRef(aiLandmarkEn);
      if (ref.cityEn && !landmarkBelongsToCity(ref, aiCityEn)) {
        confidence = "low";
        needsConfirmation = true;
      }
    }
    return {
      originalText: trimmed,
      city: ai.city ?? primaryCity?.alias ?? "",
      cityEn: aiCityEn,
      country: ai.country ?? "",
      landmark: ai.landmark ?? primaryLandmark?.alias ?? "",
      landmarkEn: aiLandmarkEn,
      mood: ai.mood ?? "",
      confidence,
      needsConfirmation,
      reason: ai.reason ?? "模型解析。",
      candidates: ai.candidates ?? [],
    };
  }

  // 情况 3：本地有城市但句子仍有未解析的明确地标 → 不能静默只搜城市，需提示补充。
  if (primaryCity && primaryLandmark === null && /地标|建筑|塔|剧院|门|桥|寺|宫|像|塔桥|歌剧院/.test(trimmed)) {
    return {
      originalText: trimmed,
      city: primaryCity.alias,
      cityEn: primaryCity.cityEn,
      country: "",
      landmark: "",
      landmarkEn: "",
      mood: "",
      confidence: "low",
      needsConfirmation: true,
      reason: "提到了具体地标但无法确认，请补充地标名。",
      candidates: [],
    };
  }

  // 兜底：无法确定地点 → 低置信、需确认，不冒充成功。
  return {
    originalText: trimmed,
    city: primaryCity?.alias ?? "",
    cityEn: primaryCity?.cityEn ?? "",
    country: "",
    landmark: primaryLandmark?.alias ?? "",
    landmarkEn: primaryLandmark?.landmarkEn ?? "",
    mood: "",
    confidence: "low",
    needsConfirmation: true,
    reason: "无法确定地点，请补充城市或地标。",
    candidates: [],
  };
}
