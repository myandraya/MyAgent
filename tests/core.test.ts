import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GET, POST } from "../app/api/events/route.ts";
import { fallbackContent, parseGeneratedContent } from "../lib/content.ts";
import { checkDfm, checkSvg, createStarDesign, designFilename, generateStarDxf, generateStarSvg, queryStarMap, repairStarDesign } from "../lib/index.ts";
import { maskAddress, shareCardSvg } from "../lib/privacy.ts";
import { checkDfmTool, checkInputSchema, generateStarSvgTool, MCP_TOOL_NAMES, queryStarMapTool, starInputSchema } from "../mcp/tools.ts";

test("固定城市与日期的星图可重复", () => {
  const input = { city: "edinburgh", date: "2023-06-01" };
  assert.deepEqual(queryStarMap(input), queryStarMap(input));
});

test("三座城市覆盖南北半球并产生不同真实星空", () => {
  const edinburgh = queryStarMap({ city: "edinburgh", date: "2023-06-01" });
  const sydney = queryStarMap({ city: "sydney", date: "2023-06-01" });
  const newYork = queryStarMap({ city: "new-york", date: "2023-06-01" });
  assert.ok(edinburgh.city.latitude > 0 && newYork.city.latitude > 0 && sydney.city.latitude < 0);
  assert.ok([edinburgh, sydney, newYork].every((map) => map.stars.length >= 10));
  assert.ok(sydney.stars.some((star) => star.id === "acrux"), "悉尼应能看到南十字座 Acrux");
  assert.notDeepEqual(edinburgh.stars.map((star) => star.id), sydney.stars.map((star) => star.id));
});

test("分层 SVG 使用毫米、制造颜色、线宽、路径文字标记和四个对位孔", () => {
  const design = repairStarDesign(createStarDesign({ city: "edinburgh", date: "2023-06-01" }), "falcon-10w");
  const svg = generateStarSvg(design);
  assert.match(svg, /width="300mm" height="300mm" viewBox="0 0 300 300"/);
  assert.match(svg, /id="cut-through"[\s\S]*stroke="#ff0000"/);
  assert.match(svg, /id="vector-score"[\s\S]*stroke="#0000ff"/);
  assert.match(svg, /id="engraving"[\s\S]*stroke="#000000"/);
  assert.equal((svg.match(/data-kind="registration"/g) ?? []).length, 4);
  assert.doesNotMatch(svg, /<text\b/);
  assert.equal(checkSvg(svg).passed, true);
});

test("DFM 在修复前发现问题，修复后复检变绿", () => {
  const original = createStarDesign({ city: "london", date: "2022-12-01" });
  const before = checkDfm(original);
  assert.equal(before.passed, false);
  assert.ok(before.issues.some((issue) => issue.code === "LINE_WIDTH"));
  const repaired = repairStarDesign(original, "falcon-10w");
  assert.equal(checkDfm(repaired).passed, true);
  assert.ok(repaired.vectorStrokeMm >= 0.5);
  assert.ok(repaired.stars.every((star, index) => repaired.stars.slice(index + 1).every((other) => Math.hypot(star.x-other.x, star.y-other.y)-star.radius-other.radius >= 2.5)));
});

test("机型切换会改变包络，A1C 修复后缩放至安全尺寸", () => {
  const original = createStarDesign({ city: "sydney", date: "2023-06-01" });
  const standard = repairStarDesign(original, "falcon-10w");
  assert.equal(checkDfm(standard, "falcon-10w").issues.length, 0);
  const compactBefore = checkDfm(original, "falcon-a1c");
  assert.equal(compactBefore.passed, false);
  assert.ok(compactBefore.issues.some((issue) => issue.code === "ENVELOPE"));
  const compact = repairStarDesign(original, "falcon-a1c");
  assert.equal(compact.sizeMm, 120);
  assert.equal(checkDfm(compact, "falcon-a1c").passed, true);
});

test("SVG/DXF 下载名和内容一致且非空", () => {
  const design = repairStarDesign(createStarDesign({ city: "edinburgh", date: "2023-06-01" }), "falcon-10w");
  const svg = generateStarSvg(design); const dxf = generateStarDxf(design);
  assert.equal(designFilename(design, "svg"), "shike-edinburgh-2023-06-01.svg");
  assert.ok(svg.startsWith("<?xml") && svg.length > 1000);
  assert.ok(dxf.includes("$INSUNITS\n70\n4") && dxf.endsWith("0\nEOF\n") && dxf.length > 500);
  assert.ok(dxf.includes("CUT_RED") && dxf.includes("SCORE_BLUE") && dxf.includes("ENGRAVE_BLACK"));
});

test("20 组城市/日期 DFM 回归均可确定性修复", () => {
  const cities = ["edinburgh", "london", "sydney", "melbourne", "new-york"];
  const dates = ["2019-01-15", "2021-04-20", "2023-06-01", "2025-10-10"];
  let count = 0;
  for (const city of cities) for (const date of dates) {
    const first = repairStarDesign(createStarDesign({ city, date }), "falcon-10w");
    const second = repairStarDesign(createStarDesign({ city, date }), "falcon-10w");
    assert.equal(checkDfm(first).passed, true, `${city} ${date}`);
    assert.equal(generateStarSvg(first), generateStarSvg(second));
    count += 1;
  }
  assert.equal(count, 20);
});

