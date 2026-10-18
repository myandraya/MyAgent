import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// opentype.js v2 同时发布 UMD（dist/opentype.js）与 ESM（dist/opentype.mjs）两套构建：
//   - Next/Turbopack 解析到 .mjs（命名导出 parse，无 default）
//   - Node 直跑（测试）按 package.json 的 main 走 UMD（CommonJS，只有 default）
// 两种运行时对「命名导入还是默认导入」的要求相反。用 createRequire 直接加载 CommonJS
// 入口，拿到统一的对象再解构 parse，两边都稳。这也符合 next.config 里把该包标为 external 的约定。
const requireOpentype = createRequire(import.meta.url);
const { parse: parseFontBuffer } = requireOpentype("opentype.js") as {
  parse(buffer: ArrayBuffer, opt?: { lowMemory: boolean }): unknown;
};

/**
 * 城市英文名 → 可雕刻矢量轮廓 path（服务端专用，浏览器不可用）。
 *
 * 用 opentype.js 加载 OFL 许可的 Poppins SemiBold 几何无衬线字体，把城市英文名
 * 的字形轮廓转成 SVG path 数据。字形轮廓采用 fill 语义（非零环绕 + evenodd），
 * 字母内孔（O/P/A 的洞）会被 evenodd 正确镂空，正好复用现有 engrave-layer 的
 * fill-rule="evenodd" 填充雕刻语义。
 *
 * 为什么服务端做：opentype.js 需读字体文件（node:fs），浏览器端无文件系统。
 *
 * 注：opentype.js v2 的 UMD 与 ESM 两套构建导入方式相反（见下方 createRequire 注释），
 * 故用 createRequire 统一加载 CommonJS 入口再解构 parse，避免运行时分歧。
 */

type OpentypeFont = {
  unitsPerEm: number;
  getPath(text: string, x: number, y: number, fontSize: number): OpentypePath;
  stringToGlyphs(text: string): { advanceWidth?: number }[];
};

type OpentypePath = {
  toPathData(decimalPlaces?: number): string;
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
};

const FONT_PATH = resolve(process.cwd(), "public/fonts/Poppins-SemiBold.ttf");

let cachedFont: OpentypeFont | null = null;

function loadFont(): OpentypeFont {
  if (!cachedFont) {
    cachedFont = parseFontBuffer(readFileSync(FONT_PATH).buffer as ArrayBuffer) as unknown as OpentypeFont;
  }
  return cachedFont;
}

/**
 * 把城市英文名转成 SVG path 数据（fill 语义，供 evenodd 填充雕刻）。
 *
 * @param text      英文城市名（如 "London"、"New York"）
 * @param fontSize  字号（SVG 用户单位，即 mm 下的文字 em 高度）
 * @returns path 的 d 属性字符串；空串表示无有效字形
 *
 * 说明：opentype getPath 以基线 (0,0) 为原点、正 y 向上生成轮廓，
 * toPathData 输出的坐标即 SVG 用户单位下的字形轮廓（含负 y 的 ascender 部分）。
 */
export function cityNameToPathData(text: string, fontSize = 20): string {
  const cleaned = text.trim();
  if (!cleaned) return "";
  const font = loadFont();
  // opentype.js 在某些浮点字号下（如 16.56113005358013）对个别字形（Poppins 的 G）
  // 会产生 NaN 坐标（TrueType 二次曲线推断 on-curve 点时除零），导致字形渲染破损。
  // 检测到 NaN 就把字号做极小偏移重试（宽度变化 <0.1%，不影响布局计算）。
  for (let attempt = 0; attempt < 6; attempt++) {
    const size = fontSize * (1 + attempt * 0.0007);
    const d = (font.getPath(cleaned, 0, 0, size) as OpentypePath).toPathData(2);
    if (!d.includes("NaN")) return d;
  }
  console.error(`[text-path] 字号 ${fontSize} 下多次微移仍产生 NaN，放弃生成：「${cleaned}」`);
  return "";
}

