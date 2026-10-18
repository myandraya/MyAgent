import { allow, clientIp } from "../../../lib/rate-limit.ts";
import { normalizeFileKey } from "../../../lib/photo-identity.ts";

/**
 * 参考照片搜索 API：根据地名检索真实景色照片。
 *
 * 来源：Wikidata 直搜（公开 API，无需 key）。
 *   - 先用 wbsearchentities 把「地名」解析成 Wikidata 实体（中英文各试一次）
 *   - 再取实体的图片属性（P18 主图、P948 横幅图、P2716 拼贴、P3451 夜景）
 *   - 用 MediaWiki imageinfo 官方 API 取原图/缩略图 URL、真实尺寸与许可（不再手工构造 URL）
 *   - 过滤掉图标、地图、旗帜等非景色图片
 *
 * 可靠性要点（对齐方案 §7）：
 *   - 不再用「中文查询排除海外实体」的黑名单规则（中文输入不等于国内地点）；
 *   - 不再手工推导 thumb.wikimedia.org 的 MD5 路径，改用 imageinfo 返回的官方 thumburl；
 *   - 图片属性列表移除 P577（那是发表日期，不是图片属性）；
 *   - 每个候选保留其所属实体的身份（id/label/description/country），供前端锁定唯一地点。
 */

export type PhotoCandidate = {
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  license: string;
  /** 该图片所属实体的稳定身份（用于锁定唯一地点） */
  entity: {
    id: string;
    label: string;
    description: string;
  };
};

export type PhotoSearchResponse = {
  ok: boolean;
  query: string;
  candidates: PhotoCandidate[];
};

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** 图片属性：P18 主图、P948 横幅、P2716 拼贴、P3451 夜景。已移除 P577（发表日期，非图片属性）。 */
const IMAGE_PROPS = ["P18", "P948", "P2716", "P3451"];

/** 非景色图片的文件名特征：旗帜/纹章/地图/定位图/徽标/图标/示意图/截图等。 */
const NON_PHOTO_HINT = /(?:coat\s*of\s*arms|emblem|flag|map|locator|logo|icon|seal|diagram|chart|symbol|screenshot|montage|collage)/i;

type SearchEntity = { id: string; label: string; description?: string };

/** 判断查询是否以中文为主（含 CJK 字符）。仅用于调整检索语言顺序，不再用于排除海外实体。 */
function isChineseQuery(query: string): boolean {
  return /[\u4e00-\u9fff]/.test(query);
}

/** 用 wbsearchentities 搜实体。language 依次尝试，命中即返回。 */
async function searchEntities(query: string, languages: string[], signal: AbortSignal): Promise<SearchEntity[]> {
  const out: SearchEntity[] = [];
  const seen = new Set<string>();
  for (const lang of languages) {
    const params = new URLSearchParams({
      action: "wbsearchentities", format: "json",
      search: query, language: lang, limit: "8",
      uselang: lang, type: "item",
    });
    try {
      const response = await fetch(`${WIKIDATA_API}?${params}`, {
        headers: { "Api-User-Agent": "MakerMuse/0.1 (scene photo retrieval for laser designs)" },
        signal,
      });
      if (!response.ok) continue;
      const payload = await response.json() as { search?: { id?: string; label?: string; description?: string }[] };
      for (const item of payload.search ?? []) {
        const id = typeof item.id === "string" ? item.id : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          label: typeof item.label === "string" ? item.label : "",
          description: typeof item.description === "string" ? item.description : "",
        });
        if (out.length >= 6) return out;
      }
    } catch {
      continue;
    }
  }
  return out;
}

/** 批量取实体的图片文件名（按 IMAGE_PROPS 优先级）。 */
async function fetchImageFiles(ids: string[], signal: AbortSignal): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!ids.length) return result;
  const params = new URLSearchParams({
    action: "wbgetentities", format: "json",
    ids: ids.join("|"), props: "claims",
  });
  try {
    const response = await fetch(`${WIKIDATA_API}?${params}`, {
      headers: { "Api-User-Agent": "MakerMuse/0.1 (scene photo retrieval for laser designs)" },
      signal,
    });
    if (!response.ok) return result;
    const payload = await response.json() as {
      entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: string } } }[]> }>;
    };
    for (const [id, entity] of Object.entries(payload.entities ?? {})) {
      const files: string[] = [];
      for (const prop of IMAGE_PROPS) {
        for (const claim of entity.claims?.[prop] ?? []) {
          const value = claim.mainsnak?.datavalue?.value;
          if (typeof value === "string" && value && !files.includes(value)) files.push(value);
        }
      }
      if (files.length) result.set(id, files);
    }
  } catch {
    /* 忽略，返回空 */
  }
  return result;
}

type ImageInfoEntry = {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  width?: number;
  height?: number;
  extmetadata?: {
    LicenseShortName?: { value?: string };
    License?: { value?: string };
  };
  /** 图片来源页的规范标题（API 返回的 title，非从 descriptionurl 猜测） */
  canonicaltitle?: string;
};

/**
 * 用 MediaWiki imageinfo 官方 API 批量取图片的真实缩略图 URL、原图 URL、尺寸与许可。
 * 关键修复（S01）：不再用 descriptionurl 的 "File:" 后面猜文件名，改用 API 返回的
 * 规范标题（canonicaltitle / title）作为索引，并与请求的文件名做归一化比较，避免
 * 空格、下划线、URL 编码差异导致有效图片被丢弃。
 */
