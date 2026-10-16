import type { City } from "../lib/types.ts";

export const CITIES: City[] = [
  { slug: "edinburgh", name: "爱丁堡", nameEn: "Edinburgh", latitude: 55.9533, longitude: -3.1883, timezone: "Europe/London" },
  { slug: "london", name: "伦敦", nameEn: "London", latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London" },
  { slug: "sydney", name: "悉尼", nameEn: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney" },
  { slug: "melbourne", name: "墨尔本", nameEn: "Melbourne", latitude: -37.8136, longitude: 144.9631, timezone: "Australia/Melbourne" },
  { slug: "new-york", name: "纽约", nameEn: "New York", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York" },
  { slug: "beijing", name: "北京", nameEn: "Beijing", latitude: 39.9042, longitude: 116.4074, timezone: "Asia/Shanghai" }
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