/** 估算文字渲染后的包围盒宽度（用于居中排版），单位同 fontSize。 */
export function measureTextWidth(text: string, fontSize = 20): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  const font = loadFont();
  const glyphs = font.stringToGlyphs(cleaned);
  const advance = glyphs.reduce((sum, glyph) => sum + (glyph.advanceWidth ?? 0), 0);
  return (advance / font.unitsPerEm) * fontSize;
}

/** 文字实际渲染的包围盒（x1/y1/x2/y2），用于精确垂直定位；单位同 fontSize。 */
export function measureTextBounds(text: string, fontSize = 20): { width: number; height: number; ascender: number; descender: number; right: number } {
  const cleaned = text.trim();
  if (!cleaned) return { width: 0, height: 0, ascender: 0, descender: 0, right: 0 };
  const font = loadFont();
  const path = font.getPath(cleaned, 0, 0, fontSize);
  const box = path.getBoundingBox();
  return {
    width: box.x2 - box.x1,
    height: box.y2 - box.y1,
    ascender: Math.abs(box.y1),   // 顶部（负 y）到基线的距离
    descender: box.y2,            // 底部（正 y）到基线的距离
    right: box.x2,                // path 从 x=0 起算的实际右边界（含首字左 bearing）
  };
}

/**
 * 生成一段「已定位」的城市名雕刻文字 path，供 SVG 直接使用。
 *
 * @returns { path, x, y, width, height, fontSize }
 *   - path：从 x=0 起的字形轮廓（fill 语义）
 *   - x：水平居中偏移量（mm），调用方用 <g transform="translate(x, y)"> 包裹
 *   - y：基线 y 坐标（mm）
 */
export function buildCityNamePath(
  text: string,
  canvasWidth: number,
  targetFontSize = 14,
  baselineY?: number,
): { path: string; x: number; y: number; width: number; fontSize: number } {
  const cleaned = text.trim();
  const fontSize = targetFontSize;
  const path = cityNameToPathData(cleaned, fontSize);
  if (!path) return { path: "", x: 0, y: 0, width: 0, fontSize };
  const width = measureTextWidth(cleaned, fontSize);
  const bounds = measureTextBounds(cleaned, fontSize);
  // 水平居中：把文字水平中心对齐画布中心。
  const x = Math.max(0, Math.round((canvasWidth - width) / 2 * 100) / 100);
  // 垂直定位：若未显式给基线，则让文字底部（descender）贴住 baselineY 或默认底部留白。
  const y = baselineY !== undefined ? Math.round(baselineY * 100) / 100 : Math.round((canvasWidth - bounds.height) / 2 * 100) / 100;
  return { path, x, y, width, fontSize };
}

/**
 * 计算城市名的排版布局（全大写、不变形、宽度优先，且上下都与线/框「咬合」）。
 *
 * 设计原则（对齐参考图「连成整体」）：
 *   - 字母保持字体自然比例（scaleX=1，绝不横向压扁）
 *   - 字号由「宽度合理」决定：单词恰好放满可用宽度（长名自动小字，短名自动大字）
 *   - 字母底部伸进相框底边（bottomY + overlapMm），顶部位置随之确定
 *   - 横线（地平线）由调用方按 glyphTopY + overlapMm 放置，让字形顶部伸进横线内部
 *
 * 横竖幅说明：竖幅画布 120×180（文字横排放在底部）；横幅画布 180×120（文字横排放在底部，
 * 底部内沿 = 111）。两种方向下文字始终「横排」，区别只在于画布宽高与可用宽度。
 *
 * @param orientation 排版方向：portrait（竖幅 120×180）/ landscape（横幅 180×120）
 * @param bottomY   相框底边内沿 y（mm）；缺省按方向取
 * @param minTopY   字母顶部允许的最高位置（mm）——限制字号上限，防止短名字过大挤占建筑区
 * @param overlapMm 上下各重叠多少（mm），让字形与线/框物理咬合
 */
