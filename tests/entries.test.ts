import assert from "node:assert/strict";
import test from "node:test";
import { POST as scenePost } from "../app/api/scene/route.ts";
import { POST as photoPost } from "../app/api/photo/route.ts";
import { checkPhotoDfm, createHalftoneDesign, generatePhotoSvg, checkHollowPhotoDfm, generateHollowPhotoSvg, type HollowPhotoDesign } from "../lib/photo.ts";
import { checkSilhouetteDfm, composeSilhouetteSelection, generateSilhouetteSvg, hasOnlyClosedSubpaths, computeMergedMaterial } from "../lib/silhouette.ts";
import { computeCityNameLayout } from "../lib/text-path.ts";
import { simplifyRdp, rasterToSvgPathMulti } from "../lib/image-to-svg.ts";
import { potraceVectorize, potraceVectorizeMulti, cleanLinePath } from "../lib/potrace-vectorize.ts";
import { keepLargestForegroundComponent } from "../lib/photo-vectorize.ts";
import { PNG } from "pngjs";

function checkerboard(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const value = (x + y) % 2 ? 30 : 230;
    data.set([value, value, value, 255], offset);
  }
  return { width, height, data };
}

test("照片像素确定性转换为真实毫米半调 SVG", () => {
  const first = createHalftoneDesign(checkerboard(48, 32));
  const second = createHalftoneDesign(checkerboard(48, 32));
  assert.deepEqual(first, second);
  assert.ok(first.dots.length > 100);
  assert.ok(first.dots.every((dot) => dot.radius * 2 >= 0.5));
  assert.equal(checkPhotoDfm(first).passed, true);
  const svg = generatePhotoSvg(first);
  assert.match(svg, /width="180mm"/);
  assert.doesNotMatch(svg, /id="cut-through"|stroke="#ff0000"|id="vector-score"/, "无红色外框/蓝色 score 层");
  assert.match(svg, /id="engrave-layer"[\s\S]*#000000/);
  assert.doesNotMatch(svg, /<image|data:image/);
});

test("照片输入边界拒绝损坏像素和超幅尺寸", () => {
  assert.throws(() => createHalftoneDesign({ width: 10, height: 10, data: [] }), /无效/);
  assert.throws(() => createHalftoneDesign(checkerboard(10, 10), 400), /80\.\.360/);
});

test("任意城市名可构造剪影设计且结果可重复", () => {
  const paris = composeSilhouetteSelection(
    "巴黎", ["埃菲尔铁塔"], "2023-06-01", [],
    { cutPaths: [], scorePaths: [], engravePaths: [], fillPaths: ["M10 10L90 10L90 90L10 90Z"] },
  );
  assert.equal(checkSilhouetteDfm(paris).passed, true);
  const svg = generateSilhouetteSvg(paris);
  // 统一尺寸 120×180mm（竖版）
  assert.match(svg, /width="120mm" height="180mm"/);
  assert.match(svg, /viewBox="0 0 120 180"/);
  // 填充雕刻层黑色 evenodd
  assert.match(svg, /id="engrave-layer"[^>]*fill="#000000"[^>]*fill-rule="evenodd"/);
  assert.doesNotMatch(svg, /<text\b/);
  assert.deepEqual(composeSilhouetteSelection("巴黎", ["埃菲尔铁塔"], "2023-06-01", [], { fillPaths: ["M10 10L90 10L90 90L10 90Z"] }), paris);
});

test("SVG 填充雕刻层：engrave-layer + evenodd", () => {
  const design = composeSilhouetteSelection(
    "京都", ["清水寺"], "2023-06-01", [],
    { cutPaths: [], scorePaths: [], engravePaths: [], fillPaths: ["M10 10L90 10L90 90L10 90ZM30 30L70 30L70 70L30 70Z"] },
  );
  const svg = generateSilhouetteSvg(design);
  // 无红色切穿层
  assert.doesNotMatch(svg, /id="cut-through"|stroke="#ff0000"/, "不再有红色切穿层");
  // 填充雕刻层黑色 evenodd
  assert.match(svg, /id="engrave-layer"[^>]*fill="#000000"[^>]*fill-rule="evenodd"/);
  assert.doesNotMatch(svg, /id="vector-score"/);
});

test("RDP 简化减少点数且保留首尾", () => {
  const points = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i * 0.2) * 20 + 50 }));
  const simplified = simplifyRdp(points, 5);
  assert.ok(simplified.length < points.length);
  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified[simplified.length - 1], points[points.length - 1]);
});

