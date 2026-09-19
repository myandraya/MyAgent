import type { City } from "../lib/types.ts";

export const CITIES: City[] = [
  { slug: "edinburgh", name: "爱丁堡", nameEn: "Edinburgh", latitude: 55.9533, longitude: -3.1883, timezone: "Europe/London", poem: ["旧城的风把星光折进归途", "The old town folds starlight into the road home."] },
  { slug: "london", name: "伦敦", nameEn: "London", latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London", poem: ["泰晤士河不说再见，只把夜色寄来", "The Thames says no farewell; it sends the night."] },
  { slug: "sydney", name: "悉尼", nameEn: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney", poem: ["南十字星仍替你守着海岸", "The Southern Cross still keeps your shore."] },
  { slug: "melbourne", name: "墨尔本", nameEn: "Melbourne", latitude: -37.8136, longitude: 144.9631, timezone: "Australia/Melbourne", poem: ["电车拐过雨天，也拐进了记忆", "A tram turns through rain and into memory."] },
  { slug: "new-york", name: "纽约", nameEn: "New York", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York", poem: ["高楼熄灯后，你的那扇窗仍亮着", "After the skyline dims, your window stays alight."] },
  { slug: "beijing", name: "北京", nameEn: "Beijing", latitude: 39.9042, longitude: 116.4074, timezone: "Asia/Shanghai", poem: ["同一颗星，照见两座叫家的城", "One star shines on two cities called home."] }
];

export function resolveCity(input: string): City {
  const value = input.trim().toLowerCase();
  const city = CITIES.find((item) => [item.slug, item.name.toLowerCase(), item.nameEn.toLowerCase()].includes(value));
  if (city) return city;

  const match = value.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (match) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("坐标超出有效范围。纬度应为 -90..90，经度应为 -180..180。");
    return { slug: `coords-${latitude}-${longitude}`.replace(/\./g, "-"), name: `${latitude}, ${longitude}`, nameEn: "Custom coordinates", latitude, longitude, timezone: "UTC", poem: ["坐标记得你曾仰望过", "The coordinates remember where you looked up."] };
  }

  // 任意城市名：用名称作为 slug，坐标设为 0,0（仅用于星图兜底），用户可见名保留原始输入。
  const name = input.trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
  return {
    slug,
    name,
    nameEn: name,
    latitude: 0,
    longitude: 0,
    timezone: "UTC",
    poem: ["那座城，在记忆里发光", "That city glows in memory."],
  };
}