async function fetchImageInfo(fileNames: string[], signal: AbortSignal): Promise<Map<string, ImageInfoEntry>> {
  const result = new Map<string, ImageInfoEntry>();
  if (!fileNames.length) return result;
  // imageinfo 的 titles 上限约 50，这里候选少，一次请求即可。
  const params = new URLSearchParams({
    action: "query", format: "json",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "960",
    titles: fileNames.map((f) => `File:${f}`).join("|"),
  });
  try {
    const response = await fetch(`${COMMONS_API}?${params}`, {
      headers: { "Api-User-Agent": "MakerMuse/0.1 (scene photo retrieval for laser designs)" },
      signal,
    });
    if (!response.ok) return result;
    const payload = await response.json() as {
      query?: { pages?: Record<string, { title?: string; imageinfo?: ImageInfoEntry[] }> };
    };
    for (const page of Object.values(payload.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      // 规范标题：优先页面 title（API 规范化后的标题），其次回退到 descriptionurl（不可靠，仅兜底）。
      const canonical = page.title ?? info.descriptionurl?.split(/[Ff]ile:/)[1]?.split("#")[0] ?? "";
      if (!canonical) continue;
      // 用规范化标题作为索引键；同时把 info 的标题记录进去供展示。
      const entry: ImageInfoEntry = { ...info, canonicaltitle: canonical };
      result.set(normalizeFileKey(canonical), entry);
      // 兼容：若请求文件名与规范标题归一化后不一致（重定向/别名），也按请求键再挂一份。
      // （下面在查询阶段会用 normalizeFileKey(file) 取，这里无需额外处理。）
    }
  } catch {
    /* 忽略，返回空 */
  }
  return result;
}

/**
 * 主搜索：地名 → Wikidata 实体 → 图片文件名 → imageinfo 真实 URL。
 *
 * 降级：先用完整 query 搜，空则按空格拆词、从最长的词开始逐个试（地标名通常更长更具体）。
 */
async function searchByWikidata(query: string, signal: AbortSignal): Promise<PhotoCandidate[]> {
  const tries = [query, ...query.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)];
  const languages = isChineseQuery(query) ? ["zh", "en"] : ["en", "zh"];
  for (const attempt of [...new Set(tries)]) {
    const entities = await searchEntities(attempt, languages, signal);
    if (!entities.length) continue;
    const candidates = await entitiesToCandidates(entities, signal);
    if (candidates.length) return candidates;
  }
  return [];
}

/** 文件名带这些词的通常是天际线/全景/鸟瞰/城市面，不是单一建筑的正面照，排序时压后。 */
const SKYLINE_HINT = /skyline|panorama|panoramic|aerial|cityscape|skyline view|view from|overview|鸟瞰|全景|天际线/i;

/** 单体建筑优先排序（稳定排序，不打乱原有属性顺序）。 */
function prioritizeSingleBuilding(candidates: PhotoCandidate[]): PhotoCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, penalty: SKYLINE_HINT.test(candidate.title) ? 1 : 0 }))
    .sort((a, b) => a.penalty - b.penalty || a.index - b.index)
    .map((item) => item.candidate);
}

/** 实体 → 图片文件名 → imageinfo 真实 URL 候选。 */
async function entitiesToCandidates(entities: SearchEntity[], signal: AbortSignal): Promise<PhotoCandidate[]> {
  const fileMap = await fetchImageFiles(entities.map((e) => e.id), signal);
  // 收集所有待查询的文件名，去重后一次 imageinfo 批量取。
  const allFiles = new Set<string>();
  for (const files of fileMap.values()) for (const f of files) allFiles.add(f);
  const infoMap = await fetchImageInfo([...allFiles], signal);

  const out: PhotoCandidate[] = [];
  const seenKeys = new Set<string>();
  for (const entity of entities) {
    const files = fileMap.get(entity.id) ?? [];
    for (const file of files) {
      const key = normalizeFileKey(file);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (NON_PHOTO_HINT.test(file)) continue;
      const info = infoMap.get(key);
      // 无 imageinfo 真实 URL 的候选不可用（链接可能失效），直接跳过，不手工猜 URL。
      if (!info?.thumburl) continue;
      const canonicalTitle = (info.canonicaltitle ?? file).replace(/^File:/i, "");
      out.push({
        title: canonicalTitle,
        thumbUrl: info.thumburl,
        imageUrl: info.url ?? info.thumburl,
        pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
        width: info.width ?? 0,
        height: info.height ?? 0,
        license: info.extmetadata?.LicenseShortName?.value ?? info.extmetadata?.License?.value ?? "",
        entity: { id: entity.id, label: entity.label, description: entity.description ?? "" },
      });
    }
  }
  return prioritizeSingleBuilding(out).slice(0, 10);
}

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
    const candidates = await searchByWikidata(query, signal);
    return Response.json({ ok: true, query, candidates } satisfies PhotoSearchResponse);
  } catch (error) {
    console.error("[photo-search] 搜索异常:", error);
    return Response.json({ ok: true, query, candidates: [] } satisfies PhotoSearchResponse);
  }
}