test("cleanLinePath 显式闭合 + 去重 + 丢弃碎片", () => {
  // 含：未闭合子路径 + 完全相同子路径 + 过短碎片
  const dirty = "M10 10L20 20L30 10 M5 5L15 5L15 15L5 15Z M10 10L20 20L30 10 MABC";
  const cleaned = cleanLinePath(dirty);
  // 第一个 M10 10L20 20L30 10 应被补 Z 闭合
  assert.match(cleaned, /M10 10L20 20L30 10Z/, "未闭合子路径应补 Z");
  // 完全相同的第二个 M10 10L20 20L30 10 应被去重
  const occurrences = (cleaned.match(/M10 10L20 20L30 10Z/g) ?? []).length;
  assert.equal(occurrences, 1, `去重后只保留 1 个相同子路径，实际 ${occurrences}`);
  // 过短碎片 MABC（仅 4 字符）应被丢弃
  assert.doesNotMatch(cleaned, /MABC/, "过短子路径应丢弃");
});

test("Potrace 复合轮廓按闭合填充雕刻导出，材料合并为单一整体（§7.2）", () => {
  const compound = "M10 10L90 10L90 90L10 90ZM30 30L70 30L70 70L30 70Z";
  const design = composeSilhouetteSelection(
    "京都", ["清水寺"], "2023-06-01", [],
    { cutPaths: [], scorePaths: [], engravePaths: [], fillPaths: [compound] },
  );
  assert.equal(hasOnlyClosedSubpaths(compound), true);
  assert.equal(checkSilhouetteDfm(design).passed, true);
  const svg = generateSilhouetteSvg(design);
  assert.match(svg, /id="engrave-layer"[^>]*fill="#000000"[^>]*fill-rule="evenodd"[^>]*stroke="none"/);
  // §7.2 材料布尔合并：相框+横条+建筑焊接成单一 <path>（含外轮廓与内孔），
  // 不再有独立的建筑 transform 或独立横条元素（内部重叠边已消失）。
  const merged = computeMergedMaterial(design);
  assert.ok(merged.length > 0, "应产出合并后的材料路径");
  // 合并结果应包含：相框外沿（6..114 / 6..174）与建筑内孔（建筑等比缩放、底部坐线 y=130）。
  assert.match(merged, /M6 6L114 6L114 174L6 174L6 6Z/, "相框外沿应保留");
  assert.match(svg, new RegExp(merged.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "SVG 应使用合并后的单一材料路径");
  // 建筑等比缩放（scale=1.275）、底部压线 y=130+1.2（buildingOverlap，压进横条咬合）：
  //   30*1.275-3.75=34.5, 70*1.275-3.75=85.5；translateY=131.2-90*1.275=16.45 → 30*1.275+16.45=54.7, 70*1.275+16.45=105.7。
  assert.match(merged, /M34\.5 54\.7L34\.5 105\.7L85\.5 105\.7L85\.5 54\.7L34\.5 54\.7Z/, "建筑内孔应按等比缩放正确映射（证明不变形 + 底部压线咬合）");
  // 合并后不再有独立的 scale transform（已焊接进整体）。
  assert.doesNotMatch(svg, /scale\(1\.275 1\.275\)/, "建筑不再作为独立 transform 元素存在（已合并）");
});

test("城市名字形纳入布尔合并，字母与横条/相框焊成一体（§7.2）", () => {
  // 用真实 opentype 字形 + 布局（Node 测试环境可直接加载字体）。
  const layout = computeCityNameLayout("PARIS");
  assert.ok(layout, "应能算出 PARIS 字形布局");
  const design = composeSilhouetteSelection("巴黎", ["埃菲尔铁塔"], "2023-06-01", [], {
    fillPaths: ["M20 30L80 30L80 95L20 95Z"],
    cityNameXml: "",
    cityNameText: "PARIS",
    cityNamePath: layout!.path,
    cityNameLayout: { x: layout!.x, baselineY: layout!.baselineY, glyphTopY: layout!.glyphTopY },
  });
  const merged = computeMergedMaterial(design);
  assert.ok(merged.length > 0, "应产出合并后的材料路径（含字形）");
  // 字形 path（基线原点、y 向下为正）不应以原始负 y 坐标残留（已映射到画布坐标）。
  assert.doesNotMatch(merged, /-\d/, "字形不应残留负 y 坐标（已映射到画布）");
  // 合并结果中应包含字母内孔（P/A/R 的封闭圈），证明字形已参与合并。
  // 字形应焊进整体，而非独立 <g> 输出。
  const svg = generateSilhouetteSvg(design);
  assert.doesNotMatch(svg, /id="engraving-text"/, "合并后字形不再作为独立 <g> 输出");
  assert.match(svg, new RegExp(merged.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "SVG 应使用含字形的合并材料路径");
});

test("剪影 DFM 拒绝未闭合的切割或雕刻轮廓", () => {
  const design = composeSilhouetteSelection(
    "京都", ["清水寺"], "2023-06-01", [],
    { cutPaths: [], scorePaths: [], engravePaths: [], fillPaths: ["M10 10L90 10L90 90"] },
  );
  const report = checkSilhouetteDfm(design);
  assert.equal(hasOnlyClosedSubpaths("M10 10L90 10L90 90"), false);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((issue) => issue.code === "OPEN_PATH"));
});

test("轮廓去重只删除完全重复项，不误删相同起点的不同孔洞", () => {
  const first = "M10 10L20 10L20 20L10 20Z";
  const second = "M10 10L20 10L20 30L10 30Z";
  const cleaned = cleanLinePath(`${first} ${second}`);
  assert.match(cleaned, new RegExp(first));
  assert.match(cleaned, new RegExp(second));
});

test("手写多轮廓矢量化能从含镂空的图像中提取外轮廓 + 孔洞（deprecated 但保留）", () => {
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const idx = (y * 32 + x) * 4;
      const isHole = x >= 12 && x <= 20 && y >= 12 && y <= 20;
      const val = isHole ? 255 : 0;
      png.data[idx] = val;
      png.data[idx + 1] = val;
      png.data[idx + 2] = val;
      png.data[idx + 3] = 255;
    }
  }
  const buffer = PNG.sync.write(png);
  const base64 = buffer.toString("base64");
  const { contours } = rasterToSvgPathMulti(base64, { rdpEpsilon: 1.0 });
  const outers = contours.filter(c => c.kind === "outer");
  const holes = contours.filter(c => c.kind === "hole");
  assert.ok(outers.length >= 1, `至少 1 个外轮廓，实际 ${outers.length}`);
  assert.ok(holes.length >= 1, `至少 1 个孔洞，实际 ${holes.length}`);
  assert.ok(outers[0].pointCount >= 4, "外轮廓点数足够");
  assert.ok(holes[0].pointCount >= 4, "孔洞点数足够");
});

