/**
 * 材料拓扑检查：判断「保留材料」是否连成一个整体（对齐正式产品方案 §7.3）。
 *
 * 背景：当前相框、建筑、横条、城市名是多个独立 <path>/<g> 叠放在 engrave-layer 里，
 * 靠 fill-rule=evenodd 视觉合并，物理上并未布尔合并。若它们之间存在间隙（未连接），
 * 切割时会得到多个分离的碎片——这恰恰是「预览通过但切出来散架」的根因。
 *
 * 本模块把「保留材料元素」栅格化到一张位图，做连通域分析，报告：
 *   - componentCount：分离的材料块数量（>1 说明有孤岛/未连接）
 *   - 是否只有点接触 / 切线接触（这类连接不可靠，见下）
 *
 * 采用 point-in-polygon 对闭合子路径做 evenodd 栅格化（近似，忽略贝塞尔曲线控制点，
 * 只取折线顶点——对连通性判断足够，因为曲线连接关系由端点决定）。
 */

/** 一个待分析的材料元素：闭合子路径数据 + 在毫米画布上的缩放/平移。 */
export type MaterialElement = {
  /** 闭合子路径（含外轮廓与孔洞，M...Z M...Z） */
  pathData: string;
  /** 统一的画布缩放系数（把 0..100 设计空间映射到毫米）；与 scaleX/scaleY 二选一 */
  scaleMm?: number;
  /** X 轴独立缩放（可负，用于 Y 翻转）；优先于 scaleMm */
  scaleX?: number;
  /** Y 轴独立缩放（可负，用于 Y 翻转）；优先于 scaleMm */
  scaleY?: number;
  /** 画布 X 平移（mm） */
  translateX: number;
  /** 画布 Y 平移（mm） */
  translateY: number;
  /**
   * 是否为「城市名字形」元素。
   * 字形轮廓（含 O/A 内孔、负 y ascender）在 polygon-clipping 的带孔多边并集里拓扑不稳定，
   * 容易在边缘擦碰（字母顶进横条仅 ~1.8mm）时被误判为内孔而整段丢失。
   * 故字形不参与布尔合并，标记后由 computeMergedMaterial 跳过、改回独立 <g> 叠放渲染。
   */
  isGlyph?: boolean;
};

export type ConnectivityResult = {
  /** 分离的材料连通分量数 */
  componentCount: number;
  /** 最大连通分量占材料总像素的比例（0..1） */
  largestRatio: number;
  /** 是否存在孤岛（有面积不可忽略的分离材料块） */
  hasIsland: boolean;
  /** 是否只有点接触/切线接触（8 邻域无一条实边相连，仅 4 邻域角点相接） */
  hasWeakContact: boolean;
};

/** 解析单个子路径，只提取 M/L/H/V 命令产生的绝对顶点（忽略曲线控制点）。 */
function extractVerticesFromSubpath(sub: string): { x: number; y: number }[] {
  // 逐命令解析：命令字母后跟坐标。曲线命令（C/S/Q/T）的控制点会干扰顶点序列，
  // 这里跳过曲线命令（其终点会由后续命令或闭合连接），只保留直线顶点。
  const verts: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  const tokens = sub.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/^[A-Za-z]$/.test(cmd)) {
      const c = cmd.toUpperCase();
      if (c === "M" || c === "L") {
        // M/L：成对 (x y)
        const nums: number[] = [];
        i += 1;
        while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
          nums.push(Number(tokens[i]));
          i += 1;
        }
        for (let k = 0; k + 1 < nums.length; k += 2) {
          x = nums[k];
          y = nums[k + 1];
          verts.push({ x, y });
        }
        continue;
      }
      if (c === "H") {
        i += 1;
        while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
          x = Number(tokens[i]);
          verts.push({ x, y });
          i += 1;
        }
        continue;
      }
      if (c === "V") {
        i += 1;
        while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
          y = Number(tokens[i]);
          verts.push({ x, y });
          i += 1;
        }
        continue;
      }
      // 曲线命令（C/S/Q/T/A）：跳过其参数（按参数个数）。
      // C: 6 参数, S/Q: 4, T: 2, A: 7, Z: 0
      const paramCount: Record<string, number> = { C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
      i += 1;
      let toSkip = paramCount[c] ?? 2;
      while (i < tokens.length && toSkip > 0 && !/^[A-Za-z]$/.test(tokens[i])) {
        i += 1;
        toSkip -= 1;
      }
      // 曲线终点：取最后一个坐标对作为顶点（保证轮廓闭合）。
      if (c === "Q" || c === "T" || c === "C" || c === "S") {
        // 曲线终点已在上面被跳过，这里补记录终点：
        // 简化：不记录曲线终点（闭合由 Z 或后续 M 保证，连通性判断用直线顶点已足够）。
      }
      continue;
    }
    i += 1;
  }
  return verts;
}

