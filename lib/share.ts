// 小红书分享：SVG → PNG（小红书不支持 SVG 上传）+ 文案复制
// 小红书无开放发布 API，只能生成素材让用户手动发布
//
// 关键：不经过 Image 加载 SVG（Safari 会把 canvas 标记为 tainted，toBlob 返回 null），
// 而是用 DOMParser 解析 SVG DOM，用 Path2D 在 canvas 上原生重画——100% 不 taint，跨浏览器稳。

type Ctx = { fill: string; stroke: string; strokeWidth: number; fillRule: "evenodd" | "nonzero"; opacity: number };

const DEF: Ctx = { fill: "black", stroke: "none", strokeWidth: 0, fillRule: "nonzero", opacity: 1 };

/** 渐变定义（按 id 索引），用于解析 fill="url(#id)"。 */
type Gradient = { stops: [number, string][] };

/** 把 fill/stroke 里的 url(#id) 渐变引用解析成纯色（取最接近中点的 stop）。 */
function resolvePaint(paint: string, gradients: Record<string, Gradient>): string {
  const m = paint.match(/^url\(["']?#([^)"']+)["']?\)$/);
  if (!m) return paint;
  const g = gradients[m[1]];
  if (!g || !g.stops.length) return "black";
  const mid = g.stops.reduce((a, b) => (Math.abs(b[0] - 0.5) < Math.abs(a[0] - 0.5) ? b : a));
  return mid[1];
}

/** 解析 transform 字符串，应用到 canvas context（支持 translate/scale/matrix/rotate） */
function applyTransform(ctx: CanvasRenderingContext2D, tf: string) {
  const re = /(translate|scale|rotate|matrix)\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tf))) {
    const a = m[2].split(/[\s,]+/).map(Number);
    switch (m[1]) {
      case "translate": ctx.translate(a[0] || 0, a[1] || 0); break;
      case "scale": ctx.scale(a[0] ?? 1, a[1] ?? a[0] ?? 1); break;
      case "rotate": ctx.rotate(((a[0] || 0) * Math.PI) / 180); break;
      case "matrix": ctx.transform(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    }
  }
}

/** 解析 points 字符串 → [x,y,...] */
function pts(s: string): number[] { return (s.match(/-?[\d.]+/g) || []).map(Number); }

/** 继承样式：子元素属性覆盖父 */
function inherit(el: Element, parent: Ctx): Ctx {
  const c = { ...parent };
  const f = el.getAttribute("fill"); if (f) c.fill = f;
  const s = el.getAttribute("stroke"); if (s) c.stroke = s;
  const sw = el.getAttribute("stroke-width"); if (sw) c.strokeWidth = parseFloat(sw);
  const fr = el.getAttribute("fill-rule"); if (fr === "evenodd" || fr === "nonzero") c.fillRule = fr;
  const o = el.getAttribute("opacity"); if (o) c.opacity = parseFloat(o);
  return c;
}

/** 构建 canvas font 字符串（剔除 -apple-system 等画布不识别的族名）。 */
function canvasFont(el: Element, sizeFallback = 16): string {
  const size = parseFloat(el.getAttribute("font-size") || "") || sizeFallback;
  const weight = el.getAttribute("font-weight") || "400";
  return `${weight} ${size}px "Helvetica Neue", "PingFang SC", Arial, sans-serif`;
}

/** 渲染 <text>（含 <tspan> 子元素），支持 text-anchor 与逐段样式。 */
function renderText(ctx: CanvasRenderingContext2D, el: Element, style: Ctx, gradients: Record<string, Gradient>) {
  const x = parseFloat(el.getAttribute("x") || "") || 0;
  const y = parseFloat(el.getAttribute("y") || "") || 0;
  const anchor = el.getAttribute("text-anchor") || "start";
  const runs: { text: string; font: string; fill: string }[] = [];
  const tspans = Array.from(el.children).filter((c) => c.tagName === "tspan");
  if (tspans.length) {
    for (const ts of tspans) {
      const text = ts.textContent || "";
      if (!text) continue;
      runs.push({ text, font: canvasFont(ts, parseFloat(el.getAttribute("font-size") || "") || 16), fill: resolvePaint(ts.getAttribute("fill") || style.fill, gradients) });
    }
  } else {
    const text = el.textContent || "";
    if (!text) return;
    runs.push({ text, font: canvasFont(el), fill: resolvePaint(style.fill, gradients) });
  }
  const totalWidth = runs.reduce((w, r) => w + ctx.measureText(r.text).width, 0);
  // 先用第一段的 font 统一测量宽度（同一 text 内字号通常一致，误差可忽略）
  let cursor = anchor === "middle" ? x - totalWidth / 2 : anchor === "end" ? x - totalWidth : x;
  ctx.textBaseline = "alphabetic";
  for (const r of runs) {
    ctx.font = r.font;
    ctx.fillStyle = r.fill;
    ctx.fillText(r.text, cursor, y);
    cursor += ctx.measureText(r.text).width;
  }
}