test("Potrace 能从含镂空的 PNG 提取复合 path（含外轮廓 + 孔洞，坐标系缩放到 0..100）", async () => {
  // 构造 64x64 黑色背景 + 中心 16x16 白色孔洞
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const idx = (y * 64 + x) * 4;
      const isHole = x >= 24 && x <= 40 && y >= 24 && y <= 40;
      const val = isHole ? 255 : 0;
      png.data[idx] = val;
      png.data[idx + 1] = val;
      png.data[idx + 2] = val;
      png.data[idx + 3] = 255;
    }
  }
  const buffer = PNG.sync.write(png);
  const base64 = buffer.toString("base64");
  const result = await potraceVectorize(base64, { turdSize: 2 });
  assert.ok(result.ok, "Potrace 应成功");
  assert.ok(result.path.length > 50, `path 应足够长，实际 ${result.path.length}`);
  // Potrace 用 fill-rule=evenodd，path 内含多个 M...Z 子路径
  const mCount = (result.path.match(/M/g) ?? []).length;
  assert.ok(mCount >= 2, `应至少 2 个 M（外轮廓+孔洞），实际 ${mCount}`);
  // 坐标系验证：所有坐标必须缩放到 0..100（Potrace 曲线控制点可能略超边界 ±3）
  const coords = (result.path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  assert.ok(coords.length >= 4, "坐标数量足够");
  assert.ok(coords.every((c) => c >= -3 && c <= 103), `坐标应全部在 0..100 范围内（±3 容差），实际范围 ${Math.min(...coords)}..${Math.max(...coords)}`);
  // 测试多轮廓版
  const { contours } = await potraceVectorizeMulti(base64, { turdSize: 2 });
  assert.ok(contours.length >= 2, `多轮廓版应至少 2 个 contour，实际 ${contours.length}`);
});