export function computeCityNameLayout(
  text: string,
  orientation: "portrait" | "landscape" = "portrait",
  bottomY?: number,
  minTopY?: number,
  overlapMm = 1.2,
): {
  text: string; fontSize: number; baselineY: number; glyphTopY: number; x: number; path: string; orientation: "portrait" | "landscape";
} | null {
  const cleaned = text.trim().toUpperCase();
  if (!cleaned) return null;
  const ref = measureTextBounds(cleaned, 100);
  if (ref.height <= 0 || ref.right <= 0) return null;

  // 画布与相框内沿（mm），按方向取：竖幅 120×180，横幅 180×120。
  const canvasWidth = orientation === "landscape" ? 180 : 120;
  const canvasHeight = orientation === "landscape" ? 120 : 180;
  const marginX = 9;
  // 底部内沿：竖幅 171（180-6-3），横幅 111（120-6-3）。
  const defaultBottomY = orientation === "landscape" ? 111 : 171;
  const bottom = bottomY ?? defaultBottomY;
  // 顶部内沿：竖幅 9，横幅 9。
  const topInner = 9;
  // 字母顶部允许的最高位置（限制字号上限，防止挤占建筑区）：缺省取画布高的一半附近。
  const defaultMinTopY = orientation === "landscape" ? topInner : 104;
  const minTop = minTopY ?? defaultMinTopY;

  // 用 path 从 x=0 起算的真实右边界（含首字左 bearing）作为宽度，避免估算偏小导致超框。
  // 额外留 sideGap（左右各 4mm）：文字只要求「上下连接」（顶部接横线、底部压框），
  // 左右不得贴住/连上相框内沿，否则视觉上文字与边框焊死（科隆 COLOGNE 曾贴满 9..111）。
  const sideGap = 4;
  const naturalWidthPer100 = ref.right;
  const maxSpan = canvasWidth - marginX * 2 - sideGap * 2;
  // 字号取两者较小值：宽度放满（不变形）与高度上限（不挤占建筑区）。
  const fontSizeByWidth = (maxSpan / naturalWidthPer100) * 100;
  const fontSizeByHeight = ((bottom - minTop) / ref.height) * 100;
  const fontSize = Math.min(fontSizeByWidth, fontSizeByHeight);
  const path = cityNameToPathData(cleaned, fontSize);
  if (!path) return null;
  // 字母底部伸进框边 overlapMm（底部到 bottom + overlapMm），顶部随之确定。
  const ascender = (ref.ascender / 100) * fontSize;
  const descender = (ref.descender / 100) * fontSize;
  const baselineY = (bottom + overlapMm) - descender;
  const glyphTopY = baselineY - ascender;
  // path 从 x=0 起，右边界 = ref.right 随字号缩放；居中偏移按真实右边界。
  const width = ref.right / 100 * fontSize;
  const x = Math.max(0, Math.round((canvasWidth - width) / 2 * 100) / 100);
  void canvasHeight;
  return { text: cleaned, fontSize, baselineY, glyphTopY, x, path, orientation };
}

/**
 * 生成完整的城市名雕刻文字 SVG 片段（含 <g> 包裹 + 水平居中 + 定位），
 * 供 generateSilhouetteSvg 直接拼入。
 *
 * 布局约定（对齐参考图：城市名全大写、不变形，底部贴框底、顶部接横线）。
 * orientation 决定画布尺寸：portrait 120×180（竖幅）、landscape 180×120（横幅），
 * 文字始终横排、放在底部，与相框内沿「上下咬合」。
 */
export function buildCityNameXml(text: string, orientation: "portrait" | "landscape" = "portrait", bottomY?: number, minTopY?: number, overlapMm = 1.2): string {
  const layout = computeCityNameLayout(text, orientation, bottomY, minTopY, overlapMm);
  if (!layout) return "";
  return `<g id="engraving-text" fill="#000000" fill-rule="evenodd" stroke="none">
    <g transform="translate(${layout.x} ${Math.round(layout.baselineY * 100) / 100})"><path d="${layout.path}"/></g>
  </g>`;
}
