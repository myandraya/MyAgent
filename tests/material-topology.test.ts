import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMaterialConnectivity } from "../lib/material-topology.ts";
import { checkMaterialConnectivity, composeSilhouetteSelection } from "../lib/silhouette.ts";
import { potraceVectorize } from "../lib/potrace-vectorize.ts";
import { PNG } from "pngjs";

/** 材料连通性检查回归测试（对齐正式产品方案 §7.3）。 */

test("两个完全分离的材料块被识别为孤岛", () => {
  const result = analyzeMaterialConnectivity(
    [
      { pathData: "M10 10 L110 10 L110 50 L10 50 Z", scaleMm: 1, translateX: 0, translateY: 0 },
      { pathData: "M100 100 L110 100 L110 110 L100 110 Z", scaleMm: 1, translateX: 0, translateY: 0 },
    ],
    120, 180, 200,
  );
  assert.equal(result.componentCount, 2);
  assert.equal(result.hasIsland, true);
});

test("连成一体的材料块 componentCount 为 1，无孤岛", () => {
  // 大矩形 + 一条从大矩形延伸出去的小凸起（物理相连）
  const result = analyzeMaterialConnectivity(
    [
      { pathData: "M10 10 L110 10 L110 50 L10 50 Z", scaleMm: 1, translateX: 0, translateY: 0 },
      { pathData: "M110 10 L120 10 L120 30 L110 30 Z", scaleMm: 1, translateX: 0, translateY: 0 },
    ],
    120, 180, 200,
  );
  assert.equal(result.componentCount, 1);
  assert.equal(result.hasIsland, false);
});

test("空内容设计（仅相框+横条）连成一体，无孤岛", () => {
  const empty = composeSilhouetteSelection("巴黎", [], "2023-06-01", [], {});
  const result = checkMaterialConnectivity(empty);
  assert.equal(result.hasIsland, false);
  assert.ok(result.componentCount >= 1);
});

test("曲线命令（Q）的矩形仍能被正确解析为连通材料", () => {
  // 模拟 buildFramePathData 输出（含 Q 命令退化为直线）
  const frame = "M6 6 H114 Q114 6 114 6 V174 Q114 174 114 174 H6 Q6 174 6 174 V6 Q6 6 6 6 Z";
  const result = analyzeMaterialConnectivity(
    [{ pathData: frame, scaleMm: 1, translateX: 0, translateY: 0 }],
    120, 180, 200,
  );
  assert.equal(result.componentCount, 1);
  assert.equal(result.hasIsland, false);
});

test("非方形输入保持比例，不被分别拉伸（§7.1）", async () => {
  // 构造 100×40 非方形 PNG（中心 40×20 黑色块），矢量化后应保持 2.5:1 宽高比。
  const width = 100;
  const height = 40;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const inside = x >= 30 && x <= 70 && y >= 10 && y <= 30;
      const val = inside ? 0 : 255;
      png.data[idx] = val;
      png.data[idx + 1] = val;
      png.data[idx + 2] = val;
      png.data[idx + 3] = 255;
    }
  }
  const buffer = PNG.sync.write(png);
  const result = await potraceVectorize(buffer.toString("base64"), { turdSize: 2 });
  assert.equal(result.ok, true);
  // 原图宽高比 100/40 = 2.5，应被保留。
  assert.ok(result.aspectRatio !== undefined && Math.abs(result.aspectRatio - 2.5) < 0.01, `aspectRatio 应≈2.5，实际 ${result.aspectRatio}`);
  // 统一缩放下，长边（宽 100px）贴到 100，短边（高 40px）留白到 40，不应被拉到 100。
  // 检查 path 的 y 坐标范围：黑色块在 10..30（40px 图），缩放 100/100=1，y 范围应仍在 ~10..30 内。
  const coords = (result.path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const ys = coords.filter((_, i) => i % 2 === 1); // 奇数位是 y（近似，M/L 命令下）
  const maxY = Math.max(...ys);
  const minY = Math.min(...ys);
  // 高度 40px → 缩放 100/100=1，黑色块 y 约 10..30，不应被拉伸到接近 100。
  assert.ok(maxY < 60, `y 坐标不应被拉伸（maxY=${maxY}，若分别拉伸会接近 100）`);
  assert.ok(minY >= 0, `y 坐标不应为负（minY=${minY}）`);
});

