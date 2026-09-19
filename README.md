# 拾刻 Shike · 把一座城，刻进木头里

> 你说一句话，或传一张照片。AI 把它变成一个能真的被激光切出来的矢量稿。
> 情绪交给 AI，几何交给算法。

---

## 它在做什么

搬家的人都有一个共同的执念：**总有一座城，走的时候没能带走。**

拾刻要做的，是把这份「带不走」变成「带得走」。你不需要会画图，不需要懂激光切割，甚至不需要知道 SVG 是什么 —— 你只需要**说一句关于那座城的话**，或者**上传一张照片**。剩下的，AI 会一路想到「能制造为止」。

首页是一张铺满全屏的世界地图：鼠标移到哪，地图就在那里亮起一圈柔和蓝光，移开就熄灭。两个入口并排，等你把记忆交出来。

---

## 两条工作流

### 入口一 · 说一句那座城

> 输入「我想念悉尼海港边的歌剧院」，得到一张可制造的激光镂空剪影。

这条链路里，AI 不只是「画一张图」，而是**一个有思考过程的智能体**：

1. **DeepSeek ReAct Agent 先想，再动手**。它最多走 3 轮，先标准化城市、选场景，再决定下一步——每一步的决策和观察，都会在前端**逐条回放**给你看（`检索地标 → 修订简报 → 定稿`），而不是黑盒出图。
2. **Wikimedia 检索真实地标**。AI 不会凭空编造建筑，它先联网搜这座城的真实地标候选，再从中选一个。
3. **Qwen-Image 生成黑白镂空剪影**。不是随便画一张图，而是按「激光切割友好」的约束生成：白底黑主体、高对比、每个孔洞闭合、不留细碎线条。
4. **Potrace 矢量化**。把像素图变成工业级闭合矢量轮廓，按「切穿 / 划线 / 雕刻」三层输出，直接喂给激光机。
5. **降级兜底**。没配图像 API、或调用失败？自动切到参数化天际线生成器——按城市名哈希出独一无二的天际线，同样可制造，你永远拿得到一个结果。

### 入口二 · 刻下一张照片

> 上传一张照片，AI 抠出主体，变成镂空雕刻稿。

1. **Qwen-Image 主体提取**。AI 识别并隔离照片里的单一主体，清除背景、阴影、无关物件，保留可识别的外轮廓和有意义的内部孔洞。不满意最多自动修复 3 轮。
2. **Otsu 自适应二值化 + 连通域兜底**。Qwen 调用失败？退回纯本地算法，照样提取出干净的黑白主体。
3. **Potrace 镂空矢量化**。输出 `fill-rule=evenodd` 的复合路径——主体是实体，孔洞是镂空，一张图就能切穿。

---

## 让人眼前一亮的几个细节

- **AI 的思考是可见的**。ReAct 的每一步「检索了什么、为什么这么定、看到了什么」，都在结果下方逐条浮现，不再是黑盒。
- **双 AI 模型协同**。DeepSeek 负责「想」，Qwen-Image 负责「画」，各司其职，中间用真实的地标检索串起来。
- **AI 会失败，但你不必等**。两条链路都有多层降级，AI 挂了就切本地确定性算法，你永远拿得到一个可制造的结果。
- **Apple 流体交互**。毛玻璃材质、弹簧物理按压、生成结果逐笔描画揭示、下载成功弹跳、错误抖动入场。
- **中英双语**。顶栏「中 / EN」一键切换，全部界面即时翻译。
- **一键分享小红书**。canvas 原生重画 SVG（不经过 Image，规避 Safari 的 canvas 污染），直接生成 PNG + 带话题文案，复制即发。
- **隐私默认脱敏**。街区、门牌号这类个人信息，默认不会写进生成的文件里。

---

## 本地运行

要求 Node.js 22.18+。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。`.env.local` 默认是占位 key，会自动走离线兜底。接入真实 AI 服务时填入：

