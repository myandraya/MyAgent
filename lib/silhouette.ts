import { resolveCity } from "../data/cities.ts";
import { getDevice } from "../data/devices.ts";
import { analyzeMaterialConnectivity, type MaterialElement } from "./material-topology.ts";
import { pathDataToRings, unionMaterials, polygonsToPathData } from "./material-merge.ts";
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
  /** 城市英文名雕刻文字（服务端已定位好的完整 SVG <g> 片段，含 fill-rule=evenodd）；空串表示无城市名 */
  cityNameXml?: string;
  /** 城市英文名原始文本（用于元数据/无障碍） */
  cityNameText?: string;
  /**
   * 城市名字形轮廓的 path 数据（fill 语义，基线原点、正 y 向上），
   * 与 cityNameXml 内 <path d="..."> 相同。用于把字形纳入材料布尔合并（§7.2）。
   * 空串表示无城市名或无字形数据。
   */
  cityNamePath?: string;
  /**
   * 城市名布局数值（服务端用字体度量算好，前端只用数值定位，避免前端引入字体依赖）：
   * glyphTopY 用于把地平线底沿对齐字母顶部；x/baselineY 与 cityNameXml 内的 transform 一致。
   */
  cityNameLayout?: { x: number; baselineY: number; glyphTopY: number };
  /** 圆角矩形实心相框（框住建筑+城市名）；false 表示不画相框 */
  frame?: { enabled: boolean; thicknessMm: number; radiusMm: number };
  /** 排版方向：portrait 竖幅 120×180（默认）/ landscape 横幅 180×120 */
  orientation?: "portrait" | "landscape";
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
  layered?: { cutPaths?: string[]; scorePaths?: string[]; engravePaths?: string[]; fillPaths?: string[]; cityNameXml?: string; cityNameText?: string; cityNamePath?: string; cityNameLayout?: { x: number; baselineY: number; glyphTopY: number }; orientation?: "portrait" | "landscape" },
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
    cityNameXml: layered?.cityNameXml,
    cityNameText: layered?.cityNameText,
    cityNamePath: layered?.cityNamePath,
    cityNameLayout: layered?.cityNameLayout,
    frame: { enabled: true, thicknessMm: 3, radiusMm: 0 },
    orientation: layered?.orientation ?? "portrait",
  };
}

/** SVG 中只有以 Z/z 结束的每个子路径才是真正闭合的环。 */
export function hasOnlyClosedSubpaths(pathData: string): boolean {
  const subpaths = pathData.trim().split(/(?=[Mm])/).map((part) => part.trim()).filter(Boolean);
  return subpaths.length > 0 && subpaths.every((part) => /^[Mm]/.test(part) && /[Zz]\s*$/.test(part));
}

/**
 * 提取 path 数据中的所有数值，并校验其合法性。
 * 拒绝 NaN、Infinity、以及超出激光雕刻坐标系的越界坐标（负半径、超大幅面坐标等）。
 * 这是「输出可雕刻」的第一道硬门槛：几何值本身必须有限且落在合理区间。
 */
export function extractPathNumbers(pathData: string): number[] | null {
  const tokens = pathData.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;
  const numbers = tokens.map(Number);
  // 任何非法数字都意味着几何损坏，整体判失败。
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return numbers;
}

/**
 * 检查 path 数据里是否残留「非命令、非数字」的异常 token。
 * 正常 path 只含命令字母（MLHVCSQTAZmlhvcsqtaz）与数字/分隔符；
 * 一旦出现 NaN / Infinity / undefined / null 等字样，说明上游注入了损坏值。
 */
function hasJunkToken(pathData: string): boolean {
  // 移除所有合法命令字母、数字、小数点、正负号、科学计数、分隔符后，若仍有字母残留即为异常。
  const residue = pathData
    .replace(/[MLHVCSQTAZmlhvcsqtaz]/g, "")
    .replace(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, "")
    .replace(/[\s,]/g, "");
  return residue.length > 0;
}

/** 单个 path 数据是否几何合法（数字有限、无非有限值、坐标不越界、无异常 token）。 */
export function isFinitePathData(pathData: string): boolean {
  if (hasJunkToken(pathData)) return false;
  const numbers = extractPathNumbers(pathData);
  if (!numbers) return false;
  // 坐标应落在 0..100 的归一化设计空间（兜底生成器即 0..100）；允许少量负余量用于曲线控制点。
  const MAX_ABS = 1e4;
  return numbers.every((n) => Math.abs(n) <= MAX_ABS);
}