test("占位 key 下不调用网络并返回明确错误（不再降级到参数化兜底）", async () => {
  const originalKey=process.env.DEEPSEEK_API_KEY, originalFetch=globalThis.fetch;
  process.env.DEEPSEEK_API_KEY="sk-placeholder-replace-me";
  let called=false; globalThis.fetch=async()=>{called=true;throw new Error("unexpected")};
  try {
    const response=await scenePost(new Request("http://localhost/api/scene",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"我想念悉尼歌剧院"})}));
    const result=await response.json() as {error?:string};
    assert.equal(called,false);
    assert.equal(response.status,502);
    assert.ok(result.error);
  } finally { globalThis.fetch=originalFetch; if(originalKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=originalKey; }
});

test("DeepSeek 识别任意城市但无图像 key 时返回明确错误", async () => {
  const originalKey=process.env.DEEPSEEK_API_KEY, originalFetch=globalThis.fetch;
  process.env.DEEPSEEK_API_KEY="sk-test-key";
  // mock fetch：DeepSeek 返回 JSON，但 image-gen 未配置 → 应返回 502 错误而非 offline 兜底
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({city:"京都",landmark:"清水寺"})}}]}),{status:200});
  try {
    const response=await scenePost(new Request("http://localhost/api/scene",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"秋天走过京都的寺院"})}));
    const result=await response.json() as {error?:string};
    assert.equal(response.status,502);
    assert.ok(result.error);
  } finally { globalThis.fetch=originalFetch; if(originalKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=originalKey; }
});

