/**
 * 通用参数化城市天际线生成器（兜底，镂空版）。
 *
 * 当图像生成 API 未配置或失败时使用。按城市名 hash 生成统一风格但独特的天际线：
 * 每个城市产生不同的建筑群组合（高度、宽度、尖顶类型、窗户排布），
 * 所有几何由确定性参数驱动，保证可重复且可制造。
 *
 * 输出分层结构：
 *   - cutPaths: 切穿层（建筑外轮廓 + 窗户孔洞），激光切穿 → 真正的镂空
 *   - engravePaths: 雕刻层（地面纹理、辅助线），表面雕刻
 *   - scorePaths: 划线层（地标名称辅助框、星座连线），浅划线
 *
 * 不限白名单城市——任意城市名都能生成。
 */

type BuildingSpec = {
  x: number;          // 0..100 左边界
  w: number;          // 0..100 宽度
  h: number;          // 0..100 高度（从底部 90 起向上）
  type: "flat" | "spire" | "dome" | "step" | "tower";
  windows: number;    // 窗户列数
  windowRows: number;
};

/** 32 位确定性 hash（FNV-1a 变体）。 */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 线性同余 PRNG，种子化。 */
function makeRng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const TYPES: BuildingSpec["type"][] = ["flat", "spire", "dome", "step", "tower"];

function buildCity(cityName: string, landmark: string): BuildingSpec[] {
  const seed = hashString(cityName + "|" + landmark);
  const rng = makeRng(seed);
  const buildings: BuildingSpec[] = [];
  const count = 7 + Math.floor(rng() * 4); // 7..10 栋
  let x = 2;
  const totalWidth = 96;
  const avgW = totalWidth / count;
  for (let i = 0; i < count; i += 1) {
    const w = avgW * (0.7 + rng() * 0.6);
    const h = 30 + rng() * 50;
    const type = TYPES[Math.floor(rng() * TYPES.length)];
    const windows = Math.max(0, Math.floor(w / 3));
    const windowRows = Math.max(1, Math.floor(h / 6));
    buildings.push({ x, w: Math.min(w, totalWidth - (x - 2)), h, type, windows, windowRows });
    x += w + 0.5;
    if (x > 96) break;
  }
  return buildings;
}

/** 建筑外轮廓 path（单个建筑实体，闭合，切穿层）。 */
function buildingOutlinePath(b: BuildingSpec): string {
  const left = b.x;
  const right = Math.min(100, b.x + b.w);
  const top = 90 - b.h;
  const bottom = 90;
  const cx = (left + right) / 2;
  const parts: string[] = [];
  parts.push(`M${left.toFixed(1)} ${bottom}V${top.toFixed(1)}`);
  switch (b.type) {
    case "flat":
      parts.push(`H${right.toFixed(1)}V${bottom}Z`);
      break;
    case "spire": {
      const spireH = (top - 8).toFixed(1);
      parts.push(`L${cx.toFixed(1)} ${spireH}L${right.toFixed(1)} ${top.toFixed(1)}V${bottom}Z`);
      break;
    }
    case "dome": {
      const r = ((right - left) / 2).toFixed(1);
      parts.push(`A${r} ${r} 0 0 1 ${right.toFixed(1)} ${top.toFixed(1)}V${bottom}Z`);
      break;
    }
    case "step": {
      const mid = (top + 6).toFixed(1);
      const midLeft = (left + (right - left) * 0.2).toFixed(1);
      const midRight = (right - (right - left) * 0.2).toFixed(1);
      parts.push(`L${midLeft} ${mid}L${midRight} ${mid}L${midRight} ${top.toFixed(1)}H${right.toFixed(1)}V${bottom}Z`);
      break;
    }
    case "tower": {
      const t = (right - left) * 0.3;
      const tLeft = (left + t).toFixed(1);
      const tRight = (right - t).toFixed(1);
      const tTop = (top - 4).toFixed(1);
      parts.push(`L${tLeft} ${top.toFixed(1)}L${tLeft} ${tTop}L${tRight} ${tTop}L${tRight} ${top.toFixed(1)}H${right.toFixed(1)}V${bottom}Z`);
      break;
    }
  }
  return parts.join("");
}

