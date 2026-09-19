/**
 * @deprecated 已被 lib/potrace-vectorize.ts 替代。
 *
 * 原版基于手写 Moore 邻域追踪 + RDP 简化，曲线质量不如 Potrace 工业级算法。
 * 新代码请使用 potraceVectorize() / potraceVectorizeMulti()。
 *
 * 此文件保留以向后兼容（ContourInfo 类型、simplifyRdp 测试、rasterToSvgPath 旧接口）。
 *
 * 光栅 → SVG path 矢量化管线（支持镂空：多外轮廓 + 内部孔洞）。
 *
 * 流程：base64 PNG → 解码像素 → 二值化 → 多轮廓 Moore 边界追踪 → 孔洞检测 → RDP 简化 → SVG path 列表。
 * 纯 TypeScript 实现，仅依赖 pngjs 解码 PNG。
 *
 * 制造约束：
 *   - 画布 300mm × 200mm，生成路径在 0..100 坐标系内
 *   - RDP 容差按像素计算，DFM 层兜底
 *
 * 镂空检测策略：
 *   1. 找所有"外轮廓"——黑色区域的外边界
 *   2. 对每个外轮廓内部的白色孔洞（被黑色完全包围的白色区域），找其边界作为"孔洞轮廓"
 *   3. 孔洞用反向绕向（逆时针）与外轮廓区分，SVG fill-rule=evenodd 自动处理
 */

import { PNG } from "pngjs";

export type Point = { x: number; y: number };

/** 解码 base64 PNG（可含 data: 前缀），返回灰度像素 + 尺寸。 */
export function decodePngToGrayscale(base64: string): { width: number; height: number; data: Uint8Array } {
  const clean = base64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(clean, "base64");
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    // 透明视作白；否则 ITU-R BT.601 亮度
    gray[i] = a < 128 ? 255 : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { width, height, data: gray };
}

/** 二值化：阈值以下（深色）为前景 1。 */
function binarize(gray: Uint8Array, width: number, height: number, threshold = 180): Uint8Array {
  const bin = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) bin[i] = gray[i] < threshold ? 1 : 0;
  return bin;
}

const MOORE: ReadonlyArray<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/**
 * Moore 邻域边界追踪：从起始点沿外轮廓走一圈，返回有序点列。
 * 通用版，可用于追踪外轮廓（前景=1）或孔洞轮廓（前景=0，被黑色=1 包围）。
 */
function traceContour(
  bin: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  foregroundValue: 1 | 0,
): Point[] {
  const contour: Point[] = [];
  const visited = new Uint8Array(width * height);
  let x = startX;
  let y = startY;
  let dir = 0;
  const maxSteps = width * height * 4;
  let steps = 0;
  do {
    if (steps > maxSteps) break;
    steps += 1;
    const idx = y * width + x;
    if (visited[idx]) break;
    visited[idx] = 1;
    contour.push({ x, y });
    let found = false;
    for (let k = 0; k < 8; k += 1) {
      const probe = (dir + k) % 8;
      const [dx, dy] = MOORE[probe];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (bin[ny * width + nx] === foregroundValue) {
        x = nx;
        y = ny;
        dir = (probe + 6) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;
  } while (!(x === startX && y === startY));
  return contour;
}

/** 找下一个前景像素作为轮廓起点（从上到下、左到右扫描）。 */
function findStartFrom(bin: Uint8Array, width: number, height: number, foregroundValue: 1 | 0, startScanIdx: number): Point | null {
  for (let i = startScanIdx; i < width * height; i += 1) {
    if (bin[i] === foregroundValue) return { x: i % width, y: Math.floor(i / width) };
  }
  return null;
}

/**
 * 检测一个点是否在多边形内部（ray casting）。
 * 用于判断白色孔洞是否真的"被黑色包围"。
 */
function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Ramer-Douglas-Peucker 折线简化。
 */
export function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const stack: [number, number][] = [[0, points.length - 1]];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = 0;
    const a = points[start];
    const b = points[end];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i];
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      const cx = a.x + Math.max(0, Math.min(1, t)) * dx;
      const cy = a.y + Math.max(0, Math.min(1, t)) * dy;
      const dist = Math.hypot(p.x - cx, p.y - cy);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * 将点列转为 SVG path data。坐标归一化到 0..100 整数坐标系。
 */
function pointsToPath(points: Point[], width: number, height: number): string {
  if (points.length < 3) return "";
  const scaleX = 100 / width;
  const scaleY = 100 / height;
  const fmt = (n: number) => Math.round(n * 10) / 10;
  const cmds: string[] = [];
  const first = points[0];
  cmds.push(`M${fmt(first.x * scaleX)} ${fmt(first.y * scaleY)}`);
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    cmds.push(`L${fmt(p.x * scaleX)} ${fmt(p.y * scaleY)}`);
  }
  cmds.push("Z");
  return cmds.join("");
}

export type ContourInfo = {
  path: string;
  pointCount: number;
  kind: "outer" | "hole";
};

/**
 * 多轮廓矢量化主入口：base64 PNG → 多条 SVG path（外轮廓 + 孔洞）。
 *
 * 镂空逻辑：
 *   1. 追踪所有黑色外轮廓（建筑实体）
 *   2. 在已追踪像素外，扫描白色像素；如果某白色区域被任一外轮廓包含，则视为孔洞
 *   3. 孔洞轮廓记为 kind="hole"，上层 SVG 用 fill-rule=evenodd 实现"挖空"
 *
 * 限制：最多 8 个外轮廓、每个外轮廓最多 12 个孔洞，避免 path 过多。
 */