/** 递归渲染一个元素到 canvas */
function renderEl(ctx: CanvasRenderingContext2D, el: Element, style: Ctx, gradients: Record<string, Gradient>) {
  const st = inherit(el, style);
  ctx.save();
  const tf = el.getAttribute("transform"); if (tf) applyTransform(ctx, tf);
  ctx.globalAlpha *= st.opacity;
  const tag = el.tagName;
  if (tag === "g") { for (const c of Array.from(el.children)) renderEl(ctx, c, st, gradients); }
  else if (tag === "text") { renderText(ctx, el, st, gradients); }
  else if (tag === "path") {
    const d = el.getAttribute("d"); if (!d) { ctx.restore(); return; }
    const p = new Path2D(d);
    const fill = resolvePaint(st.fill, gradients), stroke = resolvePaint(st.stroke, gradients);
    if (fill !== "none") { ctx.fillStyle = fill; ctx.fill(p, st.fillRule); }
    if (stroke !== "none") { ctx.strokeStyle = stroke; ctx.lineWidth = st.strokeWidth; ctx.stroke(p); }
  } else if (tag === "rect") {
    const x = +(el.getAttribute("x") || 0), y = +(el.getAttribute("y") || 0);
    const w = +(el.getAttribute("width") || 0), h = +(el.getAttribute("height") || 0);
    const rx = +(el.getAttribute("rx") || 0);
    const p = new Path2D(); if (rx) p.roundRect(x, y, w, h, rx); else p.rect(x, y, w, h);
    const fill = resolvePaint(st.fill, gradients), stroke = resolvePaint(st.stroke, gradients);
    if (fill !== "none") { ctx.fillStyle = fill; ctx.fill(p, st.fillRule); }
    if (stroke !== "none") { ctx.strokeStyle = stroke; ctx.lineWidth = st.strokeWidth; ctx.stroke(p); }
  } else if (tag === "circle") {
    const cx = +(el.getAttribute("cx") || 0), cy = +(el.getAttribute("cy") || 0), r = +(el.getAttribute("r") || 0);
    const p = new Path2D(); p.arc(cx, cy, r, 0, Math.PI * 2);
    const fill = resolvePaint(st.fill, gradients), stroke = resolvePaint(st.stroke, gradients);
    if (fill !== "none") { ctx.fillStyle = fill; ctx.fill(p, st.fillRule); }
    if (stroke !== "none") { ctx.strokeStyle = stroke; ctx.lineWidth = st.strokeWidth; ctx.stroke(p); }
  } else if (tag === "line") {
    const x1 = +(el.getAttribute("x1") || 0), y1 = +(el.getAttribute("y1") || 0);
    const x2 = +(el.getAttribute("x2") || 0), y2 = +(el.getAttribute("y2") || 0);
    const p = new Path2D(); p.moveTo(x1, y1); p.lineTo(x2, y2);
    const stroke = resolvePaint(st.stroke, gradients);
    if (stroke !== "none") { ctx.strokeStyle = stroke; ctx.lineWidth = st.strokeWidth; ctx.stroke(p); }
  } else if (tag === "polygon" || tag === "polyline") {
    const a = pts(el.getAttribute("points") || ""); const p = new Path2D();
    for (let i = 0; i + 1 < a.length; i += 2) { if (i === 0) p.moveTo(a[i], a[i + 1]); else p.lineTo(a[i], a[i + 1]); }
    if (tag === "polygon") p.closePath();
    const fill = resolvePaint(st.fill, gradients), stroke = resolvePaint(st.stroke, gradients);
    if (fill !== "none" && tag === "polygon") { ctx.fillStyle = fill; ctx.fill(p, st.fillRule); }
    if (stroke !== "none") { ctx.strokeStyle = stroke; ctx.lineWidth = st.strokeWidth; ctx.stroke(p); }
  }
  ctx.restore();
}

/** 从 SVG 字符串解析 viewBox 和根尺寸 */
function svgBox(svg: string): { vb: number[]; w: number; h: number } {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    const vba = (root.getAttribute("viewBox") || root.getAttribute("viewbox") || "0 0 800 600").split(/[\s,]+/).map(Number);
    const w = parseFloat((root.getAttribute("width") || "").replace(/[a-z]+$/i, "")) || vba[2];
    const h = parseFloat((root.getAttribute("height") || "").replace(/[a-z]+$/i, "")) || vba[3];
    return { vb: vba.length === 4 ? vba : [0, 0, w, h], w, h };
  } catch { return { vb: [0, 0, 800, 600], w: 800, h: 600 }; }
}

/** SVG 字符串 → PNG Blob（小红书要 PNG，scale 控制清晰度，默认 2x，白底不透明） */
export function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { vb, w, h } = svgBox(svg);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("ERR_NO_CANVAS")); return; }
    // 白底（小红书 PNG 要不透明背景）
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // viewBox 坐标系映射到 canvas
    ctx.scale(canvas.width / vb[2], canvas.height / vb[3]);
    ctx.translate(-vb[0], -vb[1]);
    // 解析 <linearGradient>/<radialGradient> 定义（fill="url(#id)" 引用）
    const gradients: Record<string, Gradient> = {};
    root.querySelectorAll("linearGradient, radialGradient").forEach((g) => {
      const stops = Array.from(g.querySelectorAll("stop")).map((s) => {
        const off = parseFloat(s.getAttribute("offset") || "0") / (s.getAttribute("offset")?.includes("%") ? 100 : 1);
        return [Number.isFinite(off) ? off : 0, s.getAttribute("stop-color") || "#000"] as [number, string];
      });
      const id = g.getAttribute("id");
      if (id) gradients[id] = { stops };
    });
    // 递归重画所有子元素（根 svg 本身的样式作为顶层继承）
    const top = inherit(root, DEF);
    for (const c of Array.from(root.children)) renderEl(ctx, c, top, gradients);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ERR_PNG_CONVERT"))), "image/png");
  });
}

/** 复制文案到剪贴板，降级用 textarea + execCommand（非安全上下文兜底） */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fallthrough */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
}