test("只输入南安普顿时，检索真实地标并把视觉锚点交给 Qwen", async () => {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    const i = (y * 64 + x) * 4;
    const hole = x >= 24 && x <= 40 && y >= 24 && y <= 40;
    const value = hole ? 255 : 0;
    png.data[i] = value; png.data[i + 1] = value; png.data[i + 2] = value; png.data[i + 3] = 255;
  }
  const outputImage = PNG.sync.write(png);
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const originalDashscopeKey = process.env.DASHSCOPE_API_KEY;
  const originalModel = process.env.QWEN_IMAGE_MODEL;
  const originalFetch = globalThis.fetch;
  let deepSeekCalls = 0;
  process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
  process.env.DASHSCOPE_API_KEY = "sk-test-dashscope";
  process.env.QWEN_IMAGE_MODEL = "qwen-image-3.0";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("api.deepseek.com")) {
      deepSeekCalls += 1;
      if (deepSeekCalls === 1) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ city: "南安普顿", cityEn: "Southampton", country: "United Kingdom", explicitLandmark: "", subjectType: "city" }) } }] });
      }
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const selectionInput = JSON.parse(body.messages[1].content) as { candidates: { title: string }[] };
      assert.ok(selectionInput.candidates.some((candidate) => candidate.title === "Bargate"));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ landmark: "巴盖特城门", landmarkEn: "Bargate", subjectType: "city", visualAnchors: ["medieval stone gatehouse", "central archway", "crenellated parapet"] }) } }] });
    }
    if (url.includes("wikipedia.org")) {
      return Response.json({ query: { search: url.includes("en.wikipedia") ? [{ title: "Bargate", snippet: "Medieval gatehouse in Southampton with a central arch and battlements." }] : [] } });
    }
    if (url.includes("multimodal-generation")) {
      const body = JSON.parse(String(init?.body)) as { input: { messages: { content: { text?: string }[] }[] } };
      const qwenPrompt = body.input.messages[0].content[0].text ?? "";
      assert.match(qwenPrompt, /Bargate/);
      assert.match(qwenPrompt, /Southampton/);
      assert.match(qwenPrompt, /medieval stone gatehouse/);
      return Response.json({ output: { choices: [{ message: { content: [{ image: "https://example.test/bargate.png" }] } }] } });
    }
    return new Response(new Uint8Array(outputImage), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  try {
    const response = await scenePost(new Request("http://localhost/api/scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "南安普顿" }) }));
    const result = await response.json() as { source: string; landmark: string; fillPaths: string[] };
    assert.equal(response.status, 200);
    assert.equal(result.source, "image-gen");
    assert.equal(result.landmark, "巴盖特城门");
    assert.ok(result.fillPaths.length > 0);
    assert.equal(deepSeekCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    if (originalDashscopeKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = originalDashscopeKey;
    if (originalModel === undefined) delete process.env.QWEN_IMAGE_MODEL; else process.env.QWEN_IMAGE_MODEL = originalModel;
  }
});

test("场景 ReAct Agent 最多让 DeepSeek 修订 3 轮，再且只调用一次 Qwen 生图", async () => {
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 32 + x) * 4;
    const value = x > 6 && x < 26 && y > 6 && y < 26 ? 0 : 255;
    png.data[i] = value; png.data[i + 1] = value; png.data[i + 2] = value; png.data[i + 3] = 255;
  }
  const image = PNG.sync.write(png);
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const originalDashscopeKey = process.env.DASHSCOPE_API_KEY;
  const originalFetch = globalThis.fetch;
  let deepSeekCalls = 0;
  let qwenCalls = 0;
  let qwenAfterRound = 0;
  process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
  process.env.DASHSCOPE_API_KEY = "sk-test-dashscope";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.deepseek.com")) {
      deepSeekCalls += 1;
      const final = deepSeekCalls === 3;
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        action: final ? "finish" : deepSeekCalls === 1 ? "search_landmarks" : "revise_brief",
        decision: final ? "简报完整，提交生图。" : "继续校对可视特征。",
        brief: {
          city: "南安普顿", cityEn: "Southampton", country: "United Kingdom", explicitLandmark: "",
          landmark: "巴盖特城门", landmarkEn: "Bargate", subjectType: "city",
          visualAnchors: final ? ["central stone archway", "crenellated parapet"] : ["central stone archway"],
          composition: "A centered frontal view of the single medieval gatehouse.",
        },
      }) } }] });
    }
    if (url.includes("wikipedia.org")) return Response.json({ query: { search: [{ title: "Bargate", snippet: "Medieval gatehouse in Southampton." }] } });
    if (url.includes("multimodal-generation")) {
      qwenCalls += 1;
      qwenAfterRound = deepSeekCalls;
      return Response.json({ output: { choices: [{ message: { content: [{ image: "https://example.test/react.png" }] } }] } });
    }
    return new Response(new Uint8Array(image), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  try {
    const response = await scenePost(new Request("http://localhost/api/scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "南安普顿" }) }));
    const result = await response.json() as { source: string; agent?: { rounds: number; status: string; events: unknown[] } };
    assert.equal(result.source, "image-gen");
    assert.equal(deepSeekCalls, 3);
    assert.equal(qwenCalls, 1);
    assert.equal(qwenAfterRound, 3, "Qwen 必须在 DeepSeek 修订完成后才调用");
    assert.equal(result.agent?.rounds, 3);
    assert.equal(result.agent?.status, "completed");
    assert.equal(result.agent?.events.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    if (originalDashscopeKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = originalDashscopeKey;
  }
});

test("/api/photo 接收 PNG 上传并返回 Potrace 镂空 path（0..100 坐标系）", async () => {
  // 构造 64x64 黑色背景 + 中心 16x16 白色孔洞
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const idx = (y * 64 + x) * 4;
      const isHole = x >= 24 && x <= 40 && y >= 24 && y <= 40;
      const val = isHole ? 255 : 0;
      png.data[idx] = val; png.data[idx + 1] = val; png.data[idx + 2] = val; png.data[idx + 3] = 255;
    }
  }
  const buffer = PNG.sync.write(png);
  const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
  const formData = new FormData();
  formData.append("photo", blob, "test.png");
  const request = new Request("http://localhost/api/photo", { method: "POST", body: formData });
  const response = await photoPost(request);
  assert.equal(response.status, 200);
  const result = await response.json() as { ok: boolean; cutPath: string; widthMm: number; heightMm: number };
  assert.equal(result.ok, true);
  assert.ok(result.cutPath.length > 50, `cutPath 应足够长，实际 ${result.cutPath.length}`);
  // 坐标系验证：所有坐标应在 0..100 范围内（±3 容差）
  const coords = (result.cutPath.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  assert.ok(coords.length >= 4, "坐标数量足够");
  assert.ok(coords.every((c) => c >= -3 && c <= 103), `坐标应全部在 0..100 范围内（±3 容差），实际范围 ${Math.min(...coords)}..${Math.max(...coords)}`);
});

test("照片矢量化删除与主体断开的黑色孤岛", () => {
  const width = 8;
  const height = 6;
  const foreground = new Uint8Array(width * height);
  // 右下 3×3 主体。
  for (let y = 2; y <= 4; y += 1) for (let x = 4; x <= 6; x += 1) foreground[y * width + x] = 1;
  // 左上两个相连但与主体断开的黑点。
  foreground[1 * width + 1] = 1;
  foreground[1 * width + 2] = 1;
  const kept = keepLargestForegroundComponent(foreground, width, height);
  assert.equal(kept[1 * width + 1], 0);
  assert.equal(kept[1 * width + 2], 0);
  assert.equal(kept[3 * width + 5], 1);
  assert.equal(kept.reduce((sum, value) => sum + value, 0), 9);
});

test("/api/photo 先调用 Qwen 图像编辑提取主体，再执行 Potrace", async () => {
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 32 + x) * 4;
    const inside = x >= 6 && x <= 25 && y >= 6 && y <= 25;
    const hole = x >= 12 && x <= 19 && y >= 12 && y <= 19;
    const value = inside && !hole ? 0 : 255;
    png.data[i] = value; png.data[i + 1] = value; png.data[i + 2] = value; png.data[i + 3] = 255;
  }
  const image = PNG.sync.write(png);
  const formData = new FormData();
  formData.append("photo", new Blob([new Uint8Array(image)], { type: "image/png" }), "subject.png");
  const originalKey = process.env.DASHSCOPE_API_KEY;
  const originalModel = process.env.QWEN_IMAGE_MODEL;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.DASHSCOPE_API_KEY = "sk-test-qwen";
  process.env.QWEN_IMAGE_MODEL = "qwen-image-3.0";
  globalThis.fetch = async (input, init) => {
    calls += 1;
    if (String(input).includes("multimodal-generation")) {
      const body = JSON.parse(String(init?.body)) as { input: { messages: { content: { image?: string; text?: string }[] }[] } };
      assert.match(body.input.messages[0].content[0].image ?? "", /^data:image\/png;base64,/);
      assert.match(body.input.messages[0].content[1].text ?? "", /single most typical/);
      assert.match(body.input.messages[0].content[1].text ?? "", /one building/);
      return Response.json({ output: { choices: [{ message: { content: [{ image: "https://example.test/qwen-subject.png" }] } }] } });
    }
    return new Response(new Uint8Array(image), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  try {
    const response = await photoPost(new Request("http://localhost/api/photo", { method: "POST", body: formData }));
    const result = await response.json() as { ok: boolean; source: string; cutPath: string; holeCount: number };
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.source, "qwen");
    assert.equal(result.holeCount, 1);
    assert.ok(result.cutPath.length > 20);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.QWEN_IMAGE_MODEL; else process.env.QWEN_IMAGE_MODEL = originalModel;
  }
});

test("照片 ReAct 在首轮线条过稀疏时把审计结果反馈给 Qwen 并修复", async () => {
  // blank：全白（前景占比≈0，触发「线条过稀疏」）
  const blank = (() => {
    const png = new PNG({ width: 32, height: 32 });
    for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255; }
    return PNG.sync.write(png);
  })();
  // lines：有合理黑色笔画（边框线条），笔画占比健康
  const lines = (() => {
    const png = new PNG({ width: 32, height: 32 });
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const i = (y * 32 + x) * 4;
      const onBorder = x < 2 || x > 29 || y < 2 || y > 29;
      const onCross = (x > 14 && x < 17) || (y > 14 && y < 17);
      const value = onBorder || onCross ? 0 : 255;
      png.data[i] = value; png.data[i + 1] = value; png.data[i + 2] = value; png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  })();
  const formData = new FormData();
  formData.append("photo", new Blob([new Uint8Array(blank)], { type: "image/png" }), "subject.png");
  const originalKey = process.env.DASHSCOPE_API_KEY;
  const originalFetch = globalThis.fetch;
  let qwenCalls = 0;
  process.env.DASHSCOPE_API_KEY = "sk-test-qwen";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("multimodal-generation")) {
      qwenCalls += 1;
      const body = JSON.parse(String(init?.body)) as { input: { messages: { content: { text?: string }[] }[] } };
      const prompt = body.input.messages[0].content.find((item) => item.text)?.text ?? "";
      if (qwenCalls === 2) assert.match(prompt, /Vector audit feedback:/);
      return Response.json({ output: { choices: [{ message: { content: [{ image: `https://example.test/${qwenCalls === 1 ? "blank" : "lines"}.png` }] } }] } });
    }
    const bytes = url.includes("lines.png") ? lines : blank;
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  try {
    const response = await photoPost(new Request("http://localhost/api/photo", { method: "POST", body: formData }));
    const result = await response.json() as { ok: boolean; source: string; agent: { rounds: number; status: string; events: { action: string; observation: string }[] } };
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.source, "qwen");
    assert.equal(qwenCalls, 2);
    assert.equal(result.agent.rounds, 2);
    assert.equal(result.agent.status, "completed");
    assert.match(result.agent.events[0].observation, /稀疏|不可见/);
    assert.equal(result.agent.events[1].action, "finish");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = originalKey;
  }
});