test("输入边界拒绝无效日期、城市和尺寸", () => {
  assert.throws(() => queryStarMap({ city: "unknown", date: "2023-06-01" }), /不支持/);
  assert.throws(() => queryStarMap({ city: "edinburgh", date: "2023-02-30" }), /不存在/);
  assert.throws(() => queryStarMap({ city: "0,181", date: "2023-06-01" }), /范围/);
  assert.throws(() => queryStarMap({ city: "edinburgh", date: "2023-06-01", sizeMm: 20 }), /80\.\.380/);
});

test("MCP 三工具 schema、成功路径和错误输入", async () => {
  assert.deepEqual(MCP_TOOL_NAMES, ["query_star_map", "generate_star_svg", "check_dfm"]);
  assert.equal(starInputSchema.safeParse({ city: "edinburgh", date: "2023-06-01" }).success, true);
  assert.equal(starInputSchema.safeParse({ city: "", date: "yesterday" }).success, false);
  const map = queryStarMapTool({ city: "edinburgh", date: "2023-06-01" });
  assert.ok(map.stars.length > 0);
  const directory = await mkdtemp(path.join(tmpdir(), "shike-"));
  try {
    const generated = await generateStarSvgTool({ city: "edinburgh", date: "2023-06-01", size_mm: 300 }, directory);
    assert.equal(generated.dfm.passed, true);
    const svg = await readFile(generated.path, "utf8");
    assert.equal(checkDfmTool({ svg, device: "falcon-10w" }).passed, true);
    assert.equal(checkInputSchema.safeParse({ svg: "" }).success, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("SSE 端点提供可审计事件和完成信号", async () => {
  const originalKey=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY="sk-placeholder-replace-me";
  try {
    const response = await GET(new Request("http://localhost/api/events?city=Edinburgh"));
    const body = await response.text();
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.match(body, /query_star_map/);
    assert.match(body, /event: craft/);
    assert.match(body, /event: result/);
    assert.match(body, /event: done/);
    assert.doesNotMatch(body, /chain.of.thought|思维链/i);
  } finally { if(originalKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=originalKey; }
});

test("分享卡不包含门牌，脱敏函数屏蔽数字", () => {
  assert.equal(maskAddress("12A George Street"), "••• George Street");
  const card = shareCardSvg({ city: "爱丁堡", poem: "旧城的风把星光折进归途", stars: [] });
  assert.doesNotMatch(card, /George|12A/);
  assert.match(card, /1080" height="1920/);
});

test("DeepSeek 占位 key 不发网络请求并返回离线文案", async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "sk-placeholder-replace-me";
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("不应调用"); };
  try {
    const response = await POST(new Request("http://localhost/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: "edinburgh", date: "2023-06-01", tags: ["星空"], message: "仍记得那晚的风", address: "12A George Street" }) }));
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(called, false);
    assert.match(body, /event: content/);
    assert.match(body, /\"source\":\"offline\"/);
    assert.doesNotMatch(body, /12A|George Street|placeholder-replace/);
    assert.match(body, /event: done/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("DeepSeek ReAct 成功响应只选择工具和文案且不接收制造几何", async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "sk-test-key";
  const providerBodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const raw = String(init?.body ?? "");
    providerBodies.push(raw);
    const request = JSON.parse(raw) as { messages: { content: string }[] };
    const context = JSON.parse(request.messages[1].content) as { available_tools: string[] };
    const tool = context.available_tools[0];
    const action = { tool, decision: `调用 ${tool} 获取客观结果`, ...(tool === "write_poem" ? { content: { poem: ["风把旧城折进星光", "The wind folds the old town into starlight."], summary: "一段关于爱丁堡星空的克制回忆" } } : {}) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await POST(new Request("http://localhost/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: "edinburgh", date: "2023-06-01", tags: ["星空", "雪"], message: "还记得那晚的风" }) }));
    const body = await response.text();
    assert.match(body, /\"source\":\"deepseek\"/);
    assert.match(body, /风把旧城折进星光/);
    assert.match(body, /\"planner\":\"deepseek\"/);
    assert.match(body, /event: craft/);
    assert.match(body, /event: done/);
    assert.ok(providerBodies.length <= 2);
    assert.ok(providerBodies.every((value) => !/\"stars\"|\"radius\"|\"sizeMm\"|\"svg\"|\"dxf\"|\"address\"/i.test(value)));
    assert.ok(providerBodies.some((value) => value.includes("还记得那晚的风")));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("DeepSeek 非法结构不会覆盖可信离线内容", () => {
  const city = queryStarMap({ city: "edinburgh", date: "2023-06-01" }).city;
  const fallback = fallbackContent(city, "2023-06-01");
  assert.deepEqual(parseGeneratedContent("not-json", fallback), fallback);
  assert.deepEqual(parseGeneratedContent({ poem: ["only one"], summary: "x" }, fallback), fallback);
});
