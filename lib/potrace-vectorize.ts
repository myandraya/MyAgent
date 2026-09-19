/**
 * Potrace 矢量化封装 —— 用原版 Potrace 算法替换手写 Moore+RDP。
 *
 * 优势：
 *   - 曲线平滑（贝塞尔优化，optCurve=true）
 *   - 多轮廓 + 孔洞自动处理（fill-rule=evenodd）
 *   - turdSize 抑制噪点小斑点
 *   - 工业级标准，符合激光切割图要求
 *
 * potrace npm 包基于 jimp（CommonJS、callback 风格、无 TS 类型），
 * 这里封装为 Promise + 提取 path data（d 属性），输出与 image-to-svg.ts 兼容的分层结构。
 */

import { PNG } from "pngjs";
import type { ContourInfo } from "./image-to-svg.ts";

// potrace 是 CJS 包，无类型声明。用静态 import 让打包器能识别依赖，
// 否则 Turbopack 不会把 potrace 打进 serverless 产物，部署后报 MODULE_NOT_FOUND。
// CJS 的 module.exports 会被 Turbopack 映射为默认导出的命名空间对象。
import potrace from "potrace";

type PotraceCtor = new () => {
  setParameters(params: Record<string, unknown>): void;
  loadImage(input: Buffer | string, cb: (err: Error | null) => void): void;
  getPathTag(): string;
  getSVG(): string;
};

type TraceFn = (
  input: Buffer | string,
  params: Record<string, unknown>,
  cb: (err: Error | null, svg: string) => void,
) => void;

const PotraceModule = potrace as unknown as {
  Potrace: PotraceCtor;
  default: { trace: TraceFn };
  trace: TraceFn;
};

/** Potrace 参数，按激光切割优化。 */
export type PotraceOptions = {
  /** 黑白阈值，0..255；undefined 让 Potrace 自动选择（推荐） */
  threshold?: number;
  /** 抑制小于此像素数的斑点（噪点清理），默认 2 */
  turdSize?: number;
  /** 是否启用贝塞尔曲线优化，默认 true */
  optCurve?: boolean;
  /** 曲线优化容差，默认 0.2 */
  optTolerance?: number;
  /** 角点锐度 0..1.34，默认 1（圆滑） */
  alphaMax?: number;
  /** 黑色在白色背景上（true）还是白色在黑色上 */
  blackOnWhite?: boolean;
};