/** 建筑窗户轮廓 path（独立小矩形闭合，作为结构线，clean line art 风格）。 */
function buildingWindowsPaths(b: BuildingSpec): string[] {
  const left = b.x;
  const right = Math.min(100, b.x + b.w);
  const top = 90 - b.h;
  const bottom = 90;
  const paths: string[] = [];
  const wWidth = 1.2;
  const wHeight = 1.8;
  const wGap = (b.w - b.windows * wWidth * 2) / Math.max(1, b.windows + 1);
  for (let r = 0; r < b.windowRows; r += 1) {
    const wy = top + 4 + r * 4;
    if (wy + wHeight > bottom - 2) break;
    for (let c = 0; c < b.windows; c += 1) {
      const wx = left + wGap + c * (wWidth * 2 + wGap);
      if (wx + wWidth > right - 1) break;
      paths.push(`M${wx.toFixed(1)} ${wy.toFixed(1)}h${wWidth}v${wHeight}h${-wWidth}Z`);
    }
  }
  return paths;
}

/** 建筑屋顶尖塔轮廓（部分类型有，闭合 path）。 */
function buildingRoofDetailPath(b: BuildingSpec): string | null {
  if (b.type !== "spire" && b.type !== "dome") return null;
  const left = b.x;
  const right = Math.min(100, b.x + b.w);
  const top = 90 - b.h;
  const cx = (left + right) / 2;
  if (b.type === "spire") {
    // 尖塔顶部的旗杆/装饰线（闭合小三角）
    const flagY = (top - 8).toFixed(1);
    return `M${cx.toFixed(1)} ${flagY}L${(cx + 1).toFixed(1)} ${(top - 4).toFixed(1)}L${cx.toFixed(1)} ${top.toFixed(1)}Z`;
  }
  // dome: 圆顶上的装饰线
  return null;
}

/** 地平线基线（轻微起伏，作为底部结构线，闭合以围合底边）。 */
function groundPath(): string {
  return "M0 90Q25 88 50 90Q75 92 100 90L100 100L0 100Z";
}

export type FallbackSilhouette = {
  /** 兼容字段：clean line art 风格下，cutPaths 留空（外框由 SVG 模板生成） */
  cutPaths: string[];
  /** 描线雕刻层：建筑外轮廓 + 窗户 + 屋顶细节 + 地平线（全部为结构轮廓线） */
  engravePaths: string[];
  /** 参数化兜底没有位图填充轮廓。 */
  fillPaths: string[];
  /** 兼容字段，clean line art 下不再使用 */
  scorePaths: string[];
  /** 向后兼容：所有 path 合并 */
  paths: string[];
  landmarkNames: string[];
};

/**
 * 生成兜底城市天际线（clean line art 单线轮廓风格）。
 *
 * 输出统一为 engravePaths（黑色描线雕刻层）：
 *   - 建筑外轮廓（闭合）
 *   - 窗户小矩形（闭合，作为结构线表现）
 *   - 屋顶细节（尖塔旗杆等）
 *   - 地平线（闭合）
 * 不再有"切穿镂空"语义——所有元素都是单线轮廓，统一线宽 0.2mm。
 */
export function generateFallbackSilhouette(cityName: string, landmark: string): FallbackSilhouette {
  const buildings = buildCity(cityName, landmark);
  const engravePaths: string[] = [];
  for (const b of buildings) {
    engravePaths.push(buildingOutlinePath(b));
    engravePaths.push(...buildingWindowsPaths(b));
    const roof = buildingRoofDetailPath(b);
    if (roof) engravePaths.push(roof);
  }
  engravePaths.push(groundPath());
  return { cutPaths: [], engravePaths, fillPaths: [], scorePaths: [], paths: [...engravePaths], landmarkNames: [landmark] };
}
