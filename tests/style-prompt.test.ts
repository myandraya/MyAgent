import assert from "node:assert/strict";
import test from "node:test";
import { buildFaithfulPrompt, buildPrompt, type SubjectType } from "../lib/image-gen.ts";

/**
 * 文字入口生成风格（几何镂空修正）回归测试。
 * 验证两条生成路径的指令行为契约，不匹配无关字符串。
 */

test("主路径：传地标名时指令锁定该主体，不允许模型自行挑选别的建筑", () => {
  const prompt = buildFaithfulPrompt("Big Ben");
  // 主体锁定：地标名出现在指令里，且措辞是强制性的
  assert.ok(prompt.includes('"Big Ben"'), "指令应包含已确认地标名");
  assert.ok(prompt.includes("MUST draw exactly this building"), "应有强制主体锁定措辞");
  assert.ok(!prompt.includes("Pick the SINGLE most iconic"), "锁定主体后不应再让模型自选建筑");
});

test("主路径：未传地标名时才退化为模型自选单一主体", () => {
  const prompt = buildFaithfulPrompt();
  assert.ok(prompt.includes("Pick the SINGLE most iconic"), "无地标时应退化为自选主体");
});

test("主路径与备用路径共享同一套几何镂空风格语义", () => {
  const faithful = buildFaithfulPrompt("Elizabeth Tower");
  const fallback = buildPrompt({ landmark: "大本钟", landmarkEn: "Big Ben", city: "伦敦", cityEn: "London", subjectType: "city" as SubjectType });
  // 两条路径都应遵守几何镂空的核心语义：宽阔几何开孔、粗细协调、单一主体、纯黑白。
  for (const [name, prompt] of [["主路径", faithful], ["备用路径", fallback]] as const) {
    assert.ok(prompt.includes("WIDE geometric region"), `${name}应要求宽阔几何开孔`);
    assert.ok(prompt.includes("coordinated, uniform thickness"), `${name}应要求支撑粗细协调`);
    assert.ok(prompt.includes("added later by code layout"), `${name}应声明文字/相框/横条由代码排版`);
    assert.ok(!/lattice of the Eiffel Tower/i.test(prompt), `${name}不应再用“埃菲尔铁塔桁架”旧表述`);
  }
});

test("指令不假设模型已看到参考文件：只描述输入图像本身", () => {
  const prompt = buildFaithfulPrompt("Big Ben");
  assert.ok(prompt.includes("reference photos"), "应基于参考照片描述输入");
  assert.ok(!prompt.includes(".svg"), "不应假设模型看到了 SVG 参考文件");
});
