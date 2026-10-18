/**
 * 材料布尔合并（对齐正式产品方案 §7.2）：
 * 把相框、地平线横条、建筑、城市名等「保留材料元素」真正合并成一个实心整体，
 * 提取唯一的外轮廓 + 内孔（内部重叠边全部消失），作为可切割的最终边界。
 *
 * 选型：polygon-clipping（MIT，零依赖，Martinez-Rueda-Feito 扫描线算法）。
 * 理由（见选型调研）：
 *   - 我们的 Potrace 轮廓 / 相框 / 横条 / 字形本身就是折线多边形（曲线可无损拉平，
 *     拉平误差远小于激光 ~0.1mm 刀缝），无需 paper.js 的完整贝塞尔布尔 + node-canvas 原生依赖。
 *   - polygon-clipping 体积最小、许可最干净、周下载 90w+，成熟稳定。
 *
 * 语义约定：
 *   - 输入为「保留材料」的闭合子路径集合（每个元素各自在毫米画布坐标下）。
 *   - 输出为 GeoJSON 风格 MultiPolygon（外环逆时针、内孔顺时针，polygon-clipping 已保证），
 *     再转回 SVG path（M...Z M...Z），配合 fill-rule=evenodd 正确渲染孔洞。
 */

import polygonClipping from "polygon-clipping";

/** 折线化后的多边形（GeoJSON 坐标：外层数组 = 多边形，内层 = 环，环 = [x,y] 点列）。 */
type Ring = [number, number][];
type Polygon = Ring[];

/** 解析 path 数据为「折线环」集合（曲线命令自适应细分为折线段）。 */
export function pathDataToRings(pathData: string, curveTolerance = 0.5): Ring[] {
  const rings: Ring[] = [];
  const subpaths = pathData.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
  for (const sub of subpaths) {
    const ring = subpathToRing(sub, curveTolerance);
    if (ring && ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * 把单个子路径（M 开头）解析成闭合折线环。
 * 支持 M/L/H/V 直线命令，以及 C/S/Q/T 曲线命令（采样细分）。
 */
function subpathToRing(sub: string, tolerance: number): Ring | null {
  // tokenize：命令字母 + 数字
  const tokens = sub.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let cur: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  // 曲线缓存：用于 S/T 的隐式控制点
  let lastCubicCtrl: [number, number] | null = null;
  let lastQuadCtrl: [number, number] | null = null;

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!/^[A-Za-z]$/.test(tok)) { i += 1; continue; }
    const c = tok.toUpperCase();
    const isRelative = tok !== c;
    // 读取本命令后的数字
    const nums: number[] = [];
    i += 1;
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
      nums.push(Number(tokens[i]));
      i += 1;
    }

    const abs = (px: number, py: number): [number, number] =>
      isRelative ? [cur[0] + px, cur[1] + py] : [px, py];

    switch (c) {
      case "M": {
        for (let k = 0; k + 1 < nums.length; k += 2) {
          const p = abs(nums[k], nums[k + 1]);
          if (k === 0 && points.length === 0) {
            start = p;
            points.push(p);
          } else {
            points.push(p);
          }
          cur = p;
        }
        lastCubicCtrl = null; lastQuadCtrl = null;
        break;
      }
      case "L": {
        for (let k = 0; k + 1 < nums.length; k += 2) {
          const p = abs(nums[k], nums[k + 1]);
          points.push(p);
          cur = p;
        }
        lastCubicCtrl = null; lastQuadCtrl = null;
        break;
      }
      case "H": {
        for (const v of nums) { cur = isRelative ? [cur[0] + v, cur[1]] : [v, cur[1]]; points.push(cur); }
        lastCubicCtrl = null; lastQuadCtrl = null;
        break;
      }
      case "V": {
        for (const v of nums) { cur = isRelative ? [cur[0], cur[1] + v] : [cur[0], v]; points.push(cur); }
        lastCubicCtrl = null; lastQuadCtrl = null;
        break;
      }
      case "C": {
        for (let k = 0; k + 5 < nums.length; k += 6) {
          const c1 = abs(nums[k], nums[k + 1]);
          const c2 = abs(nums[k + 2], nums[k + 3]);
          const end = abs(nums[k + 4], nums[k + 5]);
          sampleCubic(cur, c1, c2, end, tolerance, points);
          cur = end;
          lastCubicCtrl = c2;
        }
        lastQuadCtrl = null;
        break;
      }
      case "S": {
        for (let k = 0; k + 3 < nums.length; k += 4) {
          const c2 = abs(nums[k], nums[k + 1]);
          const end = abs(nums[k + 2], nums[k + 3]);
          const c1: [number, number] = lastCubicCtrl ? [2 * cur[0] - lastCubicCtrl[0], 2 * cur[1] - lastCubicCtrl[1]] : cur;
          sampleCubic(cur, c1, c2, end, tolerance, points);
          cur = end;
          lastCubicCtrl = c2;
        }
        lastQuadCtrl = null;
        break;
      }
      case "Q": {
        for (let k = 0; k + 3 < nums.length; k += 4) {
          const c1 = abs(nums[k], nums[k + 1]);
          const end = abs(nums[k + 2], nums[k + 3]);
          sampleQuad(cur, c1, end, tolerance, points);
          cur = end;
          lastQuadCtrl = c1;
        }
        lastCubicCtrl = null;
        break;
      }
      case "T": {
        for (let k = 0; k + 1 < nums.length; k += 2) {
          const end = abs(nums[k], nums[k + 1]);
          const c1: [number, number] = lastQuadCtrl ? [2 * cur[0] - lastQuadCtrl[0], 2 * cur[1] - lastQuadCtrl[1]] : cur;
          sampleQuad(cur, c1, end, tolerance, points);
          cur = end;
          lastQuadCtrl = c1;
        }
        lastCubicCtrl = null;
        break;
      }
      case "Z":
      case "z": {
        // 闭合：回到起点（若未闭合）
        if (points.length >= 2) {
          const last = points[points.length - 1];
          if (Math.abs(last[0] - start[0]) > 1e-9 || Math.abs(last[1] - start[1]) > 1e-9) {
            points.push([start[0], start[1]]);
          }
        }
        cur = start;
        break;
      }
      default:
        break;
    }
  }

  // 若子路径末尾未显式 Z 但已回到起点附近，补闭合
  if (points.length >= 3) {
    const last = points[points.length - 1];
    const first = points[0];
    if (Math.abs(last[0] - first[0]) > 1e-9 || Math.abs(last[1] - first[1]) > 1e-9) {
      points.push([first[0], first[1]]);
    }
  }

  if (points.length < 3) return null;
  // 去重相邻重复点
  const dedup: [number, number][] = [];
  for (const p of points) {
    const prev = dedup[dedup.length - 1];
    if (!prev || Math.abs(prev[0] - p[0]) > 1e-9 || Math.abs(prev[1] - p[1]) > 1e-9) dedup.push(p);
  }
  return dedup.length >= 3 ? dedup : null;
}

