import { allow, clientIp } from "../../../lib/rate-limit.ts";

/**
 * 地点定位 API：地名 → 高德地理编码 / POI 搜索 → 候选地点列表。
 *
 * 解决"到底是哪一个地方"——同名村镇、街道、景点要展示多个候选让用户确认，
 * 不能自动替换成附近的著名景点。
 *
 * 环境变量：
 *   AMAP_API_KEY  高德开放平台 Web 服务 key（https://console.amap.com）
 *
 * 无 key 时返回 { ok: false, reason: "no_key" }，前端据此引导用户直接上传照片，
 * 不阻断"忠实还原"主链路。
 */

export type GeocodeCandidate = {
  id: string;
  name: string;
  address: string;
  province: string;
  city: string;
  district: string;
  longitude: number;
  latitude: number;
  type: string; // 地物类型（如 "地名地址信息" / "餐饮服务" 等）
};

export type GeocodeResponse = {
  ok: boolean;
  reason?: "no_key" | "no_result" | "error";
  query: string;
  candidates: GeocodeCandidate[];
};

function hasAmapKey(): boolean {
  const key = process.env.AMAP_API_KEY;
  return Boolean(key && !/placeholder|replace|your[_-]?amap/i.test(key));
}

/** 调用高德地理编码（geocode/geo），返回结构化地址 + 坐标。 */
async function amapGeocode(address: string, signal: AbortSignal): Promise<GeocodeCandidate[]> {
  const params = new URLSearchParams({ key: process.env.AMAP_API_KEY!, address, output: "JSON" });
  const response = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params}`, { signal });
  if (!response.ok) return [];
  const payload = await response.json() as {
    status?: string;
    geocodes?: { adcode?: string; city?: string; district?: string; province?: string; formatted_address?: string; location?: string; level?: string }[];
  };
  if (payload.status !== "1") return [];
  return (payload.geocodes ?? []).map((g) => {
    const [lng, lat] = (g.location ?? "0,0").split(",").map(Number);
    return {
      id: `geo-${g.adcode ?? g.formatted_address ?? address}`,
      name: g.formatted_address ?? address,
      address: g.formatted_address ?? "",
      province: g.province ?? "",
      city: g.city ?? "",
      district: g.district ?? "",
      longitude: Number.isFinite(lng) ? lng : 0,
      latitude: Number.isFinite(lat) ? lat : 0,
      type: g.level ?? "地名地址信息",
    };
  });
}

/** 调用高德输入提示（POI 搜索），返回更细粒度的同名候选。 */
async function amapInputtips(keywords: string, signal: AbortSignal): Promise<GeocodeCandidate[]> {
  const params = new URLSearchParams({ key: process.env.AMAP_API_KEY!, keywords, output: "JSON", citylimit: "false" });
  const response = await fetch(`https://restapi.amap.com/v3/assistant/inputtips?${params}`, { signal });
  if (!response.ok) return [];
  const payload = await response.json() as {
    status?: string;
    tips?: { id?: string; name?: string; district?: string; adcode?: string; address?: string; location?: string; typecode?: string }[];
  };
  if (payload.status !== "1") return [];
  return (payload.tips ?? []).map((tip) => {
    const [lng, lat] = (tip.location ?? "0,0").split(",").map(Number);
    return {
      id: tip.id ?? tip.name ?? keywords,
      name: tip.name ?? "",
      address: tip.address ?? tip.district ?? "",
      province: "",
      city: tip.district ?? "",
      district: tip.district ?? "",
      longitude: Number.isFinite(lng) ? lng : 0,
      latitude: Number.isFinite(lat) ? lat : 0,
      type: tip.typecode ?? "POI",
    };
  });
}

/**
 * Nominatim（OSM 官方地理编码）降级：海外地名（高德覆盖弱）走这里。
 * 免费、无需 key，但有限流（约 1 req/s），仅作高德失败时的兜底，不并发猛刷。
 */
async function nominatimSearch(address: string, signal: AbortSignal): Promise<GeocodeCandidate[]> {
  const params = new URLSearchParams({
    q: address,
    format: "jsonv2",
    limit: "8",
    addressdetails: "1",
    // 附带 UA，遵守 Nominatim 使用政策（必须标识调用方）
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    signal,
    headers: { "User-Agent": "MakerMuse/0.1 (city landmark geocoding fallback)" },
  });
  if (!response.ok) return [];
  const payload = await response.json() as {
    lat?: string; lon?: string; display_name?: string; type?: string; class?: string;
    address?: { province?: string; city?: string; town?: string; district?: string; country?: string };
  }[];
  return (Array.isArray(payload) ? payload : []).map((item) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const addr = item.address ?? {};
    const city = addr.city ?? addr.town ?? "";
    return {
      id: `nom-${item.display_name ?? address}`,
      name: item.display_name ?? address,
      address: item.display_name ?? "",
      province: addr.province ?? "",
      city,
      district: addr.district ?? "",
      longitude: Number.isFinite(lon) ? lon : 0,
      latitude: Number.isFinite(lat) ? lat : 0,
      type: item.type ?? item.class ?? "OSM",
    };
  });
}

export const maxDuration = 40;

export async function POST(request: Request): Promise<Response> {
  if (!allow(clientIp(request), 10, 10_000, "geocode")) {
    return Response.json({ error: "定位请求太频繁，请稍后再试。" }, { status: 429 });
  }
  let query = "";
  try {
    const body = await request.json() as { query?: unknown };
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 100) throw new Error("invalid");
    query = body.query.trim();
  } catch {
    return Response.json({ error: "请输入 1..100 个字符的地名。" }, { status: 400 });
  }

  const signal = AbortSignal.timeout(8_000);

  // 高德可用则优先高德（国内地名覆盖更好）。
  if (hasAmapKey()) {
    try {
      const [geo, tips] = await Promise.all([
        amapGeocode(query, signal),
        amapInputtips(query, signal),
      ]);
      // 去重：优先保留更细粒度的 POI，其次地理编码结果
      const seen = new Set<string>();
      const candidates: GeocodeCandidate[] = [];
      for (const item of [...tips, ...geo]) {
        const key = `${item.name}|${item.longitude.toFixed(4)}|${item.latitude.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(item);
        if (candidates.length >= 8) break;
      }
      if (candidates.length) {
        return Response.json({ ok: true, query, candidates } satisfies GeocodeResponse);
      }
      // 高德无结果 → 落到下面的 Nominatim 降级。
    } catch (error) {
      console.error("[geocode] 高德定位异常，尝试 Nominatim 降级:", error);
    }
  }

  // 无高德 key，或高德失败/无结果 → Nominatim 兜底（海外地名命中率更高）。
  // Nominatim 免费实例响应较慢，用独立的更长超时，避免与高德共用已消耗的时间预算。
  try {
    const candidates = await nominatimSearch(query, AbortSignal.timeout(12_000));
    if (candidates.length) {
      return Response.json({ ok: true, query, candidates } satisfies GeocodeResponse);
    }
    return Response.json({ ok: false, reason: "no_result", query, candidates: [] } satisfies GeocodeResponse);
  } catch (error) {
    console.error("[geocode] Nominatim 定位异常:", error);
    return Response.json({ ok: false, reason: "error", query, candidates: [] } satisfies GeocodeResponse);
  }
}