```dotenv
# DeepSeek —— 负责「想」：城市识别 + ReAct 选景
DEEPSEEK_API_KEY=sk-your-real-key
DEEPSEEK_MODEL=deepseek-flash

# 阿里云百炼 Qwen-Image —— 负责「画」：剪影生成 + 照片主体提取
DASHSCOPE_API_KEY=sk-your-dashscope-key
QWEN_IMAGE_MODEL=qwen-image-3.0        # 可选，默认 qwen-image-3.0
```

- DeepSeek key：https://platform.deepseek.com/
- Qwen-Image key：https://bailian.console.aliyun.com/（百炼控制台）

密钥只由服务端读取，禁止加 `NEXT_PUBLIC_` 前缀。两个 key 都缺失时，两条链路会自动降级到本地确定性算法，功能完整可用，只是少了 AI 生成的那一步。

---

## 三分钟演示路径

1. 首页世界地图：移动鼠标，地图跟随亮起；移开熄灭。
2. 选「说一句那座城」，输入「我想念悉尼海港边的歌剧院」——看 DeepSeek 的 ReAct 思考逐条回放，Qwen 生成剪影，Potrace 矢量化，结果逐笔描画揭示。
3. 查看 DFM 制造检查结果，下载 SVG；或点「分享到小红书」生成 PNG + 文案。
4. 回首页选「刻下一张照片」，上传一张主体清晰的照片——看 Qwen 抠图，Potrace 输出镂空 SVG。

---

## 架构

```text
入口 A 一句话 ─→ DeepSeek ReAct(3轮) ─→ Wikimedia 地标检索 ─→ Qwen-Image 生成 ─→ Potrace 矢量化 ─┐
                                      ↓ (AI 失败 / 未配置)                                        ├→ DFM 检查 → SVG 下载 / 分享小红书
                                    参数化天际线兜底 ──────────────────────────────────────────────┘
入口 B 照片   ─→ Qwen-Image 主体提取(≤3轮) ─→ Otsu/连通域兜底 ─→ Potrace 镂空矢量化 ──────────────┘
```

关键模块：

- `app/api/scene`：城市识别 + ReAct 选景 + Qwen 生图 + Potrace 矢量化。
- `app/api/photo`：照片主体提取 + Otsu 二值化 + Potrace 镂空。
- `lib/deepseek.ts`：DeepSeek JSON 调用、严格字段校验、离线兜底。
- `lib/image-gen.ts`：Qwen-Image（DashScope）剪影生成 + 照片主体提取。
- `lib/potrace-vectorize.ts`、`lib/silhouette.ts`、`lib/silhouette-generators.ts`：矢量化、剪影设计、参数化天际线兜底。
- `lib/photo-vectorize.ts`：Otsu 自适应二值化 + 连通域清理（照片兜底）。
- `lib/i18n.ts`：中英双语词典 + I18nContext + useI18n。
- `lib/share.ts`：SVG → PNG 的 canvas 原生重画（Path2D，规避 Safari taint）+ 文案复制。
- `data/world.geo.json`：Natural Earth 110m 国家边界（首页背景地图）。

---

## 制造文件规范

- SVG `width/height` 带 `mm`，`viewBox` 同数值。
- 红 `#ff0000` 切穿，蓝 `#0000ff` 划线，黑 `#000000` 雕刻；使用分层 `<g>`。
- 城市剪影把 Potrace 复合轮廓输出为 `engraving-fill`（黑色填充、`fill-rule="evenodd"`）。
- 照片 SVG 以 `engraving-fill` 黑色 `evenodd` 填充表达主体和孔洞，四周保留 6mm 安全边距。
- 下载文件不嵌入原图，不含 `<text>` 制造标记。

---

## 校验

```bash
npm run test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

---

## 已知限制

- 「分享到小红书」生成 PNG + 文案素材供手动发布；小红书没有开放发布 API，无法自动发布到账号。
- 照片主体提取用 Qwen-Image 图像编辑能力，本地兜底是 Otsu/连通域，不含 rembg/SAM 人物抠图。
- 未配置任何 AI key 时，两条链路都能用纯本地算法跑通，但成图精度和「AI 思考过程」会降级为确定性兜底。

---

> 把忘不掉的那座城，刻进木头里。
