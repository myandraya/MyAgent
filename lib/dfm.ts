import { getDevice } from "../data/devices.ts";
import { MATERIAL_DFM, type LaserMaterial } from "../data/materials.ts";
import type { DfmIssue, DfmReport, StarDesign } from "./types.ts";

export function checkDfm(design: StarDesign, deviceId = "falcon-10w", materialId:LaserMaterial="basswood"): DfmReport {
  const device = getDevice(deviceId);
  const material=MATERIAL_DFM[materialId];
  const minHoleMm=Math.max(device.minHoleMm,material.minHoleMm);
  const minSpacingMm=Math.max(device.minSpacingMm,material.minSpacingMm);
  const minFeatureMm=Math.max(device.minFeatureMm,material.minFeatureMm);
  const issues: DfmIssue[] = [];
  if (device.bedWidthMm === null || device.bedHeightMm === null) {
    issues.push({ code: "DEVICE_UNKNOWN", severity: "warning", message: `${device.name} 缺少已核验幅面，未声明包络通过。` });
  } else {
    const maximum = Math.min(device.bedWidthMm, device.bedHeightMm) - device.safeMarginMm * 2;
    if (design.sizeMm > maximum) issues.push({ code: "ENVELOPE", severity: "error", message: `${design.sizeMm}mm 超出 ${device.name} 的 ${maximum}mm 安全包络。` });
  }
  if (design.cutStrokeMm > device.maxCutStrokeMm) issues.push({ code: "CUT_STROKE", severity: "error", message: `切割线宽 ${design.cutStrokeMm}mm 大于 ${device.maxCutStrokeMm}mm。` });
  if (design.vectorStrokeMm < minFeatureMm) issues.push({ code: "LINE_WIDTH", severity: "error", message: `${material.name}矢量线宽 ${design.vectorStrokeMm}mm 小于 ${minFeatureMm}mm。` });

  for (const star of design.stars) {
    if (star.radius * 2 < minHoleMm) issues.push({ code: "HOLE_SIZE", severity: "error", message: `${star.name} 孔径小于 ${minHoleMm}mm。`, starIds: [star.id] });
  }
  for (let first = 0; first < design.stars.length; first += 1) {
    for (let second = first + 1; second < design.stars.length; second += 1) {
      const a = design.stars[first];
      const b = design.stars[second];
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
      if (gap < minSpacingMm) issues.push({ code: "HOLE_SPACING", severity: "error", message: `${a.name} 与 ${b.name} 净距 ${gap.toFixed(2)}mm，小于 ${minSpacingMm}mm。`, starIds: [a.id, b.id] });
    }
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { passed: errors === 0, issues, checks: 6, summary: errors === 0 ? `6 项确定性检查通过${issues.length ? "，有 1 项待确认" : ""}` : `发现 ${errors} 项制造问题` };
}

export function checkSvg(svg: string, deviceId = "falcon-10w"): DfmReport {
  if (typeof svg !== "string" || svg.length === 0 || svg.length > 2_000_000) throw new Error("SVG 必须是 1..2,000,000 字符的文本。");
  const metadata = svg.match(/<metadata id="shike-design">([\s\S]*?)<\/metadata>/)?.[1]
    .replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
  if (!metadata) throw new Error("不是拾刻生成的 SVG：缺少可审计设计元数据。");
  let design: StarDesign;
  try { design = JSON.parse(metadata) as StarDesign; } catch { throw new Error("SVG 设计元数据损坏。"); }
  return checkDfm(design, deviceId);
}