/** 估算 path 的包围盒（0..100 归一化空间），用于最小特征与覆盖校验。 */
function pathBounds(pathData: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const numbers = extractPathNumbers(pathData);
  if (!numbers) return null;
  // path 命令交替出现「命令字母 + 坐标对」，这里简单取所有数值（含控制点）作为包围盒上界。
  const xs: number[] = [];
  const ys: number[] = [];
  // 粗略解析：剔除命令字母后，偶数位为 x，奇数位为 y（近似，对 M/L/H/V/A 的混合序列已足够做阈值判断）。
  const cleaned = pathData.replace(/[A-Za-z]/g, " ").split(/[\s,]+/).filter(Boolean).map(Number);
  for (let i = 0; i < cleaned.length; i += 2) {
    const x = cleaned[i];
    const y = cleaned[i + 1];
    if (Number.isFinite(x)) xs.push(x);
    if (Number.isFinite(y)) ys.push(y);
  }
  if (xs.length === 0) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function checkSilhouetteDfm(design: SilhouetteDesign, deviceId = "falcon-10w"): DfmReport {
  const device = getDevice(deviceId);
  const issues: DfmReport["issues"] = [];

  // 1. 必须存在可制造内容。
  if (!design.paths.length) {
    issues.push({ code: "LINE_WIDTH", severity: "error", message: "没有可制造的地标路径。" });
  }

  // 2. 几何合法性：所有 path 数据必须有限且不越界。
  if (design.paths.some((path) => !isFinitePathData(path))) {
    issues.push({ code: "LINE_WIDTH", severity: "error", message: "检测到非法的路径坐标（NaN/Infinity 或越界），输出不可雕刻。" });
  }

  // 3. 闭合性：切穿/填充/雕刻轮廓必须是闭合环，否则无法可靠切割或填充。
  const closedShapePaths = [...design.cutPaths, ...design.engravePaths, ...design.fillPaths];
  if (closedShapePaths.some((path) => !hasOnlyClosedSubpaths(path))) {
    issues.push({ code: "OPEN_PATH", severity: "error", message: "存在未闭合轮廓，无法可靠执行填充雕刻或切割。" });
  }

  // 4. 切穿层线宽不得超过设备最大切割线宽。
  if (design.cutPaths.length && design.cutStrokeMm > device.maxCutStrokeMm) {
    issues.push({ code: "CUT_STROKE", severity: "error", message: `切割线宽 ${design.cutStrokeMm}mm 超过设备 ${device.maxCutStrokeMm}mm。` });
  }

  // 5. 最小特征尺寸：雕刻/填充层细节不得小于设备可雕刻的最小特征。
  const featurePaths = [...design.engravePaths, ...design.fillPaths];
  for (const path of featurePaths) {
    const bounds = pathBounds(path);
    if (!bounds) continue;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    // 归一化 0..100 映射到 120mm 宽（竖版）：1 单位 ≈ 1.2mm。minFeatureMm 换算回设计空间阈值。
    const minFeatureUnits = device.minFeatureMm / 1.2;
    if ((w < minFeatureUnits || h < minFeatureUnits) && (w > 0 || h > 0)) {
      issues.push({ code: "LINE_WIDTH", severity: "warning", message: "存在小于设备最小特征尺寸的细节，可能雕刻不清晰。" });
      break; // 只报一次，避免刷屏
    }
  }

  // 6. 设备包络：物理尺寸不得超出设备安全包络。
  const geo = canvasGeometry(design.orientation ?? "portrait");
  const widthMm = geo.width;
  const heightMm = geo.height;
  if (device.bedWidthMm === null || device.bedHeightMm === null) {
    issues.push({ code: "DEVICE_UNKNOWN", severity: "warning", message: `${device.name} 幅面待核验。` });
  } else if (widthMm > device.bedWidthMm - device.safeMarginMm * 2 || heightMm > device.bedHeightMm - device.safeMarginMm * 2) {
    issues.push({ code: "ENVELOPE", severity: "error", message: "设计超出设备安全包络。" });
  }

  // 7. 材料连通性：相框/横条/建筑是否连成一体（孤岛/弱接触检测）。
  //    仅当存在填充/描线内容且启用相框时才检查（避免空设计误报）。
  const hasContent = design.fillPaths.length > 0 || design.engravePaths.length > 0 || design.scorePaths.length > 0;
  if (hasContent) {
    const connectivity = checkMaterialConnectivity(design);
    if (connectivity.hasIsland) {
      issues.push({ code: "ISOLATED_MATERIAL", severity: "error", message: "存在未连接的分离材料块（孤岛），切割后会散架。请加连接桥或调整布局。" });
    } else if (connectivity.hasWeakContact) {
      issues.push({ code: "ISOLATED_MATERIAL", severity: "warning", message: "材料之间存在点接触/切线接触，连接可能不可靠。建议加宽连接桥。" });
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const checks = 7;
  return {
    passed: errors === 0,
    issues,
    checks,
    summary: errors ? `发现 ${errors} 项剪影制造问题` : `${checks} 项剪影 DFM 检查通过${issues.length ? "，有非阻断提示" : ""}`,
  };
}

/**
 * 服务端强制 gate：输出下发前必须通过 DFM 硬校验，否则判定不可用。
 * 返回通过与否；调用方在「不合格」时应降级到参数化兜底而非直接下发。
 */
export function validateSceneDesign(design: SilhouetteDesign, deviceId = "falcon-10w"): boolean {
  if (!design.paths.length) return false;
  if (design.paths.some((path) => !isFinitePathData(path))) return false;
  const closedShapePaths = [...design.cutPaths, ...design.engravePaths, ...design.fillPaths];
  if (closedShapePaths.some((path) => !hasOnlyClosedSubpaths(path))) return false;
  const report = checkSilhouetteDfm(design, deviceId);
  return report.passed;
}

/**
 * 计算「保留材料元素」在毫米画布上的布局（与 generateSilhouetteSvg 使用同一套数值），
 * 供材料连通性检查与布尔合并使用。返回每个元素的 pathData + transform。
 *
 * 元素包括：相框、地平线横条、建筑（填充层 + 描线层）、城市名字形（若有 cityNamePath）。
 */
export function computeMaterialElements(design: SilhouetteDesign): MaterialElement[] {
  const elements: MaterialElement[] = [];
  const frame = design.frame;
  const frameEnabled = Boolean(frame?.enabled);
  const orientation = design.orientation ?? "portrait";
  const geo = canvasGeometry(orientation);
  const groundHeight = 3;
  const nameOverlap = 1.2;
  // 建筑底部伸进横条的重叠量（mm）：只「坐在」横条顶面是线接触，雕刻/合并后仍会断开；
  // 必须把建筑底部压进横条内部形成真实面积重叠，才能与横条焊成一体。
  const buildingOverlap = 1.2;
  const groundTop = design.cityNameLayout
    ? Math.max(40, Math.round((design.cityNameLayout.glyphTopY + nameOverlap - groundHeight) * 100) / 100)
    : design.cityNameXml ? 120 : 130;

  // 相框（毫米坐标，scale=1，translate=0）
  if (frameEnabled) {
    const thickness = frame?.thicknessMm ?? 3;
    const radius = frame?.radiusMm ?? 0;
    elements.push({ pathData: buildFramePathData(geo.outerX, geo.outerY, geo.outerW, geo.outerH, thickness, radius), scaleMm: 1, translateX: 0, translateY: 0 });
  }

  // 地平线横条（毫米坐标）
  if (frameEnabled) {
    elements.push({ pathData: `M${geo.innerX} ${groundTop} H${geo.innerRight} V${groundTop + groundHeight} H${geo.innerX} Z`, scaleMm: 1, translateX: 0, translateY: 0 });
  }

  // 建筑（设计空间 0..100，需等比缩放到毫米画布）
  const contentPaths = [...design.fillPaths, ...design.engravePaths, ...design.scorePaths];
  if (contentPaths.length) {
    const contentBounds = contentPaths
      .map((p) => pathBounds(p))
      .reduce<{ minX: number; minY: number; maxX: number; maxY: number } | null>(
        (acc, b) => (b && acc
          ? { minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY), maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY) }
          : (acc ?? b)),
        null,
      );
    if (contentBounds && contentBounds.maxX > contentBounds.minX && contentBounds.maxY > contentBounds.minY) {
      const topGapMm = 8;
      const topInner = geo.innerY;
      const availW = geo.innerRight - geo.innerX;
      const availH = groundTop - topInner - topGapMm;
      const boxScaleX = availW / (contentBounds.maxX - contentBounds.minX);
      const boxScaleY = availH / (contentBounds.maxY - contentBounds.minY);
      const scale = Math.min(boxScaleX, boxScaleY);
      const translateX = topInner + (availW - (contentBounds.maxX - contentBounds.minX) * scale) / 2 - contentBounds.minX * scale;
      // 底部压线：maxY 映射到 groundTop + buildingOverlap，让建筑底部伸进横条内部咬合。
      const translateY = groundTop + buildingOverlap - contentBounds.maxY * scale;
      for (const p of contentPaths) {
        // 建筑 path 在 0..100 设计空间；scaleMm 把「设计单位」换算成毫米。
        // 设计空间 0..100 宽 → 画布 availW mm，故 1 设计单位 = scale mm。
        elements.push({ pathData: p, scaleMm: scale, translateX, translateY });
      }
    }
  }

  // 城市名字形：path 是「基线原点、y 向下为正」的字形轮廓（与 cityNameXml 内 path 相同，
  // opentype getPath 输出的坐标已是 SVG 用户单位：ascender 为负 y、基线为 0、descender 为正 y）。
  // buildCityNameXml 用 translate(x, baselineY) 直接放置（无需翻转），故此处 scaleX=scaleY=1。
  // 字形作为「材料元素」仅用于连通性检查（§7.3 判断字母是否与横条/相框接触），
  // 但不参与布尔合并（isGlyph=true）：带孔多边并集在边缘擦碰时拓扑不稳定，会整段丢字母。
  if (design.cityNamePath && design.cityNameLayout) {
    const { x, baselineY } = design.cityNameLayout;
    elements.push({ pathData: design.cityNamePath, scaleX: 1, scaleY: 1, translateX: x, translateY: baselineY, isGlyph: true });
  }

  return elements;
}

/**
 * 检查「保留材料」是否连成一体（对齐 §7.3 材料连通性）。
 * 返回是否有孤岛 / 弱接触；供 checkSilhouetteDfm 作为第 7 项检查调用。
 */
export function checkMaterialConnectivity(design: SilhouetteDesign): { hasIsland: boolean; hasWeakContact: boolean; componentCount: number } {
  const elements = computeMaterialElements(design);
  const geo = canvasGeometry(design.orientation ?? "portrait");
  const result = analyzeMaterialConnectivity(elements, geo.width, geo.height, 240);
  return { hasIsland: result.hasIsland, hasWeakContact: result.hasWeakContact, componentCount: result.componentCount };
}

/**
 * 材料布尔合并（对齐 §7.2）：把相框、横条、建筑（填充层）真正「焊接」成一个实心整体，
 * 返回唯一的外轮廓 + 内孔的 path 数据（内部重叠边全部消失）。
 *
 * 注意：
 *   - 只合并「可解析为折线多边形」的元素（相框、横条、fillPaths 建筑）。
 *   - 描线层（engravePaths）是结构线而非实体材料，不参与布尔合并（保留为描边）。
 *   - 城市名字形（isGlyph）不参与布尔合并：带孔多边并集在边缘擦碰时拓扑不稳定，
 *     会把字母整段丢失（只剩残骸）。字形改回独立 <g> 叠放渲染（见 generateSilhouetteSvg），
 *     其与横条/相框的物理咬合靠坐标重叠（glyphTopY 顶进横条、底部压框）实现，无需 union。
 *
 * 返回合并后的 path 数据；若无可合并材料或合并失败，返回空串（调用方回退到叠放渲染）。
 */
export function computeMergedMaterial(design: SilhouetteDesign): string {
  const elements = computeMaterialElements(design).filter((el) => !el.isGlyph);
  if (!elements.length) return "";

  // 每个元素：pathData → 折线环 → 变换到画布毫米坐标 → GeoJSON 多边形。
  const polygons = elements.map((el) => {
    const rings = pathDataToRings(el.pathData);
    const sx = el.scaleX ?? el.scaleMm ?? 1;
    const sy = el.scaleY ?? el.scaleMm ?? 1;
    // 变换到画布坐标：设计空间 * scale + translate（scaleY 可为负，用于字形 Y 翻转）。
    const transformed = rings.map((ring) =>
      ring.map(([x, y]) => [x * sx + el.translateX, y * sy + el.translateY] as [number, number]),
    );
    return transformed;
  });

  try {
    const merged = unionMaterials(polygons);
    return polygonsToPathData(merged);
  } catch {
    // 布尔合并异常（退化几何/数值问题）时回退为空，调用方保持叠放渲染。
    return "";
  }
}

/**
 * 画布几何（按方向统一取，供各处布局/连通性/DFM 使用）。
 * portrait：120×180（竖幅）；landscape：180×120（横幅）。
 * 相框外沿统一四周留 6mm 边距、厚度 3mm。
 */
export function canvasGeometry(orientation: "portrait" | "landscape" = "portrait") {
  const width = orientation === "landscape" ? 180 : 120;
  const height = orientation === "landscape" ? 120 : 180;
  const margin = 6;       // 外沿到画布边
  const thickness = 3;    // 相框厚度
  const outerX = margin, outerY = margin;
  const outerW = width - margin * 2, outerH = height - margin * 2;
  const innerX = outerX + thickness, innerY = outerY + thickness;
  const innerW = outerW - thickness * 2, innerH = outerH - thickness * 2;
  const innerRight = innerX + innerW;   // 内沿右（竖幅 111 / 横幅 165）
  const innerBottom = innerY + innerH;  // 内沿底（竖幅 171 / 横幅 105）
  return { width, height, margin, thickness, outerX, outerY, outerW, outerH, innerX, innerY, innerW, innerH, innerRight, innerBottom };
}

/**
 * 生成「圆角矩形实心相框」的 path 数据（填充雕刻层，配合 fill-rule=evenodd 镂空内芯）。
 *
 * 外圆角矩形（顺时针）套一个内圆角矩形（逆时针），evenodd 规则下两环之间形成
 * 一圈实心边框，内芯镂空——即「实心相框」。坐标单位 = 画布 mm（120×180 竖版）。
 *
 * @param x/y       相框左上角（mm）
 * @param width/height 相框外尺寸（mm）
 * @param thickness 边框厚度（mm）
 * @param radius    外圆角半径（mm）；内圆角半径 = max(0, radius - thickness)
 */
export function buildFramePathData(x: number, y: number, width: number, height: number, thickness: number, radius: number): string {
  const r = Math.max(0, radius);
  const innerR = Math.max(0, radius - thickness);
  const ix = x + thickness;
  const iy = y + thickness;
  const iw = Math.max(0, width - thickness * 2);
  const ih = Math.max(0, height - thickness * 2);
  const roundRect = (cx: number, cy: number, w: number, h: number, rr: number) =>
    `M${cx + rr} ${cy} H${cx + w - rr} Q${cx + w} ${cy} ${cx + w} ${cy + rr} V${cy + h - rr} Q${cx + w} ${cy + h} ${cx + w - rr} ${cy + h} H${cx + rr} Q${cx} ${cy + h} ${cx} ${cy + h - rr} V${cy + rr} Q${cx} ${cy} ${cx + rr} ${cy} Z`;
  // 外环顺时针 + 内环（同一顺时针，但嵌套时 evenodd 依然能正确镂空，因为奇偶规则只数包围次数）。
  const outer = roundRect(x, y, width, height, r);
  const inner = roundRect(ix, iy, iw, ih, innerR);
  return `${outer} ${inner}`;
}

/**
 * 生成激光雕刻 SVG。
 *
 * 设计原则：
 *   - Potrace 轮廓按闭合填充区域输出，供雕刻软件的 Fill/Engrave 模式识别
 *   - 参数化结构线按描边输出，供 Line/Score 模式识别
 *   - 物理尺寸 180×120mm
 *
 * 三种工艺语义（对齐 MakerMuse 子应用规范：切穿层为黑色，无红色标注）：
 *   <g id="cut-layer" stroke="#000000">                      主体外轮廓（黑色，切穿，可选）
 *   <g id="engrave-layer" fill="#000000">                    闭合轮廓（黑色，填充雕刻）
 *   <g id="engraving-line" stroke="#000000">                 结构线（黑色，描线雕刻）
 *
 * 注1：原 scorePaths 兼容字段不再单独成层，并入 engraving 保持视觉一致。
 * 注2：不再绘制固定的红色外框 rect 与四角对位孔 circle —— 用户要求彻底去掉
 *      这圈红线，只保留剪影主体（黑色填充 + 结构线）。
 */
export function generateSilhouetteSvg(design: SilhouetteDesign): string {
  const metadata = JSON.stringify({
    city: design.city.slug,
    date: design.date,
    landmarkNames: design.landmarkNames,
    minFeatureMm: design.minFeatureMm,
    style: "laser-vector",
    layers: { cut: design.cutPaths.length, fill: design.fillPaths.length, line: design.engravePaths.length + design.scorePaths.length },
    cityNameText: design.cityNameText ?? "",
  }).replaceAll("&", "&amp;").replaceAll("<", "&lt;");

  // 布局（对齐参考图「连成整体」：建筑坐横线，横线两端连框，字母顶接线、底压框，全部不变形）。
  // 画布几何按 orientation 取（portrait 120×180 / landscape 180×120），相框四周留 6mm、厚 3mm。
  //   - 城市名布局（字号/位置）由服务端用字体度量算好存进 design.cityNameLayout，
  //     本函数只用数值定位（前端预览不含字体依赖）。
  //   - 地平线：实心横条（贯通内沿），底沿与字母顶部（glyphTopY）相接
  //   - 建筑主体：底部坐在地平线顶沿并压进横条内部咬合
  const orientation = design.orientation ?? "portrait";
  const geo = canvasGeometry(orientation);
  const frameEnabled = Boolean(design.frame?.enabled);
  const groundHeight = 3;   // 横线加厚到 3mm，让文字顶部有足够接触面伸进去
  const nameOverlap = 1.2;  // 文字字形顶部伸进横线、底部伸进框边的量（mm）
  // 建筑底部伸进横条的重叠量：线接触不等于焊接，必须压进横条内部形成真实重叠。
  const buildingOverlap = 1.2;
  // 横线底沿 = 字形顶部 + overlap（字形顶部切进横线内部，物理咬合）。
  // glyphTopY 已是「字形顶切进线后」的位置，故线底 = glyphTopY + nameOverlap。
  const groundTop = design.cityNameLayout
    ? Math.max(40, Math.round((design.cityNameLayout.glyphTopY + nameOverlap - groundHeight) * 100) / 100)
    : design.cityNameXml ? 120 : 130;   // 有字无布局数据（旧数据兜底）；无字 130

  // 建筑内容包围盒：合并填充层 + 描线层 + 划线层，求真实边界（设计坐标 0..100 空间）。
  // 之前假设底部恒为 y=100，但真实 Potrace 输出底部往往不到 100（如巴黎线稿 maxY≈97.5），
  // 导致建筑底部与横线之间留缝。这里按真实 minY/maxY 把内容精确映射到「内沿顶 → 横线顶 groundTop」。
  const contentPaths = [...design.fillPaths, ...design.engravePaths, ...design.scorePaths];
  const contentBounds = contentPaths.length
    ? contentPaths.map((p) => pathBounds(p)).reduce<{ minX: number; minY: number; maxX: number; maxY: number } | null>(
        (acc, b) => (b && acc
          ? { minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY), maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY) }
          : (acc ?? b)),
        null,
      )
    : null;

  // 统一 transform：等比缩放（不变形），限制在「顶部留白线 → 地平线」的可用区内：
  //   - 横向可用宽：内沿左..内沿右；纵向可用高：内沿顶+topGapMm .. groundTop（顶部不顶上边框）
  //   - scale = min(宽适配, 高适配)，底部（maxY）压进地平线顶沿，水平居中，顶部自然留白
  const topGapMm = 8;   // 建筑顶部与相框上边框之间的最小留白（mm）
  const topInner = geo.innerY;
  const availW = geo.innerRight - geo.innerX;
  const availH = (groundTop - topInner - topGapMm);
  const boxScaleX = contentBounds && contentBounds.maxX > contentBounds.minX ? availW / (contentBounds.maxX - contentBounds.minX) : 1.02;
  const boxScaleY = contentBounds && contentBounds.maxY > contentBounds.minY ? availH / (contentBounds.maxY - contentBounds.minY) : 1.2;
  const scale = Math.min(boxScaleX, boxScaleY);
  const scaleX = scale;
  const scaleY = scale;
  // 底部压线：maxY * scaleY + translateY = groundTop + buildingOverlap → 建筑底部伸进横条内部咬合。
  const translateX = contentBounds
    ? topInner + (availW - (contentBounds.maxX - contentBounds.minX) * scale) / 2 - contentBounds.minX * scale   // 水平居中
    : topInner;
  const translateY = contentBounds ? groundTop + buildingOverlap - contentBounds.maxY * scaleY : groundTop + buildingOverlap - 100 * scaleY;
  const transform = `translate(${Math.round(translateX * 100) / 100} ${Math.round(translateY * 100) / 100}) scale(${Math.round(scaleX * 1000) / 1000} ${Math.round(scaleY * 1000) / 1000})`;
  const cutXml = design.cutPaths.map((p) => `<path d="${p}" fill="none"/>`).join("");
  const lineXml = [...design.engravePaths, ...design.scorePaths].map((p) => `<path d="${p}" fill="none"/>`).join("");
  const fillXml = design.fillPaths.map((p) => `<path d="${p}"/>`).join("");

  // 圆角矩形实心相框：四周留 6mm 边距（横竖幅由 geo 决定）。
  const frame = design.frame;
  const frameXml = frame?.enabled
    ? `<path d="${buildFramePathData(geo.outerX, geo.outerY, geo.outerW, geo.outerH, frame.thicknessMm, frame.radiusMm)}"/>`
    : "";
  // 地平线横条：贯通相框内沿，建筑坐在其上；仅在有相框时绘制。
  const groundLineXml = frameEnabled
    ? `<path d="M${geo.innerX} ${groundTop} H${geo.innerRight} V${groundTop + groundHeight} H${geo.innerX} Z"/>`
    : "";
  // 城市名文字：直接用外部生成的 XML（其 transform 与 cityNameLayout 数值一致）。
  const textXml = design.cityNameXml ?? "";

  // §7.2 材料布尔合并：把相框 + 横条 + 建筑填充层真正焊接成一个实心整体，
  // 输出唯一的外轮廓+内孔 path（内部重叠边消失），避免「填充改描边会切开重叠内部边」。
  // 城市名字形不参与合并（isGlyph），改回独立 <g> 叠放，避免带孔多边并集丢字母。
  // 合并失败或无可合并材料时回退到原有的「多元素叠放 + evenodd」渲染。
  const mergedMaterialPath = computeMergedMaterial(design);
  const useMerged = Boolean(mergedMaterialPath && frameEnabled);
  // 字形始终独立输出（叠放在 mergedMaterialPath 之上）；合并成功与否都不影响字形完整性。
  const textXmlFinal = textXml;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${geo.width}mm" height="${geo.height}mm" viewBox="0 0 ${geo.width} ${geo.height}" data-units="mm">
  <title>Shike ${design.city.nameEn} line art</title>
  <metadata id="shike-silhouette-design">${metadata}</metadata>
  ${cutXml ? `<g id="cut-layer" fill="none" stroke="#000000" stroke-width="${design.cutStrokeMm}" stroke-linecap="round" stroke-linejoin="round">
    <g transform="${transform}">${cutXml}</g>
  </g>` : ""}
  <g id="engraving">
    ${
      useMerged
        ? `<g id="engrave-layer" fill="#000000" fill-rule="evenodd" stroke="none">
      <path d="${mergedMaterialPath}"/>
    </g>`
        : `<g id="engrave-layer" fill="#000000" fill-rule="evenodd" stroke="none">
      ${frameXml}
      ${groundLineXml}
      ${fillXml ? `<g transform="${transform}">${fillXml}</g>` : ""}
    </g>`
    }
    ${lineXml ? `<g id="engraving-line" fill="none" stroke="#000000" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round">
      <g transform="${transform}">${lineXml}</g>
    </g>` : ""}
  </g>
  ${textXmlFinal}
</svg>`;
}