export function rasterToSvgPathMulti(base64: string, options?: { rdpEpsilon?: number; maxOuters?: number; maxHolesPerOuter?: number; minContourPoints?: number }): { contours: ContourInfo[] } {
  const epsilon = options?.rdpEpsilon ?? 2.5;
  const maxOuters = options?.maxOuters ?? 8;
  const maxHolesPerOuter = options?.maxHolesPerOuter ?? 12;
  const minPoints = options?.minContourPoints ?? 4;
  const { width, height, data: gray } = decodePngToGrayscale(base64);
  const bin = binarize(gray, width, height);
  const contours: ContourInfo[] = [];

  // 1. 追踪所有黑色外轮廓
  const outersRaw: Point[][] = [];
  const visited = new Uint8Array(width * height);
  let scanIdx = 0;
  while (outersRaw.length < maxOuters) {
    const start = findStartFrom(bin, width, height, 1, scanIdx);
    if (!start) break;
    const contour = traceContour(bin, width, height, start.x, start.y, 1);
    if (contour.length >= minPoints) outersRaw.push(contour);
    // 标记已追踪的像素，避免重复
    for (const p of contour) visited[p.y * width + p.x] = 1;
    // 同时 flood fill 整个黑色区域为已访问，避免从同一黑色 blob 内再次起轮廓
    floodFillMark(bin, visited, width, height, start.x, start.y);
    scanIdx = (start.y * width + start.x) + 1;
  }

  // 2. 对每个外轮廓，在其内部找白色孔洞
  for (const outer of outersRaw) {
    const simplifiedOuter = simplifyRdp(outer, epsilon);
    if (simplifiedOuter.length < minPoints) continue;
    contours.push({ path: pointsToPath(simplifiedOuter, width, height), pointCount: simplifiedOuter.length, kind: "outer" });

    // 在外轮廓 bounding box 内扫描白色像素
    const bbox = boundingBox(outer);
    const holeVisited = new Uint8Array(width * height);
    let holesFound = 0;
    for (let y = bbox.minY; y <= bbox.maxY && holesFound < maxHolesPerOuter; y += 1) {
      for (let x = bbox.minX; x <= bbox.maxX && holesFound < maxHolesPerOuter; x += 1) {
        const idx = y * width + x;
        if (bin[idx] !== 0 || visited[idx] || holeVisited[idx]) continue;
        // 白色像素，且在外轮廓内部 → 候选孔洞
        if (!pointInPolygon(x, y, outer)) continue;
        const holeContour = traceContour(bin, width, height, x, y, 0);
        if (holeContour.length >= minPoints) {
          const simplifiedHole = simplifyRdp(holeContour, epsilon);
          if (simplifiedHole.length >= minPoints) {
            // 验证孔洞至少有一部分被外轮廓包围（避免边缘泄漏）
            const center = holeContour[Math.floor(holeContour.length / 2)];
            if (pointInPolygon(center.x, center.y, outer)) {
              contours.push({ path: pointsToPath(simplifiedHole, width, height), pointCount: simplifiedHole.length, kind: "hole" });
              holesFound += 1;
            }
          }
        }
        // 标记整个白色孔洞区域为已访问
        floodFillMarkValue(bin, holeVisited, width, height, x, y, 0);
      }
    }
  }

  return { contours };
}

function boundingBox(points: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** Flood fill 标记连通区域，避免同一 blob 内重复起轮廓。 */
function floodFillMark(bin: Uint8Array, visited: Uint8Array, width: number, height: number, startX: number, startY: number): void {
  const target = bin[startY * width + startX];
  const stack: number[] = [startX, startY];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx] || bin[idx] !== target) continue;
    visited[idx] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
}

/** Flood fill 标记特定值的连通区域到目标 visited 数组。 */
function floodFillMarkValue(bin: Uint8Array, visited: Uint8Array, width: number, height: number, startX: number, startY: number, target: number): void {
  const stack: number[] = [startX, startY];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx] || bin[idx] !== target) continue;
    visited[idx] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
}

export type VectorizeResult = { path: string; pointCount: number };

/**
 * 兼容旧接口：base64 PNG → 单条闭合 SVG path（仅外轮廓，不追踪孔洞）。
 * 仅供不需要镂空的场景使用；需要镂空请用 rasterToSvgPathMulti。
 */
export function rasterToSvgPath(base64: string, options?: { rdpEpsilon?: number }): VectorizeResult {
  const epsilon = options?.rdpEpsilon ?? 2.0;
  const { width, height, data: gray } = decodePngToGrayscale(base64);
  const bin = binarize(gray, width, height);
  const start = findStartFrom(bin, width, height, 1, 0);
  if (!start) return { path: "", pointCount: 0 };
  let contour = traceContour(bin, width, height, start.x, start.y, 1);
  if (contour.length < 3) return { path: "", pointCount: 0 };
  contour = simplifyRdp(contour, epsilon);
  const path = pointsToPath(contour, width, height);
  return { path, pointCount: contour.length };
}
