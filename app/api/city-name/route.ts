import { buildCityNameXml, computeCityNameLayout } from "../../../lib/text-path.ts";

/**
 * 城市名排版 API：接收英文城市名 + 排版方向，服务端用 opentype 字体度量
 * 算出字形 path 与布局数值，供前端「生成后调整文字内容 / 横竖幅」时调用。
 *
 * 文字转字形依赖 opentype.js（需读字体文件），只能在服务端做，故单独暴露此接口；
 * 前端拿到 cityNameXml / cityNamePath / cityNameLayout 后直接替换 design 对应字段即可重渲染。
 */

export type CityNameResponse = {
  ok: boolean;
  cityNameXml?: string;
  cityNameText?: string;
  cityNamePath?: string;
  cityNameLayout?: { x: number; baselineY: number; glyphTopY: number };
  orientation?: "portrait" | "landscape";
  error?: string;
};

export async function POST(request: Request): Promise<Response> {
  let text = "";
  let orientation: "portrait" | "landscape" = "portrait";
  try {
    const body = await request.json() as { text?: unknown; orientation?: unknown };
    if (typeof body.text === "string") text = body.text.trim();
    if (body.orientation === "landscape" || body.orientation === "portrait") {
      orientation = body.orientation;
    }
  } catch {
    return Response.json({ ok: false, error: "无效请求。" }, { status: 400 });
  }

  // 只接受英文字母/空格/连字符（城市名雕刻用大写英文），限制长度防滥用。
  if (!text || !/^[A-Za-z][A-Za-z .'-]{0,39}$/.test(text)) {
    return Response.json({ ok: false, error: "请输入有效的英文城市名（仅字母、空格与连字符）。" }, { status: 400 });
  }

  const layout = computeCityNameLayout(text, orientation);
  if (!layout) {
    return Response.json({ ok: false, error: "文字排版失败，请更换名称重试。" }, { status: 422 });
  }
  const cityNameXml = buildCityNameXml(text, orientation);

  return Response.json({
    ok: true,
    cityNameXml,
    cityNameText: layout.text,
    cityNamePath: layout.path,
    cityNameLayout: { x: layout.x, baselineY: layout.baselineY, glyphTopY: layout.glyphTopY },
    orientation,
  } satisfies CityNameResponse);
}