/** callback 风格的 potrace.trace 封装为 Promise。 */
function traceWithCallback(input: Buffer | string, params: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    PotraceModule.trace(input, params, (err: Error | null, svg: string) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

/**
 * 从 Potrace 输出的 <path d="..."> 标签里提取 d 属性值。
 * Potrace 的 path 可能包含多个子路径（M...Z M...Z），用 fill-rule=evenodd 实现镂空。
 */
function extractPathData(pathTag: string): string {
  const match = pathTag.match(/d="([^"]+)"/);
  return match ? match[1] : "";
}

/**
 * 将 Potrace 输出的像素坐标系 path 缩放到 0..100 坐标系（与离线生成器一致）。
 *
 * Potrace 输出绝对命令 M/L/C（x y 交替），token 化后按 x/y 交替缩放。
 * 例如 "M 509.741 31.355 C 509.137 47.911, ..." → 所有 x 乘 scaleX，y 乘 scaleY。
 */
function scalePathData(d: string, scaleX: number, scaleY: number): string {
  const tokens = d.match(/[MLCZz]|-?\d*\.?\d+/g);
  if (!tokens) return d;
  const out: string[] = [];
  let isX = true;
  for (const token of tokens) {
    if (/^[MLCZz]$/.test(token)) {
      out.push(token);
      // M/L/C 都以 x 坐标开头；Z 无坐标
      if (token !== "Z" && token !== "z") isX = true;
      continue;
    }
    const value = Number(token) * (isX ? scaleX : scaleY);
    out.push(String(Math.round(value * 100) / 100));
    isX = !isX;
  }
  return out.join(" ");
}

/**
 * 用 Potrace 类实例精确控制参数，返回单条复合 path（含外轮廓 + 孔洞，evenodd）。
 * 适合"建筑外轮廓 + 窗户孔"这种镂空场景。
 */
async function traceWithPotraceClass(input: Buffer, options: PotraceOptions = {}): Promise<string> {
  const tracer = new PotraceModule.Potrace();
  const params: Record<string, unknown> = {
    turdSize: options.turdSize ?? 2,
    optCurve: options.optCurve ?? true,
    optTolerance: options.optTolerance ?? 0.2,
    alphaMax: options.alphaMax ?? 1,
    blackOnWhite: options.blackOnWhite ?? true,
  };
  // threshold 不传时让 Potrace 用自动阈值；传了数字才设置
  if (typeof options.threshold === "number") params.threshold = options.threshold;
  tracer.setParameters(params);
  await new Promise<void>((resolve, reject) => {
    tracer.loadImage(input, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
  const pathTag = tracer.getPathTag();
  return extractPathData(pathTag);
}

export type PotraceVectorizeResult = {
  /** Potrace 输出的复合 path（含外轮廓 + 孔洞，M...Z M...Z ...） */
  path: string;
  /** 是否成功（path 非空） */
  ok: boolean;
};

/**
 * 把 Potrace 复合 path 转为 clean line art 风格：
 *   - 每个子路径都以 Z 显式闭合（确保无断头）
 *   - 去重：完全相同的子路径只保留一条
 *   - 丢弃过短子路径（< 20 字符）减少噪点
 *
 * 输入："M10 10L20 20L30 10 M5 5L15 5L15 15L5 15 M10 10L20 20L30 10"
 * 输出："M10 10L20 20L30 10Z M5 5L15 5L15 15L5 15Z"（去重 + 显式闭合）
 */
export function cleanLinePath(d: string): string {
  if (!d || d.length < 10) return "";
  // 按 M 拆分子路径
  const segments = d.split(/(?=[Mm])/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 0) return "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (let seg of segments) {
    // 丢弃碎片：少于 2 个坐标点（即 < 8 字符或只有 M+一对坐标）
    // 有效子路径至少 M x y L x y 或 M x y L x y L x y（闭合）
    if (seg.length < 8) continue;
    // 显式闭合：若未以 Z 结尾则补 Z
    if (!/[Zz]$/.test(seg)) seg += "Z";
    // 只能删除完全相同的轮廓；只比较前缀会误删共用起始段的孔洞。
    if (seen.has(seg)) continue;
    seen.add(seg);
    out.push(seg);
  }
  return out.join(" ");
}

/**
 * 主入口：base64 PNG → Potrace 矢量化 → 单条复合 SVG path（0..100 坐标系）。
 *
 * 输出一条 path，内部可能含多个 M...Z 子路径：
 *   - 外轮廓（建筑实体）顺时针绕向
 *   - 孔洞（窗户/门）逆时针绕向
 *   SVG fill-rule="evenodd" 自动实现镂空。
 *
 * 坐标系：Potrace 输出像素坐标（如 0..1024），这里缩放到 0..100，
 * 与离线参数化生成器一致，供 silhouette.ts 映射到毫米画布。
 *
 * 失败时返回 { path: "", ok: false }，由上层降级到参数化兜底。
 */
export async function potraceVectorize(base64: string, options?: PotraceOptions): Promise<PotraceVectorizeResult> {
  try {
    const clean = base64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(clean, "base64");
    // 解码拿图像尺寸，用于把像素坐标系缩放到 0..100
    const { width, height } = PNG.sync.read(buffer);
    if (width < 1 || height < 1) return { path: "", ok: false };
    const path = await traceWithPotraceClass(buffer, options);
    if (!path || path.length <= 10) return { path: "", ok: false };
    const scaled = scalePathData(path, 100 / width, 100 / height);
    // clean line art 风格：所有子路径显式闭合 + 去重 + 丢碎片
    const cleaned = cleanLinePath(scaled);
    return { path: cleaned, ok: cleaned.length > 10 };
  } catch {
    return { path: "", ok: false };
  }
}

/**
 * 多轮廓版（兼容 rasterToSvgPathMulti 接口）。
 * Potrace 单次 trace 已经包含所有外轮廓 + 孔洞，这里统一包装为一条 outer path。
 * 上层 SVG 模板用 fill-rule=evenodd 实现镂空，无需区分 outer/hole。
 */
export async function potraceVectorizeMulti(base64: string, options?: PotraceOptions): Promise<{ contours: ContourInfo[] }> {
  const result = await potraceVectorize(base64, options);
  if (!result.ok) return { contours: [] };
  // Potrace 输出是单条复合 path，但内部可能有多个 M...Z 子路径
  // 按 M 分割，每段作为一个 contour
  const segments = result.path.split(/(?=M)/).filter(s => s.trim().length > 10);
  if (segments.length === 0) return { contours: [{ path: result.path, pointCount: 0, kind: "outer" }] };
  // 第一段作为 outer，后续默认 hole（Potrace 的绕向已区分，这里只是逻辑分类）
  return {
    contours: segments.map((seg, idx) => ({
      path: seg,
      pointCount: (seg.match(/[ML]/g) ?? []).length,
      kind: idx === 0 ? "outer" as const : "hole" as const,
    })),
  };
}

/**
 * callback 风格的 potrace.trace 简单封装（备用，输出完整 SVG 文档）。
 * 适合需要完整 SVG（含背景色、fill 色）的场景。
 */
export async function potraceTraceSvg(input: Buffer | string, options?: PotraceOptions): Promise<string> {
  const params: Record<string, unknown> = {
    turdSize: options?.turdSize ?? 2,
    optCurve: options?.optCurve ?? true,
    optTolerance: options?.optTolerance ?? 0.2,
    alphaMax: options?.alphaMax ?? 1,
    blackOnWhite: options?.blackOnWhite ?? true,
  };
  if (typeof options?.threshold === "number") params.threshold = options.threshold;
  return traceWithCallback(input, params);
}
