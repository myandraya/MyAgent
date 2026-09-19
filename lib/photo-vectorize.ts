/**
 * 照片镂空矢量化管线（含 Otsu 自适应二值化预处理）。
 *
 * 问题：真实照片灰度层次丰富（渐变天空、深灰主体、噪点），Potrace 的自动阈值
 * 处理这类图像效果极差——主体丢失或轮廓破碎。
 *
 * 方案：上传图先做 Otsu 自适应二值化，把照片转成干净的黑白图，再喂 Potrace。
 * Otsu 自动选择"前景/背景类间方差最大"的阈值，对光照不均的照片也稳健。
 *
 * 流程：PNG base64 → 灰度化 → Otsu 阈值 → 保留最大前景连通域 → Potrace → cutPath
 */

import { PNG } from "pngjs";
import { potraceVectorize } from "./potrace-vectorize.ts";

/**
 * Otsu 自适应阈值：遍历 0..255 找使前景/背景类间方差最大的灰度值。
 * 对双峰直方图（主体 vs 背景）效果最好。
 */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

export type PhotoVectorizeResult = {
  ok: boolean;
  cutPath: string;
  /** 二值化使用的阈值（调试/展示用） */
  threshold: number;
  /** 不与画布边界相连的有效白色孔洞数。 */
  holeCount: number;
  /** 二值化后主体黑色像素占比，用于 Agent 判断主体是否过满或丢失。 */
  foregroundRatio: number;
  error?: string;
};

export type PhotoVectorizeOptions = {
  /** Potrace turdSize（噪点抑制），照片默认 8 */
  turdSize?: number;
  /** 阈值偏移量：-60..60，负数保留更多暗部为前景，正数反之。默认 0 */
  thresholdBias?: number;
};

/** 8 邻域连通域筛选：只保留主体，删除与主体完全断开的黑色孤岛。 */
export function keepLargestForegroundComponent(foreground: Uint8Array, width: number, height: number): Uint8Array {
  if (foreground.length !== width * height) throw new Error("前景蒙版尺寸无效。");
  const labels = new Int32Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  let label = 0;
  let largestLabel = 0;
  let largestSize = 0;

  for (let start = 0; start < foreground.length; start += 1) {
    if (!foreground[start] || labels[start]) continue;
    label += 1;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    labels[start] = label;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!foreground[next] || labels[next]) continue;
        labels[next] = label;
        queue[tail++] = next;
      }
    }
    if (tail > largestSize) {
      largestSize = tail;
      largestLabel = label;
    }
  }

  const kept = new Uint8Array(foreground.length);
  for (let i = 0; i < kept.length; i += 1) kept[i] = labels[i] === largestLabel && largestLabel !== 0 ? 1 : 0;
  return kept;
}

/** 统计被黑色主体完全包围的、足够大的白色连通域。 */
export function countMeaningfulHoles(foreground: Uint8Array, width: number, height: number, minPixels?: number): number {
  if (foreground.length !== width * height) throw new Error("前景蒙版尺寸无效。");
  const visited = new Uint8Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  const minimum = minPixels ?? Math.max(8, Math.round(width * height * 0.0005));
  let holes = 0;
  for (let start = 0; start < foreground.length; start += 1) {
    if (foreground[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    let touchesBorder = false;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (foreground[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (!touchesBorder && tail >= minimum) holes += 1;
  }
  return holes;
}

/**
 * 主入口：PNG base64 → Otsu 二值化 → Potrace → 镂空复合 path（0..100 坐标系）。
 */
export async function vectorizePhoto(base64: string, options?: PhotoVectorizeOptions): Promise<PhotoVectorizeResult> {
  try {
    const clean = base64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(clean, "base64");
    const png = PNG.sync.read(buffer);
    const { width, height, data } = png;
    if (width < 8 || height < 8) {
      return { ok: false, cutPath: "", threshold: 0, holeCount: 0, foregroundRatio: 0, error: "图片太小，至少 8×8 像素。" };
    }

    // 1. 灰度化（ITU-R BT.601）
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    }

    // 2. Otsu 阈值 + 用户偏移，钳制在安全范围
    const raw = otsuThreshold(gray);
    const threshold = Math.max(30, Math.min(225, raw + (options?.thresholdBias ?? 0)));

    // 3. 二值化后只保留最大黑色连通域，删除天空黑点等悬空孤岛。
    const foreground = new Uint8Array(width * height);
    for (let i = 0; i < foreground.length; i += 1) foreground[i] = gray[i] < threshold ? 1 : 0;
    const connectedForeground = keepLargestForegroundComponent(foreground, width, height);
    const foregroundPixels = connectedForeground.reduce((sum, value) => sum + value, 0);
    const foregroundRatio = foregroundPixels / connectedForeground.length;
    const holeCount = countMeaningfulHoles(connectedForeground, width, height);
    const bin = new PNG({ width, height });
    for (let i = 0; i < width * height; i += 1) {
      const v = connectedForeground[i] ? 0 : 255;
      bin.data[i * 4] = v;
      bin.data[i * 4 + 1] = v;
      bin.data[i * 4 + 2] = v;
      bin.data[i * 4 + 3] = 255;
    }
    const binBuffer = PNG.sync.write(bin);

    // 4. Potrace 矢量化（输入已是纯黑白，threshold 无需再设）
    const result = await potraceVectorize(binBuffer.toString("base64"), {
      turdSize: options?.turdSize ?? 8,
      optCurve: true,
      optTolerance: 0.4,
      blackOnWhite: true,
    });

    if (!result.ok) {
      return { ok: false, cutPath: "", threshold, holeCount, foregroundRatio, error: "图片对比度不足，无法提取轮廓。请换一张主体清晰、背景简洁的照片。" };
    }
    return { ok: true, cutPath: result.path, threshold, holeCount, foregroundRatio };
  } catch (reason) {
    return {
      ok: false,
      cutPath: "",
      threshold: 0,
      holeCount: 0,
      foregroundRatio: 0,
      error: reason instanceof Error ? reason.message : "图片处理失败。",
    };
  }
}
