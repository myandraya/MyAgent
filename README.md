# 拾刻 Shike · 第二故乡

> 情绪交给 AI，几何交给算法。

首页是一张铺满全屏的世界地图：鼠标移到哪，地图就在那里亮起一圈柔和蓝光，移开熄灭。两个等价入口各对应一条「记忆 → 可制造矢量」的链路：

- **说一句那座城**：DeepSeek 标准化任意城市，Wikimedia 检索真实地标候选，DeepSeek 选单一场景给 Qwen-Image 视觉锚点，Potrace 矢量化后按切穿/划线/雕刻三层输出可制造 SVG；未配置图像 API 时降级到参数化天际线。
- **刻下一张照片**：Qwen 主体提取 + Potrace 镂空矢量化，本地 Otsu/连通域兜底，输出激光镂空 SVG。

界面遵循 Apple 流体交互：毛玻璃材质、弹簧物理按压回弹、生成结果逐笔描画揭示、下载成功弹跳、错误抖动入场。顶栏右上角「中 / EN」一键切换中英双语；结果区「分享到小红书」一键生成 PNG（canvas 原生重画 SVG，不 taint）+ 带话题文案。

## 本地运行

要求 Node.js 22.18+（验证环境 Node 24.19.0）。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。`.env.local` 当前仅含可识别占位 key，会自动走离线兜底。接入真实 DeepSeek 时仅在本地替换：

```dotenv
DEEPSEEK_API_KEY=sk-your-real-key
DEEPSEEK_MODEL=deepseek-flash
```

可选：启用 AI 城市景观图像生成（阿里云百炼 Qwen-Image，DashScope 原生接口）：

```dotenv
DASHSCOPE_API_KEY=sk-your-dashscope-key
DASHSCOPE_WORKSPACE_ID=your-workspace-id  # 可选，业务空间专属域名
QWEN_IMAGE_MODEL=qwen-image-3.0           # 可选，同时用于剪影生成与照片主体提取
```

key 在 https://bailian.console.aliyun.com/ 百炼控制台获取。Qwen-Image 返回图像 URL，服务端下载后矢量化。未配置 `DASHSCOPE_API_KEY` 时，城市剪影由参数化生成器兜底，照片则使用本地 Otsu 与连通域清理。

密钥只由服务端读取，禁止添加 `NEXT_PUBLIC_`。DeepSeek 接口采用官方兼容格式：[`POST /chat/completions`](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)。

完整校验：

```bash
npm run test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
npm start
```

E2E 复用 macOS 已安装 Google Chrome，无需下载 Playwright Chromium。

## 三分钟演示路径

1. 首页背景世界地图：鼠标移动，地图跟随鼠标亮起；移开熄灭。两个等价入口同尺寸、默认同灰，悬停统一亮蓝。
2. 选「说一句那座城」，输入「我想念悉尼海港边的歌剧院」：DeepSeek 识别城市，Wikimedia 返回真实地标候选，Qwen 按单一场景与视觉锚点生成剪影，Potrace 矢量化，结果逐笔描画揭示。
3. 查看 DFM 结果，下载 SVG；或点「分享到小红书」生成 PNG + 文案。
4. 回首页选「刻下一张照片」：Qwen 提取主体（失败本地兜底），Potrace 输出镂空 SVG。

## 架构

```text
首页背景 世界地图（Natural Earth 110m） ─→ 鼠标悬停高光 ─→ 离开熄灭
入口 A 一句话 ─→ DeepSeek 标准化 ─→ Wikimedia 地标检索 ─→ DeepSeek 选景 ─→ Qwen 生成 ─→ Potrace ─┐
                                                ↓ (未配置图像 API)                                ├→ DFM → SVG → 下载 / 分享小红书
                                          参数化天际线兜底 ────────────────────────────────────────┘
入口 B 上传照片 ─→ Qwen 主体提取 ─→ Otsu/连通域兜底 ─→ Potrace ────────────────────────────────────┘
```

- `lib/design.ts`、`dfm.ts`：设计模型、检查与修复。
- `lib/photo.ts`、`lib/photo-vectorize.ts`：照片主体的闭合填充 SVG、本地二值化与连通域兜底；SVG 不嵌入原图。
- `lib/silhouette.ts`：城市剪影设计与 DFM；`lib/silhouette-generators.ts`：参数化天际线兜底；`lib/image-gen.ts`（Qwen-Image DashScope）、`lib/image-to-svg.ts`：图像生成与矢量化。
- `lib/stl.ts`、`pdf.ts`：参数化封闭灯壳网格、OpenSCAD 源和组装说明（已下线，仅保留）。
- `lib/i18n.ts`：中英双语扁平词典 + I18nContext + useI18n，覆盖在线页面全部可见字符串；顶栏切换即时生效。
- `lib/share.ts`：SVG → PNG 的 canvas 原生重画（DOMParser 解析 + Path2D，不经过 Image，规避 Safari canvas tainted）+ 文案复制。
- `data/world.geo.json`：Natural Earth 110m 国家边界 GeoJSON（251K，内联，首页背景地图数据源）。
- `lib/deepseek.ts`：服务端 JSON 调用、严格字段校验和离线兜底（scene 入口城市识别用）。
- `app/api/scene`：城市识别 + 图像生成 + 矢量化；`app/api/photo`：照片主体提取 + Potrace 镂空。
- `tests/`：Node 内置算法/格式测试；`e2e/`：Playwright 桌面与移动验证。

