import { getDevice } from "../data/devices.ts";
import { hasOnlyClosedSubpaths } from "./silhouette.ts";
import type { DfmIssue, DfmReport } from "./types.ts";

export type HalftoneDot = { x: number; y: number; radius: number };
export type PhotoDesign = {
  widthMm: number;
  heightMm: number;
  sourceWidth: number;
  sourceHeight: number;
  dots: HalftoneDot[];
  cutStrokeMm: number;
  minFeatureMm: number;
};

/** 镂空版照片设计（用 Potrace 矢量化主体轮廓 + 内部孔洞）。 */
export type HollowPhotoDesign = {
  widthMm: number;
  heightMm: number;
  /** 兼容旧字段名：Potrace 填充雕刻复合 path（0..100，含外轮廓 + 内部孔洞） */
  cutPath: string;
  cutStrokeMm: number;
  minFeatureMm: number;
  /** 上游像素审计确认的内部有效孔洞数。 */
  holeCount?: number;
  foregroundRatio?: number;
};

type PixelData = { width: number; height: number; data: ArrayLike<number> };
const n = (value: number) => Number(value.toFixed(3));

export function createHalftoneDesign(image: PixelData, widthMm = 180, columns = 72): PhotoDesign {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data.length < image.width * image.height * 4) throw new Error("图像像素数据无效。");
  if (!Number.isFinite(widthMm) || widthMm < 80 || widthMm > 360) throw new Error("照片设计宽度必须在 80..360mm。");
  const cols = Math.max(24, Math.min(96, Math.floor(columns)));
  const rows = Math.max(1, Math.round(cols * image.height / image.width));
  const contentWidth = widthMm - 20;
  const cell = contentWidth / cols;
  const contentHeight = rows * cell;
  const heightMm = n(contentHeight + 20);
  const dots: HalftoneDot[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((col + 0.5) / cols * image.width));
      const sourceY = Math.min(image.height - 1, Math.floor((row + 0.5) / rows * image.height));
      const offset = (sourceY * image.width + sourceX) * 4;
      const alpha = Number(image.data[offset + 3]) / 255;
      const luminance = (Number(image.data[offset]) * 0.2126 + Number(image.data[offset + 1]) * 0.7152 + Number(image.data[offset + 2]) * 0.0722) / 255;
      const darkness = (1 - luminance) * alpha;
      if (darkness < 0.1) continue;
      const radius = Math.max(0.25, Math.min(cell * 0.44, cell * Math.sqrt(darkness) * 0.44));
      dots.push({ x: n(10 + (col + 0.5) * cell), y: n(10 + (row + 0.5) * cell), radius: n(radius) });
    }
  }
  return { widthMm, heightMm, sourceWidth: image.width, sourceHeight: image.height, dots, cutStrokeMm: 0.08, minFeatureMm: 0.5 };
}

export function checkPhotoDfm(design: PhotoDesign, deviceId = "falcon-10w"): DfmReport {
  const device = getDevice(deviceId);
  const issues: DfmIssue[] = [];
  if (!design.dots.length) issues.push({ code: "LINE_WIDTH", severity: "error", message: "照片没有产生可雕刻暗部，请换一张对比度更高的图片。" });
  if (design.cutStrokeMm > device.maxCutStrokeMm) issues.push({ code: "CUT_STROKE", severity: "error", message: `切割线宽超过 ${device.maxCutStrokeMm}mm。` });
  if (design.dots.some((dot) => dot.radius * 2 < device.minFeatureMm)) issues.push({ code: "LINE_WIDTH", severity: "error", message: `半调点直径小于 ${device.minFeatureMm}mm。` });
  if (device.bedWidthMm === null || device.bedHeightMm === null) issues.push({ code: "DEVICE_UNKNOWN", severity: "warning", message: `${device.name} 幅面待核验。` });
  else if (design.widthMm > device.bedWidthMm - device.safeMarginMm * 2 || design.heightMm > device.bedHeightMm - device.safeMarginMm * 2) issues.push({ code: "ENVELOPE", severity: "error", message: "照片设计超出设备安全包络。" });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { passed: errors === 0, issues, checks: 4, summary: errors ? `发现 ${errors} 项照片制造问题` : `4 项照片 DFM 检查通过${issues.length ? "，设备幅面待确认" : ""}` };
}

export function generatePhotoSvg(design: PhotoDesign): string {
  const metadata = JSON.stringify(design).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${design.widthMm}mm" height="${design.heightMm}mm" viewBox="0 0 ${design.widthMm} ${design.heightMm}" data-units="mm">\n  <title>Shike photo halftone</title>\n  <metadata id="shike-photo-design">${metadata}</metadata>\n  <g id="cut-through" fill="none" stroke="#ff0000" stroke-width="${design.cutStrokeMm}"><rect x="0.04" y="0.04" width="${n(design.widthMm - 0.08)}" height="${n(design.heightMm - 0.08)}" rx="4"/></g>\n  <g id="vector-score" fill="none" stroke="#0000ff" stroke-width="0.5"/>\n  <g id="engraving" fill="#000000" stroke="none">${design.dots.map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.radius}"/>`).join("")}</g>\n</svg>`;
}