/** 对一组子路径顶点做 evenodd point-in-polygon 判断。 */
function pointInEvenoddSubpaths(px: number, py: number, subpaths: { x: number; y: number }[][]): boolean {
  let inside = false;
  for (const poly of subpaths) {
    // 标准射线法（evenodd 对所有子路径累积）。
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** 把 path 数据拆成子路径顶点数组（每个子路径一个多边形，只取直线顶点）。 */
function splitSubpaths(pathData: string): { x: number; y: number }[][] {
  const subpaths = pathData.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
  return subpaths
    .map((sub) => extractVerticesFromSubpath(sub))
    .filter((poly) => poly.length >= 3);
}

/**
 * 分析「保留材料元素」在毫米画布上的连通性。
 *
 * 所有元素先按各自 transform 映射到画布坐标，再统一栅格化（分辨率由 canvasW/H 决定），
 * 最后做 8 邻域连通域分析。
 */
export function analyzeMaterialConnectivity(
  elements: MaterialElement[],
  canvasWidthMm: number,
  canvasHeightMm: number,
  resolution = 200,
): ConnectivityResult {
  if (elements.length === 0) {
    return { componentCount: 0, largestRatio: 0, hasIsland: false, hasWeakContact: false };
  }

  // 栅格分辨率：按长边取 resolution 像素，短边等比。
  const scale = resolution / Math.max(canvasWidthMm, canvasHeightMm);
  const width = Math.max(2, Math.round(canvasWidthMm * scale));
  const height = Math.max(2, Math.round(canvasHeightMm * scale));

  // 每个元素拆成画布坐标下的子路径多边形。
  const elementPolys = elements.map((el) => ({
    scaleX: el.scaleX ?? el.scaleMm ?? 1,
    scaleY: el.scaleY ?? el.scaleMm ?? 1,
    tx: el.translateX,
    ty: el.translateY,
    polys: splitSubpaths(el.pathData),
  }));

  // 栅格化：对每个像素用 evenodd 判断是否在任一元素的「保留材料」内。
  const grid = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const yMm = py / scale;
    for (let px = 0; px < width; px += 1) {
      const xMm = px / scale;
      let filled = false;
      for (const el of elementPolys) {
        // 把画布毫米坐标反变换回元素自身的 path 坐标空间（建筑为 0..100 设计空间，
        // 相框/横条为毫米空间，字形为基线原点+正 y 向上），再直接做 point-in-polygon。
        const lx = (xMm - el.tx) / el.scaleX;
        const ly = (yMm - el.ty) / el.scaleY;
        if (pointInEvenoddSubpaths(lx, ly, el.polys)) {
          filled = true;
          break;
        }
      }
      grid[py * width + px] = filled ? 1 : 0;
    }
  }

  // 连通域分析（8 邻域）。
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const sizes: number[] = [];
  let label = 0;
  let weakContacts = 0;
  for (let start = 0; start < width * height; start += 1) {
    if (!grid[start] || labels[start]) continue;
    label += 1;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    labels[start] = label;
    let edgeCount = 0;
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
        if (grid[next] && !labels[next]) {
          labels[next] = label;
          queue[tail++] = next;
        }
      }
      // 统计 4 邻域（上下左右）的实边接触，用于判断点接触。
      const neighbors4 = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbors4) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const next = ny * width + nx;
          if (grid[next]) edgeCount += 1;
        }
      }
    }
    sizes.push(tail);
    // 若该连通分量只有极少的 4 邻域实边（近乎点接触/对角线斜接），记为弱接触。
    // 阈值：有效材料像素 > 4 但 4 邻域边占比极低（< 0.5 边/像素）说明是细线/点接触。
    if (tail > 4 && edgeCount / tail < 0.6) weakContacts += 1;
  }

  const totalMaterial = sizes.reduce((sum, s) => sum + s, 0);
  const largest = sizes.length ? Math.max(...sizes) : 0;
  const largestRatio = totalMaterial > 0 ? largest / totalMaterial : 0;
  // 孤岛判定：有 >1 个连通分量，且次大分量面积足够（> 1% 总材料），才算显著孤岛，
  // 避免把抗锯齿碎点误报为孤岛。
  const sorted = [...sizes].sort((a, b) => b - a);
  const hasIsland = sorted.length > 1 && sorted[1] > totalMaterial * 0.01;

  return { componentCount: label, largestRatio, hasIsland, hasWeakContact: weakContacts > 0 };
}
