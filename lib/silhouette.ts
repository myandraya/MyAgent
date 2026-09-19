import { resolveCity } from "../data/cities.ts";
import { generateFallbackSilhouette } from "./silhouette-generators.ts";
import type { City, DfmReport } from "./types.ts";

export type SilhouetteDesign = {
  city: City;
  date: string;
  sizeMm: number;
  /** 切穿层 path（红色外边框 0.08mm）：画布外框 + 对位孔 */
  cutPaths: string[];
  /** 划线层 path（蓝色 0.5mm）：辅助线、地标框（保留兼容） */
  scorePaths: string[];
  /** 描线雕刻层 path（黑色 0.2mm）：主体外轮廓 + 窗户/塔楼等结构线 */
  engravePaths: string[];
  /** 填充雕刻层 path：Potrace 复合轮廓，必须由闭合子路径组成 */
  fillPaths: string[];
  /** 兼容旧字段：所有 path 合并 */
  paths: string[];
  landmarkNames: string[];
  cutStrokeMm: number;
  minFeatureMm: number;
};

/**
 * 用外部已生成的分层 path 构造剪影设计。
 * cityInput 可以是任意城市名（不再限制白名单）。
 * 接受新版分层 {cutPaths, scorePaths, engravePaths, fillPaths}，
 * 也兼容旧版 {paths} 单数组（统一进入 engrave 层）。
 */
export function composeSilhouetteSelection(
  cityInput: string,
  landmarkNames: string[] = [],
  date = "2023-06-01",
  paths: string[] = [],
  layered?: { cutPaths?: string[]; scorePaths?: string[]; engravePaths?: string[]; fillPaths?: string[] },
): SilhouetteDesign {
  const city = resolveCity(cityInput);
  const cutPaths = layered?.cutPaths ?? [];
  const scorePaths = layered?.scorePaths ?? [];
  const engravePaths = layered?.engravePaths ?? (paths.length ? paths : []);
  const fillPaths = layered?.fillPaths ?? [];
  return {
    city,
    date,
    sizeMm: 300,
    cutPaths,
    scorePaths,
    engravePaths,
    fillPaths,
    paths: [...cutPaths, ...scorePaths, ...engravePaths, ...fillPaths],
    landmarkNames,
    cutStrokeMm: 0.08,
    minFeatureMm: 0.6,
  };
}

/**
 * 离线兜底：从城市名 + 地标名用参数化生成器产生镂空天际线。
 * 任意城市均可生成，不再依赖白名单模板。
 */
