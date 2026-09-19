import assert from "node:assert/strict";
import test from "node:test";
import { POST as scenePost } from "../app/api/scene/route.ts";
import { POST as photoPost } from "../app/api/photo/route.ts";
import { checkPhotoDfm, createHalftoneDesign, generatePhotoSvg, checkHollowPhotoDfm, generateHollowPhotoSvg, type HollowPhotoDesign } from "../lib/photo.ts";
import { checkSilhouetteDfm, composeSilhouette, composeSilhouetteSelection, generateSilhouetteSvg, hasOnlyClosedSubpaths } from "../lib/silhouette.ts";
import { generateFallbackSilhouette } from "../lib/silhouette-generators.ts";
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
  assert.match(svg, /id="cut-through"[\s\S]*#ff0000/);
  assert.match(svg, /id="vector-score"[\s\S]*#0000ff/);
  assert.match(svg, /id="engraving"[\s\S]*#000000/);
  assert.doesNotMatch(svg, /<image|data:image/);
});

test("照片输入边界拒绝损坏像素和超幅尺寸", () => {
  assert.throws(() => createHalftoneDesign({ width: 10, height: 10, data: [] }), /无效/);
  assert.throws(() => createHalftoneDesign(checkerboard(10, 10), 400), /80\.\.360/);
});

test("任意城市名可生成 clean line art 单线轮廓剪影且结果可重复", () => {
  const paris = composeSilhouette("我想念巴黎铁塔下的黄昏");
  assert.equal(checkSilhouetteDfm(paris).passed, true);
  const svg = generateSilhouetteSvg(paris);
  // 统一尺寸 180×120mm
  assert.match(svg, /width="180mm" height="120mm"/);
  assert.match(svg, /viewBox="0 0 180 120"/);
  // 两层结构：红色外边框 + 黑色描线
  assert.match(svg, /id="cut-through"[^>]*stroke="#ff0000"/, "切穿层红色");
  assert.match(svg, /id="engraving-line"[^>]*stroke="#000000"[^>]*stroke-width="0.2"/, "描线层黑色 0.2mm");
  // clean line art: 所有 path 必须 fill="none"
  assert.match(svg, /fill="none"/);
  assert.doesNotMatch(svg, /fill="#000000"|fill-rule="evenodd"/, "不允许实心填充");
  // 兜底所有结构线都在 engrave 层
  assert.ok(paris.engravePaths.length >= 1, "描线层非空");
  assert.doesNotMatch(svg, /<text\b/);
  assert.deepEqual(composeSilhouette("我想念巴黎铁塔下的黄昏"), paris);
  assert.throws(() => composeSilhouette(""), /1\.\.160/);
});

test("参数化兜底生成器输出 clean line art 单线轮廓（统一在 engravePaths）", () => {
  const a = generateFallbackSilhouette("京都", "清水寺");
  const b = generateFallbackSilhouette("伊斯坦布尔", "圣索菲亚");
  // clean line art 风格下，所有结构线都在 engravePaths；cutPaths 留空（外框由 SVG 模板生成）
  assert.ok(a.engravePaths.length >= 5, `京都描线层至少 5 条，实际 ${a.engravePaths.length}`);
  assert.ok(b.engravePaths.length >= 5, `伊斯坦布尔描线层至少 5 条，实际 ${b.engravePaths.length}`);
  assert.equal(a.cutPaths.length, 0, "clean line art: cutPaths 应留空");
  assert.equal(a.scorePaths.length, 0, "clean line art: scorePaths 应留空");
  // 不同城市产出不同剪影
  assert.notEqual(a.engravePaths[0], b.engravePaths[0]);
  // 同城市可重复
  assert.deepEqual(generateFallbackSilhouette("京都", "清水寺"), a);
  const design = composeSilhouetteSelection(
    "京都", ["清水寺"], "2023-06-01", a.paths,
    { cutPaths: a.cutPaths, scorePaths: a.scorePaths, engravePaths: a.engravePaths },
  );
  assert.equal(checkSilhouetteDfm(design).passed, true);
});

test("SVG clean line art 风格：两层工艺 + fill=none", () => {
  const design = composeSilhouette("我想念京都清水寺的钟声");
  const svg = generateSilhouetteSvg(design);
  // 切穿层红色 0.08mm（仅外边框）
  assert.match(svg, /id="cut-through"[^>]*stroke="#ff0000"[^>]*stroke-width="0.08"/, "切穿层红色 0.08mm");
  // 描线层黑色 0.2mm（主体轮廓 + 结构线）
  assert.match(svg, /id="engraving-line"[^>]*stroke="#000000"[^>]*stroke-width="0.2"/, "描线层黑色 0.2mm");
  // clean line art: 所有 path 必须 fill="none"
  assert.match(svg, /fill="none"/);
  // 不再有三层结构，vector-score 已废弃
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

test("Potrace 复合轮廓按闭合填充雕刻导出，不再伪装成单线稿", () => {
  const compound = "M10 10L90 10L90 90L10 90ZM30 30L70 30L70 70L30 70Z";
  const design = composeSilhouetteSelection(
    "京都", ["清水寺"], "2023-06-01", [],
    { cutPaths: [], scorePaths: [], engravePaths: [], fillPaths: [compound] },
  );
  assert.equal(hasOnlyClosedSubpaths(compound), true);
  assert.equal(checkSilhouetteDfm(design).passed, true);
  const svg = generateSilhouetteSvg(design);
  assert.match(svg, /id="engraving-fill"[^>]*fill="#000000"[^>]*fill-rule="evenodd"[^>]*stroke="none"/);
  assert.match(svg, /translate\(6 6\) scale\(1\.68 1\.08\)/, "内容应完整落在 180×120mm 画布内");
  assert.doesNotMatch(svg, /scale\(1\.8\)/, "不得再纵向裁掉轮廓");
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

test("占位 key 下不调用网络并可靠降级到参数化镂空剪影", async () => {
  const originalKey=process.env.DEEPSEEK_API_KEY, originalFetch=globalThis.fetch;
  process.env.DEEPSEEK_API_KEY="sk-placeholder-replace-me";
  let called=false; globalThis.fetch=async()=>{called=true;throw new Error("unexpected")};
  try {
    const response=await scenePost(new Request("http://localhost/api/scene",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"我想念悉尼歌剧院"})}));
    const result=await response.json() as {city:string;landmark:string;paths:string[];cutPaths:string[];engravePaths:string[];source:string};
    assert.equal(called,false);
    assert.equal(result.source,"offline");
    assert.ok(Array.isArray(result.paths) && result.paths.length>0);
    // clean line art: 所有结构线在 engravePaths，cutPaths 留空
    assert.ok(Array.isArray(result.engravePaths) && result.engravePaths.length>=5, "描线层至少 5 条");
    assert.equal(result.cutPaths.length, 0, "clean line art: cutPaths 应留空");
    assert.ok(result.paths.every((p:string)=>typeof p==="string" && p.startsWith("M")));
  } finally { globalThis.fetch=originalFetch; if(originalKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=originalKey; }
});

test("DeepSeek 识别任意城市并返回分层 paths（无白名单）", async () => {
  const originalKey=process.env.DEEPSEEK_API_KEY, originalFetch=globalThis.fetch;
  process.env.DEEPSEEK_API_KEY="sk-test-key";
  // mock fetch：DeepSeek 返回 JSON，Qwen/Potrace 走 mock 也 OK 但图像 URL fetch 会失败 → 降级到 offline
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({city:"京都",landmark:"清水寺"})}}]}),{status:200});
  try {
    const response=await scenePost(new Request("http://localhost/api/scene",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"秋天走过京都的寺院"})}));
    const result=await response.json() as {city:string;landmark:string;paths:string[];cutPaths:string[];engravePaths:string[];source:string};
    assert.equal(result.city,"京都");
    assert.equal(result.landmark,"清水寺");
    assert.ok(Array.isArray(result.paths) && result.paths.length>0);
    // clean line art: 结构线在 engravePaths，cutPaths 留空
    assert.ok(Array.isArray(result.engravePaths) && result.engravePaths.length>=5, "描线层至少 5 条");
    assert.equal(result.cutPaths.length, 0, "cut 层应留空");
    // 因 image-gen 未配置（DASHSCOPE_API_KEY 未设），降级到 offline
    assert.equal(result.source,"offline");
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