/** 三次贝塞尔自适应采样（De Casteljau 细分）。 */
function sampleCubic(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], tolerance: number, out: [number, number][]): void {
  const flat = flatnessCubic(p0, p1, p2, p3);
  if (flat < tolerance) {
    out.push(p3);
    return;
  }
  // De Casteljau 在 t=0.5 处细分
  const p01: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const p12: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const p23: [number, number] = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const p012: [number, number] = [(p01[0] + p12[0]) / 2, (p01[1] + p12[1]) / 2];
  const p123: [number, number] = [(p12[0] + p23[0]) / 2, (p12[1] + p23[1]) / 2];
  const mid: [number, number] = [(p012[0] + p123[0]) / 2, (p012[1] + p123[1]) / 2];
  sampleCubic(p0, p01, p012, mid, tolerance, out);
  sampleCubic(mid, p123, p23, p3, tolerance, out);
}

/** 二次贝塞尔自适应采样。 */
function sampleQuad(p0: [number, number], p1: [number, number], p2: [number, number], tolerance: number, out: [number, number][]): void {
  const flat = flatnessQuad(p0, p1, p2);
  if (flat < tolerance) {
    out.push(p2);
    return;
  }
  const [q0, q1, q2] = splitQuad(p0, p1, p2);
  sampleQuad(q0, q1, q2, tolerance, out);
  sampleQuad(q2, q2, p2, tolerance, out);
}

function flatnessQuad(p0: [number, number], p1: [number, number], p2: [number, number]): number {
  // 控制点到弦的垂直距离近似平坦度
  return pointLineDistance(p1, p0, p2);
}

function flatnessCubic(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): number {
  return Math.max(pointLineDistance(p1, p0, p3), pointLineDistance(p2, p0, p3));
}

function pointLineDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function splitQuad(p0: [number, number], p1: [number, number], p2: [number, number]): [[number, number], [number, number], [number, number]] {
  const q0 = p0;
  const q1: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const q2: [number, number] = [
    (p0[0] + 2 * p1[0] + p2[0]) / 4,
    (p0[1] + 2 * p1[1] + p2[1]) / 4,
  ];
  return [q0, q1, q2];
}

/**
 * 把「保留材料元素」做布尔并集合并，返回唯一的外轮廓+内孔的 GeoJSON MultiPolygon。
 *
 * @param elements 每个元素是一个多边形（外环 + 内孔），坐标已在统一画布空间。
 */
export function unionMaterials(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons[0].length ? [polygons[0]] : [];
  // polygon-clipping.union 接受多个 (multi)polygon 参数；用 apply 规避 TS 对 rest spread 的收紧。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (polygonClipping.union as any)(...polygons) as Polygon[];
  return result;
}

/** 把 GeoJSON 多边形（外环+内孔）转回 SVG path 数据。 */
export function polygonsToPathData(polygons: Polygon[]): string {
  if (!polygons.length) return "";
  const parts: string[] = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      let d = "M";
      for (let i = 0; i < ring.length; i += 1) {
        const [x, y] = ring[i];
        d += `${i === 0 ? "" : "L"}${round(x)} ${round(y)}`;
      }
      d += "Z";
      parts.push(d);
    }
  }
  return parts.join(" ");
}

function round(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}
