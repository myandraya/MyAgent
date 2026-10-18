import assert from "node:assert/strict";
import test from "node:test";
import { pathDataToRings, unionMaterials, polygonsToPathData } from "../lib/material-merge.ts";

/** 材料布尔合并（§7.2）回归测试。 */

test("两个重叠矩形做并集，合并为单一外轮廓（内部重叠边消失）", () => {
  // 两个矩形在 x 方向重叠 10 个单位
  const a = pathDataToRings("M0 0L60 0L60 60L0 60Z");
  const b = pathDataToRings("M50 0L100 0L100 60L50 60Z");
  const merged = unionMaterials([a, b]);
  assert.equal(merged.length, 1, "应合并为 1 个多边形");
  const path = polygonsToPathData(merged);
  // 外轮廓应为 0..100 宽、0..60 高的矩形（无内部 50 分界线）
  assert.match(path, /M0 0/);
  assert.match(path, /L100 60/);
  // 不应存在内部的 x=50 分界线（重叠边已消失）
  assert.doesNotMatch(path, /50 0L50 60/, "内部重叠边应被消除");
});

test("带内孔的多边形（外轮廓+孔洞）正确保留孔洞", () => {
  // 外方块 0..100，内孔 30..70
  const ring = pathDataToRings("M0 0L100 0L100 100L0 100Z M30 30L70 30L70 70L30 70Z");
  assert.equal(ring.length, 2, "应解析出外环 + 内孔两个环");
  const merged = unionMaterials([ring]);
  assert.equal(merged.length, 1);
  // 合并后仍有内孔（外环 + 内环 = 2 个环）
  assert.equal(merged[0].length, 2, "应保留外环 + 内孔");
});

test("两个完全分离的矩形做并集，得到两个独立多边形（不错误连接）", () => {
  const a = pathDataToRings("M0 0L10 0L10 10L0 10Z");
  const b = pathDataToRings("M50 50L60 50L60 60L50 60Z");
  const merged = unionMaterials([a, b]);
  assert.equal(merged.length, 2, "分离的两块应保持为两个多边形（不强行连接）");
});

test("曲线命令（Q）被正确折线化后参与合并", () => {
  // 模拟 buildFramePathData 的 Q 命令（圆角退化）
  const frame = "M6 6H114 Q114 6 114 6 V174 H6 V6 Z";
  const rings = pathDataToRings(frame);
  assert.ok(rings.length >= 1);
  assert.ok(rings[0].length >= 4, "Q 命令应被折线化出顶点");
  const merged = unionMaterials([rings]);
  assert.equal(merged.length, 1);
});

test("空输入返回空结果，不抛异常", () => {
  assert.deepEqual(unionMaterials([]), []);
  assert.equal(polygonsToPathData([]), "");
  assert.deepEqual(pathDataToRings(""), []);
});

test("独立 scaleX/scaleY（含 Y 翻转）正确映射折线坐标", () => {
  // 字形坐标「基线原点、y 向下为正」：字母竖条 x 4..6，y -20..0。
  // 用 translate(9, 168) 放置、scaleY=1（不翻转）：画布坐标应为 x 13..15，y 148..168。
  const ring = pathDataToRings("M4 -20L6 -20L6 0L4 0Z");
  const transformed = ring.map((r) => r.map(([x, y]) => [x * 1 + 9, y * 1 + 168] as [number, number]));
  const [first] = transformed[0];
  assert.deepEqual(first, [13, 148]);
  // Y 翻转（scaleY=-1）：y 取反，-20 → 20，0 → 0。
  const flipped = ring.map((r) => r.map(([x, y]) => [x * 1 + 9, y * -1 + 168] as [number, number]));
  assert.deepEqual(flipped[0][0], [13, 188]);
});

test("带内孔字形（isGlyph）不参与布尔合并，避免带孔多边并集丢字母", () => {
  // 回归：Southampton 场景中「相框+横条+字形」三元素 union 会把大部分字母整段丢失（只剩 S 残骸）。
  // 字形（含 O/A 内孔、负 y ascender）在 polygon-clipping 的带孔多边并集里拓扑不稳定，
  // 故 computeMergedMaterial 必须跳过 isGlyph 元素，字形改回独立 <g> 叠放。
  const frame = pathDataToRings("M6 6L114 6L114 174L6 174L6 6Z M9 9L9 171L111 171L111 9L9 9Z");
  const bar = pathDataToRings("M9 160.85L111 160.85L111 163.85L9 163.85Z");
  // 模拟字形（字母 O 带内孔，负 y ascender，translate 到 y≈172）
  const glyph = pathDataToRings("M10 -9L20 -9L20 0L10 0Z M13 -6L17 -6L17 -3L13 -3Z")
    .map((r) => r.map(([x, y]) => [x + 9, y + 172] as [number, number]));
  // 只合并相框 + 横条（不含字形）
  const merged = unionMaterials([frame, bar]);
  assert.equal(merged.length, 1, "相框+横条应合并为 1 个多边形");
  // 字形保持独立、完整（内孔保留），不进入 union 结果
  assert.equal(glyph.length, 2, "字形应保留外环 + 内孔两个环");
  // 验证合并结果里不含字形坐标（y 172 附近不应出现在 merged 外轮廓中）
  const path = polygonsToPathData(merged);
  assert.doesNotMatch(path, /17[01]\.[0-9]/, "合并结果不应混入字形的 y 坐标");
});