export function composeSilhouette(prompt: string, date = "2023-06-01"): SilhouetteDesign {
  const text = prompt.trim();
  if (!text || text.length > 160) throw new Error("请用 1..160 个字符描述城市记忆。");

  // 尝试从 prompt 提取城市名和地标名（简单启发式：中文城市常见后缀 / 英文大写词）。
  const cityMatch = text.match(/([\u4e00-\u9fff]{2,}(?:市|城|镇)?)|([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  const cityName = (cityMatch?.[1] || cityMatch?.[2] || text.slice(0, 12)).trim();
  const landmark = text.replace(cityMatch?.[0] ?? "", "").replace(/[\s,，。.!！?？]/g, "").slice(0, 12) || cityName;

  const fallback = generateFallbackSilhouette(cityName, landmark);
  return composeSilhouetteSelection(
    cityName,
    fallback.landmarkNames,
    date,
    fallback.paths,
    { cutPaths: fallback.cutPaths, scorePaths: fallback.scorePaths, engravePaths: fallback.engravePaths, fillPaths: fallback.fillPaths },
  );
}

/** SVG 中只有以 Z/z 结束的每个子路径才是真正闭合的环。 */
export function hasOnlyClosedSubpaths(pathData: string): boolean {
  const subpaths = pathData.trim().split(/(?=[Mm])/).map((part) => part.trim()).filter(Boolean);
  return subpaths.length > 0 && subpaths.every((part) => /^[Mm]/.test(part) && /[Zz]\s*$/.test(part));
}

export function checkSilhouetteDfm(design: SilhouetteDesign): DfmReport {
  const issues: DfmReport["issues"] = [];
  if (!design.paths.length) {
    issues.push({ code: "LINE_WIDTH", severity: "error", message: "没有可制造的地标路径。" });
  }
  const closedShapePaths = [...design.cutPaths, ...design.engravePaths, ...design.fillPaths];
  if (closedShapePaths.some((path) => !hasOnlyClosedSubpaths(path))) {
    issues.push({ code: "OPEN_PATH", severity: "error", message: "存在未闭合轮廓，无法可靠执行填充雕刻或切割。" });
  }
  return { passed: issues.length === 0, issues, checks: 5, summary: issues.length ? "城市剪影不完整" : "5 项剪影 DFM 检查通过" };
}

/**
 * 生成激光雕刻 SVG。
 *
 * 设计原则：
 *   - Potrace 轮廓按闭合填充区域输出，供雕刻软件的 Fill/Engrave 模式识别
 *   - 参数化结构线按描边输出，供 Line/Score 模式识别
 *   - 切穿轮廓保持独立红色图层
 *   - 物理尺寸 180×120mm
 *
 * 三种工艺语义：
 *   <g id="cut-through" stroke="#ff0000" stroke-width=0.08>  外边框（红色，切穿）
 *   <g id="engraving-fill" fill="#000000">                   闭合轮廓（黑色，填充雕刻）
 *   <g id="engraving-line" stroke="#000000">                 结构线（黑色，描线雕刻）
 *
 * 注：原 scorePaths 兼容字段不再单独成层，并入 engraving 保持视觉一致。
 */
export function generateSilhouetteSvg(design: SilhouetteDesign): string {
  const metadata = JSON.stringify({
    city: design.city.slug,
    date: design.date,
    landmarkNames: design.landmarkNames,
    minFeatureMm: design.minFeatureMm,
    style: "laser-vector",
    layers: { cut: design.cutPaths.length, fill: design.fillPaths.length, line: design.engravePaths.length + design.scorePaths.length },
  }).replaceAll("&", "&amp;").replaceAll("<", "&lt;");

  // 坐标 0..100 → 180×120mm；四周保留 6mm，x/y 分别缩放，避免旧版 1.8 倍纵向裁切。
  const transform = "translate(6 6) scale(1.68 1.08)";
  const cutXml = design.cutPaths.map((p) => `<path d="${p}" fill="none"/>`).join("");
  const lineXml = [...design.engravePaths, ...design.scorePaths].map((p) => `<path d="${p}" fill="none"/>`).join("");
  const fillXml = design.fillPaths.map((p) => `<path d="${p}"/>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="120mm" viewBox="0 0 180 120" data-units="mm">
  <title>Shike ${design.city.nameEn} line art</title>
  <metadata id="shike-silhouette-design">${metadata}</metadata>
  <g id="cut-through" fill="none" stroke="#ff0000" stroke-width="${design.cutStrokeMm}" stroke-linecap="round" stroke-linejoin="round">
    <rect x="0.04" y="0.04" width="179.92" height="119.92" rx="6" fill="none"/>
    <circle cx="6" cy="6" r="1" fill="none"/>
    <circle cx="174" cy="6" r="1" fill="none"/>
    <circle cx="6" cy="114" r="1" fill="none"/>
    <circle cx="174" cy="114" r="1" fill="none"/>
    ${cutXml ? `<g transform="${transform}">${cutXml}</g>` : ""}
  </g>
  <g id="engraving">
    ${fillXml ? `<g id="engraving-fill" fill="#000000" fill-rule="evenodd" stroke="none">
      <g transform="${transform}">${fillXml}</g>
    </g>` : ""}
    <g id="engraving-line" fill="none" stroke="#000000" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round">
      <g transform="${transform}">${lineXml}</g>
    </g>
  </g>
</svg>`;
}
