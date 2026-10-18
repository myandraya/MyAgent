import type { City } from "../lib/types.ts";

export const CITIES: City[] = [
  { slug: "edinburgh", name: "爱丁堡", nameEn: "Edinburgh", latitude: 55.9533, longitude: -3.1883, timezone: "Europe/London" },
  { slug: "london", name: "伦敦", nameEn: "London", latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London" },
  { slug: "sydney", name: "悉尼", nameEn: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney" },
  { slug: "melbourne", name: "墨尔本", nameEn: "Melbourne", latitude: -37.8136, longitude: 144.9631, timezone: "Australia/Melbourne" },
  { slug: "new-york", name: "纽约", nameEn: "New York", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York" },
  { slug: "beijing", name: "北京", nameEn: "Beijing", latitude: 39.9042, longitude: 116.4074, timezone: "Asia/Shanghai" },
  { slug: "paris", name: "巴黎", nameEn: "Paris", latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris" },
  { slug: "hong-kong", name: "香港", nameEn: "Hong Kong", latitude: 22.3193, longitude: 114.1694, timezone: "Asia/Hong_Kong" },
  { slug: "tokyo", name: "东京", nameEn: "Tokyo", latitude: 35.6762, longitude: 139.6503, timezone: "Asia/Tokyo" },
  { slug: "rome", name: "罗马", nameEn: "Rome", latitude: 41.9028, longitude: 12.4964, timezone: "Europe/Rome" },
  { slug: "shanghai", name: "上海", nameEn: "Shanghai", latitude: 31.2304, longitude: 121.4737, timezone: "Asia/Shanghai" },
  { slug: "venice", name: "威尼斯", nameEn: "Venice", latitude: 45.4408, longitude: 12.3155, timezone: "Europe/Rome" },
  { slug: "singapore", name: "新加坡", nameEn: "Singapore", latitude: 1.3521, longitude: 103.8198, timezone: "Asia/Singapore" },
  { slug: "san-francisco", name: "旧金山", nameEn: "San Francisco", latitude: 37.7749, longitude: -122.4194, timezone: "America/Los_Angeles" },
  { slug: "barcelona", name: "巴塞罗那", nameEn: "Barcelona", latitude: 41.3874, longitude: 2.1686, timezone: "Europe/Madrid" },
  { slug: "amsterdam", name: "阿姆斯特丹", nameEn: "Amsterdam", latitude: 52.3676, longitude: 4.9041, timezone: "Europe/Amsterdam" },
  { slug: "istanbul", name: "伊斯坦布尔", nameEn: "Istanbul", latitude: 41.0082, longitude: 28.9784, timezone: "Europe/Istanbul" },
  { slug: "dubai", name: "迪拜", nameEn: "Dubai", latitude: 25.2048, longitude: 55.2708, timezone: "Asia/Dubai" },
  { slug: "berlin", name: "柏林", nameEn: "Berlin", latitude: 52.52, longitude: 13.405, timezone: "Europe/Berlin" },
  { slug: "prague", name: "布拉格", nameEn: "Prague", latitude: 50.0755, longitude: 14.4378, timezone: "Europe/Prague" },
  { slug: "vienna", name: "维也纳", nameEn: "Vienna", latitude: 48.2082, longitude: 16.3738, timezone: "Europe/Vienna" },
  { slug: "los-angeles", name: "洛杉矶", nameEn: "Los Angeles", latitude: 34.0522, longitude: -118.2437, timezone: "America/Los_Angeles" },
];

/** 中英文城市名（及别名）→ 标准英文名，用于把用户中文输入映射成可雕刻的英文城市名。 */
export const CITY_NAME_ALIASES: Record<string, string> = Object.fromEntries(
  CITIES.flatMap((city) => [[city.name, city.nameEn], [city.nameEn, city.nameEn], [city.slug, city.nameEn]]),
);

/** 根据任意输入解析标准英文城市名；命中城市别名返回英文名，否则返回空串（由调用方决定回退策略）。 */
export function resolveEnglishCityName(input: string): string {
  const value = input.trim();
  if (!value) return "";
  const direct = CITY_NAME_ALIASES[value] ?? CITY_NAME_ALIASES[value.toLowerCase()];
  if (direct) return direct;
  // 已经是英文（仅含字母/空格/连字符）就直接用。
  if (/^[A-Za-z][A-Za-z .'-]*$/.test(value)) return value;
  return "";
}

export function resolveCity(input: string): City {
  const value = input.trim().toLowerCase();
  const city = CITIES.find((item) => [item.slug, item.name.toLowerCase(), item.nameEn.toLowerCase()].includes(value));
  if (city) return city;

  const match = value.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (match) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("坐标超出有效范围。纬度应为 -90..90，经度应为 -180..180。");
    return { slug: `coords-${latitude}-${longitude}`.replace(/\./g, "-"), name: `${latitude}, ${longitude}`, nameEn: "Custom coordinates", latitude, longitude, timezone: "UTC" };
  }

  // 任意城市名：用名称作为 slug，坐标设为 0,0 兜底，用户可见名保留原始输入。
  const name = input.trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
  return {
    slug,
    name,
    nameEn: name,
    latitude: 0,
    longitude: 0,
    timezone: "UTC",
  };
}
