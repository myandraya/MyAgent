/**
 * 地点身份契约：贯穿「解析 → 搜索 → 生成」全程的稳定地点/地标身份。
 *
 * 设计目的（对齐整改方案 S03/S04）：
 *   - 名称只是检索别名，不作为唯一身份标识；
 *   - 地标必须绑定所属城市与国家，避免「歌剧院」无条件映射到悉尼、「铁塔」无条件映射到巴黎；
 *   - 用户确认的地点身份，在搜索、参考图选择、生成、重试中保持一致，不跳回另一个城市/建筑。
 */

/** 一个稳定地标身份（含所属城市与国家归属）。 */
export type LandmarkRef = {
  /** 地标英文标准名（用于检索） */
  nameEn: string;
  /** 地标中文名（用于展示） */
  name: string;
  /** 所属城市英文名（用于校验城市-地标归属） */
  cityEn: string;
  /** 所属国家/地区 */
  country: string;
  /** 外部实体 ID（Wikidata QID，若已知；空表示未核验） */
  externalId?: string;
};

/** 确认后的地点身份：贯穿搜索与生成的稳定记录。 */
export type ResolvedPlace = {
  /** 系统内部稳定标识（本次任务内唯一） */
  id: string;
  /** 城市英文名（标准名，用于检索与雕刻） */
  cityEn: string;
  /** 城市展示名 */
  city: string;
  /** 国家/地区 */
  country: string;
  /** 行政归属（省/州等，用于区分同名地点） */
  administrativeArea: string;
  /** 用户明确指定的地标（若明确提到则非空，锁定该建筑） */
  landmark: LandmarkRef | null;
  /** 已从城市选定/用户确认的代表地标（city 级输入时的默认主体） */
  selectedLandmark: LandmarkRef | null;
  /** 地点确认状态 */
  confirmationStatus: "confirmed" | "needs_confirmation" | "place_not_found";
  /** 解析依据（可见说明，非私有思维链） */
  reason: string;
};

/** 地标 → 所属城市/国家的本地归属表（避免把泛称无条件映射到唯一海外建筑）。 */
const LANDMARK_HOME: Record<string, { name: string; cityEn: string; country: string }> = {
  "Eiffel Tower": { name: "埃菲尔铁塔", cityEn: "Paris", country: "France" },
  "Big Ben": { name: "大本钟", cityEn: "London", country: "United Kingdom" },
  "Sydney Opera House": { name: "悉尼歌剧院", cityEn: "Sydney", country: "Australia" },
  "Statue of Liberty": { name: "自由女神像", cityEn: "New York", country: "United States" },
  "Great Wall": { name: "长城", cityEn: "Beijing", country: "China" },
  "Golden Gate Bridge": { name: "金门大桥", cityEn: "San Francisco", country: "United States" },
  "Tokyo Tower": { name: "东京塔", cityEn: "Tokyo", country: "Japan" },
  "Oriental Pearl Tower": { name: "东方明珠", cityEn: "Shanghai", country: "China" },
  "Colosseum": { name: "斗兽场", cityEn: "Rome", country: "Italy" },
  "Sagrada Familia": { name: "圣家堂", cityEn: "Barcelona", country: "Spain" },
  "Sydney Harbour Bridge": { name: "悉尼海港大桥", cityEn: "Sydney", country: "Australia" },
  "Tower Bridge": { name: "伦敦塔桥", cityEn: "London", country: "United Kingdom" },
};

/** 根据英文标准名查地标归属（找不到返回 null，保留不确定性）。 */
export function lookupLandmarkHome(nameEn: string): { name: string; cityEn: string; country: string } | null {
  const key = nameEn.trim();
  return LANDMARK_HOME[key] ?? null;
}

/** 校验「地标-城市」归属是否一致；返回 false 表示冲突（如「巴黎的悉尼歌剧院」）。 */
export function landmarkBelongsToCity(landmark: LandmarkRef, cityEn: string): boolean {
  if (!landmark.cityEn || !cityEn) return true; // 缺少归属信息时不武断判定冲突
  return landmark.cityEn.toLowerCase() === cityEn.toLowerCase();
}