test("/api/photo 拒绝非图片文件", async () => {
  const blob = new Blob([new Uint8Array(Buffer.from("not an image"))], { type: "text/plain" });
  const formData = new FormData();
  formData.append("photo", blob, "test.txt");
  const request = new Request("http://localhost/api/photo", { method: "POST", body: formData });
  const response = await photoPost(request);
  assert.equal(response.status, 400);
  const result = await response.json() as { error: string };
  assert.match(result.error, /PNG|JPEG|WebP/);
});

test("HollowPhotoDesign 生成闭合填充雕刻 SVG", () => {
  const design: HollowPhotoDesign = {
    widthMm: 180,
    heightMm: 120,
    cutPath: "M10 10L90 10L90 90L10 90ZM30 30L70 30L70 70L30 70Z",
    cutStrokeMm: 0.08,
    minFeatureMm: 0.6,
  };
  const svg = generateHollowPhotoSvg(design);
  // 无红色切穿外框（已对齐 MakerMuse 规范）
  assert.doesNotMatch(svg, /id="cut-through"|stroke="#ff0000"/, "无红色切穿外框");
  // Potrace 复合路径必须作为 evenodd 填充雕刻层，孔洞由子路径镂空
  assert.match(svg, /id="engrave-layer"[^>]*fill="#000000"[^>]*fill-rule="evenodd"[^>]*stroke="none"/);
  assert.match(svg, /translate\(36 6\) scale\(1\.08\)/, "雕刻内容四周应保留安全边距");
  assert.match(svg, /width="180mm"/, "宽度 180mm");
  assert.match(svg, /height="120mm"/, "高度 120mm");
  const report = checkHollowPhotoDfm(design);
  assert.equal(report.passed, true, `DFM 应通过，issues: ${JSON.stringify(report.issues)}`);
});

