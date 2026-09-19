import { Horizon, Observer } from "astronomy-engine";
import { CITIES, resolveCity } from "../data/cities.ts";
import { BRIGHT_STARS } from "../data/stars.ts";
import type { StarPoint } from "./types.ts";

function assertDate(value: string): [number, number, number] {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("日期必须为 YYYY-MM-DD。");
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) throw new Error("日期不存在。");
  return parts;
}

export function localDateToUtc(date: string, hour: number, timezone: string): Date {
  const [year, month, day] = assertDate(date);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("小时必须为 0..23 的整数。");
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour);
    guess += target - represented;
  }
  return new Date(guess);
}

export function queryStarMap(input: { city: string; date: string; sizeMm?: number; localHour?: number }) {
  const city = resolveCity(input.city);
  // 星图计算需要真实地理坐标；resolveCity 对任意城市名返回 0,0 兜底坐标，
  // 此处拒绝未知城市以保证天文结果真实。
  if (!CITIES.includes(city) && !city.slug.startsWith("coords-")) {
    throw new Error(`不支持的城市"${input.city}"；星图入口请选择内置城市或输入 lat,lon。`);
  }
  const sizeMm = input.sizeMm ?? 300;
  const localHour = input.localHour ?? 22;
  if (!Number.isFinite(sizeMm) || sizeMm < 80 || sizeMm > 380) throw new Error("设计尺寸必须在 80..380mm。 ");
  const observedAt = localDateToUtc(input.date, localHour, city.timezone);
  const observer = new Observer(city.latitude, city.longitude, 0);
  const radius = sizeMm / 2 - 10;
  const center = sizeMm / 2;

  const stars: StarPoint[] = BRIGHT_STARS.map((star) => {
    const horizontal = Horizon(observedAt, observer, star.ra, star.dec, "normal");
    const distance = ((90 - horizontal.altitude) / 90) * radius;
    const azimuth = horizontal.azimuth * Math.PI / 180;
    return {
      ...star,
      x: center + distance * Math.sin(azimuth),
      y: center - distance * Math.cos(azimuth),
      radius: Math.max(0.75, Math.min(1.35, 1.2 - star.magnitude * 0.16)),
      altitude: horizontal.altitude,
      azimuth: horizontal.azimuth
    };
  }).filter((star) => star.altitude >= 0).sort((a, b) => a.magnitude - b.magnitude);

  return { city, date: input.date, observedAtUtc: observedAt.toISOString(), localHour, sizeMm, stars };
}