## 制造文件与 DFM

### SVG / DXF

- SVG `width/height` 带 `mm`，`viewBox` 同数值。
- 红 `#ff0000` 切穿，蓝 `#0000ff` 划线，黑 `#000000` 雕刻；使用分层 `<g>`。
- 切割线宽 0.08mm；修复后最小线宽 0.5mm。
- 制造标记为 `<path>`，不含 `<text>`；四角直径 2mm 对位孔。
- ASCII DXF 使用 `$INSUNITS=4`（毫米）及 `CUT_RED`、`SCORE_BLUE`、`ENGRAVE_BLACK` 层，不是改后缀 SVG。
- 城市剪影把 Potrace 复合轮廓输出为 `engraving-fill`（黑色填充、`fill-rule="evenodd"`），参数化结构线输出为 `engraving-line`；切割/填充/描线轮廓导出前逐子路径检查 `Z/z` 闭合，100×100 内容缩放到带 6mm 安全边距的 180×120mm 画布。

### 照片 SVG

PNG/JPEG/WebP（≤10MB）由浏览器统一转为 PNG 并发送至 Qwen-Image 图像编辑服务，由模型提取单一主体并清除背景；应用服务端不落盘保存原图。之后使用 Otsu 二值化与最大 8 邻域黑色连通域做确定性兜底，最后由 Potrace 生成闭合复合轮廓。模型调用失败时自动退回本地流程。SVG 以 `engraving-fill` 黑色 `evenodd` 填充表达主体和孔洞，四周保留 6mm 安全边距；下载文件不嵌入原图。

### STL / OpenSCAD / PDF

- ASCII STL 是直接生成的封闭三角网格灯壳：198×198×24mm，默认壁厚/背板 1.6mm。
- 测试检查每条网格边恰属两个三角面、包络适配 K1/K1C 220×220×250mm、壁厚 ≥1.2mm。
- 同一参数可生成 OpenSCAD `difference()` 源；Web 下载提供 STL。
- PDF 是具有有效对象表/xref 的组装说明，包含激光层顺序、切片起始建议和安全提醒。

## 设备适配

- Falcon 10W/20W+：400×415mm 工作区，项目每侧保留 15mm；参考 [Falcon 10W 官方页面](https://www.crealityfalcon.com/products/low-wattage-laser-engraver-cutter-falcon-pro-10w)。
- Falcon A1C：官方页面列出 [150×150×148mm 工作区](https://uk.crealityfalcon.com/products/creality-falcon-a1c-laser-engraver-with-ai-camera-kit)；300mm 设计会先报超幅，修复后等比缩至 120mm。
- K1/K1C：220×220×250mm、0.4mm 喷嘴；参考 [创想 K1 比较页](https://store.creality.com/eu/pages/compare)。
- 未获实机或官方材料表验证的功率/速度不编造；界面要求按材料批次做测试矩阵。

## DeepSeek 数据边界

scene 入口使用原生 `fetch` 调 DeepSeek 做城市识别与地标选择，不增加 SDK。只发送用户输入的一句城市记忆；不发送照片、地址或个人信息。结果必须通过严格 JSON 和字段校验。

- 有效响应：从服务器白名单选择城市和 1–2 个地标，供 Qwen 生成视觉锚点。
- 调用最多 6 秒；占位 key、401/429/5xx、网络错误或非法 JSON 会切到离线参数化兜底。
- 不发送完整设计或 SVG/DXF/STL；DeepSeek 只选城市和地标，不生成制造坐标。

## 需求与验证

- [逐项需求追踪](docs/requirements.md)
- [自动/人工验证状态](docs/validation.md)

## 已知限制

- 照片入口为 Qwen 主体提取 + Potrace 镂空矢量化，本地兜底为 Otsu/连通域，不含 rembg/SAM 人物抠图。
- 「分享到小红书」生成 PNG + 文案素材供手动发布；小红书无开放发布 API，无法自动发布到账号。
- 极光之夜、两城时钟扩展 SKU 未实现，也未提供伪入口。
- DeepSeek Key 已在本机完成最小请求与完整 ReAct 验证；`.env.local` 被 gitignore 排除，密钥未写入文档或日志。
- 未部署 Vercel/EdgeOne，未创建远程仓库或录屏。
- LightBurn、Falcon Design Space、Creality Print、OpenSCAD 尚未人工打开验证；自动格式/流形检查不等于软件或实机验证。

Content was rephrased for compliance with licensing restrictions.