test("HollowPhotoDesign 拒绝空 cutPath", () => {
  const design: HollowPhotoDesign = {
    widthMm: 180,
    heightMm: 120,
    cutPath: "",
    cutStrokeMm: 0.08,
    minFeatureMm: 0.6,
  };
  const report = checkHollowPhotoDfm(design);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.code === "LINE_WIDTH"));
});

test("HollowPhotoDesign 拒绝未闭合的照片轮廓", () => {
  const design: HollowPhotoDesign = {
    widthMm: 180,
    heightMm: 120,
    cutPath: "M10 10L90 10L90 90",
    cutStrokeMm: 0.08,
    minFeatureMm: 0.6,
  };
  const report = checkHollowPhotoDfm(design);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.code === "OPEN_PATH"));
});

test("城市名排版支持横竖幅，横幅画布 180×120、文字横排", () => {
  const portrait = computeCityNameLayout("Cologne", "portrait");
  const landscape = computeCityNameLayout("Cologne", "landscape");
  assert.ok(portrait && landscape, "两种方向都应能算出布局");
  // 横幅画布更宽（180 > 120），可用宽度更大，字号应更大或至少不低于竖幅。
  assert.ok(landscape!.fontSize >= portrait!.fontSize, "横幅可用宽度更大，字号不应小于竖幅");
  // 横幅底部内沿 = 111，基线应靠近 111 附近（+overlap 1.2 压框）。
  assert.ok(landscape!.baselineY > 100 && landscape!.baselineY < 115, `横幅基线应在 111 附近，实际 ${landscape!.baselineY}`);
  // 竖幅底部内沿 = 171，基线应靠近 171。
  assert.ok(portrait!.baselineY > 165 && portrait!.baselineY < 176, `竖幅基线应在 171 附近，实际 ${portrait!.baselineY}`);
  // 方向字段回传正确。
  assert.equal(landscape!.orientation, "landscape");
  assert.equal(portrait!.orientation, "portrait");
});

test("横幅剪影 SVG 输出 180×120 viewBox 与横置相框", () => {
  const layout = computeCityNameLayout("Cologne", "landscape");
  assert.ok(layout, "应能算出横幅字形布局");
  const design = composeSilhouetteSelection("科隆", ["科隆大教堂"], "2023-06-01", [], {
    fillPaths: ["M20 20Q40 5 60 20Q80 35 85 60L85 90L20 90Z"],
    cityNameXml: "",
    cityNameText: "COLOGNE",
    cityNamePath: layout!.path,
    cityNameLayout: { x: layout!.x, baselineY: layout!.baselineY, glyphTopY: layout!.glyphTopY },
    orientation: "landscape",
  });
  const svg = generateSilhouetteSvg(design);
  assert.match(svg, /viewBox="0 0 180 120"/, "横幅应输出 180×120 viewBox");
  assert.match(svg, /width="180mm" height="120mm"/, "横幅物理尺寸 180×120mm");
  // 相框外沿：横幅 180×120，四周留 6mm → 外沿 6..174 / 6..114。
  assert.match(svg, /M6 6L174 6L174 114L6 114L6 6Z/, "横幅相框外沿应为 6..174 / 6..114");
});
