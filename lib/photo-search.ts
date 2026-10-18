import { normalizeFileKey } from "./photo-identity.ts";

/**
 * 参考照片检索（可复用 lib）—— 地名 → 真实景色照片。
 *
 * 来源：Wikidata 直搜（公开 API，无需 key）。
 *   - 先用 wbsearchentities 把「地名」解析成 Wikidata 实体（中英文各试一次）
 *   - 再取实体的图片属性（P18 主图、P948 横幅图、P2716 拼贴、P3451 夜景）
 *   - 用 MediaWiki imageinfo 官方 API 取原图/缩略图 URL、真实尺寸与许可（不再手工构造 URL）
 *   - 过滤掉图标、地图、旗帜等非景色图片
 *
 * 供文字入口（scene）与照片入口（photo-search）共用。
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
 */
async function fetchImageInfo(fileNames: string[], signal: AbortSignal): Promise<Map<string, ImageInfoEntry>> {
  const result = new Map<string, ImageInfoEntry>();
  if (!fileNames.length) return result;
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
      const canonical = page.title ?? info.descriptionurl?.split(/[Ff]ile:/)[1]?.split("#")[0] ?? "";
      if (!canonical) continue;
      const entry: ImageInfoEntry = { ...info, canonicaltitle: canonical };
      result.set(normalizeFileKey(canonical), entry);
    }
  } catch {
    /* 忽略，返回空 */
  }
  return result;
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

/**
 * 主检索：地名 → Wikidata 实体 → 图片文件名 → imageinfo 真实 URL。
 * 降级：先用完整 query 搜，空则按空格拆词、从最长的词开始逐个试（地标名通常更长更具体）。
 */
export async function searchLandmarkPhotos(query: string, signal: AbortSignal): Promise<PhotoCandidate[]> {
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