test("场景 ReAct Agent 最多让 DeepSeek 修订 5 轮，再且只调用一次 Qwen 生图", async () => {
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
      const final = deepSeekCalls === 5;
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
    assert.equal(deepSeekCalls, 5);
    assert.equal(qwenCalls, 1);
    assert.equal(qwenAfterRound, 5, "Qwen 必须在 DeepSeek 修订完成后才调用");
    assert.equal(result.agent?.rounds, 5);
    assert.equal(result.agent?.status, "completed");
    assert.equal(result.agent?.events.length, 5);
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
      assert.match(body.input.messages[0].content[1].text ?? "", /single main subject/);
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

test("照片 ReAct 在首轮无镂空时把审计结果反馈给 Qwen 并修复", async () => {
  const makeImage = (withHole: boolean) => {
    const png = new PNG({ width: 32, height: 32 });
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const i = (y * 32 + x) * 4;
      const inside = x >= 5 && x <= 26 && y >= 5 && y <= 26;
      const hole = withHole && x >= 12 && x <= 19 && y >= 12 && y <= 19;
      const value = inside && !hole ? 0 : 255;
      png.data[i] = value; png.data[i + 1] = value; png.data[i + 2] = value; png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  };
  const solid = makeImage(false);
  const hollow = makeImage(true);
  const formData = new FormData();
  formData.append("photo", new Blob([new Uint8Array(solid)], { type: "image/png" }), "subject.png");
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
      if (qwenCalls === 2) assert.match(prompt, /Vector audit feedback:.*0/);
      return Response.json({ output: { choices: [{ message: { content: [{ image: `https://example.test/${qwenCalls === 1 ? "solid" : "hollow"}.png` }] } }] } });
    }
    const bytes = url.includes("hollow.png") ? hollow : solid;
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  try {
    const response = await photoPost(new Request("http://localhost/api/photo", { method: "POST", body: formData }));
    const result = await response.json() as { ok: boolean; source: string; holeCount: number; agent: { rounds: number; status: string; events: { action: string; observation: string }[] } };
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.source, "qwen");
    assert.equal(result.holeCount, 1);
    assert.equal(qwenCalls, 2);
    assert.equal(result.agent.rounds, 2);
    assert.equal(result.agent.status, "completed");
    assert.match(result.agent.events[0].observation, /孔洞为 0/);
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
  // 切穿层红色 0.08mm（外边框）
  assert.match(svg, /id="cut-through"[^>]*stroke="#ff0000"[^>]*stroke-width="0.08"/, "切穿层红色 0.08mm");
  // Potrace 复合路径必须作为 evenodd 填充雕刻层，孔洞由子路径镂空
  assert.match(svg, /id="engraving-fill"[^>]*fill="#000000"[^>]*fill-rule="evenodd"[^>]*stroke="none"/);
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