/** 镂空版照片 DFM 检查：验证轮廓非空、闭合和画布包络。 */
export function checkHollowPhotoDfm(design: HollowPhotoDesign, deviceId = "falcon-10w"): DfmReport {
  const device = getDevice(deviceId);
  const issues: DfmIssue[] = [];
  if (!design.cutPath || design.cutPath.length < 10) issues.push({ code: "LINE_WIDTH", severity: "error", message: "图片未产生可制造轮廓，请换一张主体清晰的图片。" });
  else if (!hasOnlyClosedSubpaths(design.cutPath)) issues.push({ code: "OPEN_PATH", severity: "error", message: "照片轮廓未闭合，无法可靠执行填充雕刻。" });
  if (design.holeCount === 0) issues.push({ code: "NO_HOLES", severity: "error", message: "主体内没有检测到有效镂空孔洞，请换一张结构更清晰的图片。" });
  if (typeof design.foregroundRatio === "number" && (design.foregroundRatio < 0.03 || design.foregroundRatio > 0.85)) issues.push({ code: "SUBJECT_COVERAGE", severity: "error", message: "主体占比异常，请换一张主体完整且背景简洁的图片。" });
  if (design.cutStrokeMm > device.maxCutStrokeMm) issues.push({ code: "CUT_STROKE", severity: "error", message: `切割线宽超过 ${device.maxCutStrokeMm}mm。` });
  if (device.bedWidthMm === null || device.bedHeightMm === null) issues.push({ code: "DEVICE_UNKNOWN", severity: "warning", message: `${device.name} 幅面待核验。` });
  else if (design.widthMm > device.bedWidthMm - device.safeMarginMm * 2 || design.heightMm > device.bedHeightMm - device.safeMarginMm * 2) issues.push({ code: "ENVELOPE", severity: "error", message: "照片设计超出设备安全包络。" });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { passed: errors === 0, issues, checks: 4, summary: errors ? `发现 ${errors} 项照片制造问题` : `4 项照片 DFM 检查通过${issues.length ? "，设备幅面待确认" : ""}` };
}

/**
 * 生成照片镂空版 SVG，与城市剪影入口使用同一套雕刻语义。
 *
 * 设计原则：
 *   - Potrace 复合轮廓按 evenodd 黑色填充输出
 *   - 主体外轮廓和内部孔洞必须是闭合子路径
 *   - 物理尺寸 180×120mm
 *
 * 两层结构：
 *   <g id="cut-through" stroke="#ff0000" stroke-width=0.08>  外边框（红色，切穿）
 *   <g id="engraving-fill" fill="#000000">                  主体 + 镂空孔洞（黑色，填充雕刻）
 */
export function generateHollowPhotoSvg(design: HollowPhotoDesign): string {
  const metadata = JSON.stringify({
    widthMm: design.widthMm,
    heightMm: design.heightMm,
    minFeatureMm: design.minFeatureMm,
    style: "laser-vector",
  }).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  // 复合 path 为 0..100；四周至少留 6mm，避免雕刻内容与切穿外框重叠。
  const scale = Math.min((design.widthMm - 12) / 100, (design.heightMm - 12) / 100);
  const offsetX = (design.widthMm - 100 * scale) / 2;
  const offsetY = (design.heightMm - 100 * scale) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(design.widthMm)}mm" height="${n(design.heightMm)}mm" viewBox="0 0 ${n(design.widthMm)} ${n(design.heightMm)}" data-units="mm">
  <title>Shike photo engraving</title>
  <metadata id="shike-hollow-photo-design">${metadata}</metadata>
  <g id="cut-through" fill="none" stroke="#ff0000" stroke-width="${design.cutStrokeMm}" stroke-linecap="round" stroke-linejoin="round">
    <rect x="0.04" y="0.04" width="${n(design.widthMm - 0.08)}" height="${n(design.heightMm - 0.08)}" rx="6" fill="none"/>
    <circle cx="6" cy="6" r="1" fill="none"/>
    <circle cx="${n(design.widthMm - 6)}" cy="6" r="1" fill="none"/>
    <circle cx="6" cy="${n(design.heightMm - 6)}" r="1" fill="none"/>
    <circle cx="${n(design.widthMm - 6)}" cy="${n(design.heightMm - 6)}" r="1" fill="none"/>
  </g>
  <g id="engraving-fill" fill="#000000" fill-rule="evenodd" stroke="none">
    <g transform="translate(${n(offsetX)} ${n(offsetY)}) scale(${n(scale)})"><path d="${design.cutPath}"/></g>
  </g>
</svg>`;
}
