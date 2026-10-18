import assert from "node:assert/strict";
import test from "node:test";
import { parsePlace } from "../lib/place-parse.ts";
import { normalizeFileKey } from "../lib/photo-identity.ts";

/**
 * 地点解析回归测试（对齐整改方案 S02 验收）。
 * 注意：parsePlace 在无 DeepSeek key 时走本地索引；这里测本地规则的确定性行为。
 * 用 AbortSignal.timeout 提供 signal。
 */

const signal = () => AbortSignal.timeout(1000);

test("本地城市命中：巴黎 高置信", async () => {
  const result = await parsePlace("巴黎", signal());
  assert.equal(result.cityEn, "Paris");
  assert.equal(result.confidence, "high");
  assert.equal(result.needsConfirmation, false);
});

test("明确地标不丢失：我想念巴黎圣母院 应识别巴黎", async () => {
  // 本地只命中「巴黎」，无地标库里的圣母院；但城市命中不应静默丢弃。
  const result = await parsePlace("我想念巴黎圣母院", signal());
  assert.equal(result.cityEn, "Paris");
});

test("地标与城市冲突：巴黎的悉尼歌剧院 需确认", async () => {
  const result = await parsePlace("巴黎的悉尼歌剧院", signal());
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.confidence, "low");
});

test("多城市：London and Paris 需确认（不静默取一个）", async () => {
  const result = await parsePlace("London and Paris", signal());
  assert.equal(result.needsConfirmation, true);
});

test("泛称结合城市：东京的歌剧院 不能无条件映射到悉尼歌剧院", async () => {
  const result = await parsePlace("东京的歌剧院", signal());
  // 东京有城市命中，但「歌剧院」泛称与东京不匹配 → 不应高置信映射到 Sydney Opera House。
  assert.notEqual(result.landmarkEn, "Sydney Opera House");
  assert.ok(result.needsConfirmation || result.confidence === "low");
});

test("文件名归一化：空格/下划线/编码等价", () => {
  assert.equal(normalizeFileKey("Eiffel Tower.jpg"), normalizeFileKey("Eiffel_Tower.jpg"));
  assert.equal(normalizeFileKey("File:Eiffel Tower.jpg"), normalizeFileKey("Eiffel_Tower.jpg"));
  // 百分号编码与空格等价
  assert.equal(normalizeFileKey("Eiffel%20Tower.jpg"), normalizeFileKey("Eiffel Tower.jpg"));
  // 中文编码
  assert.equal(normalizeFileKey("File:巴盖特城门.jpg"), "巴盖特城门.jpg");
});
