# 需求追踪表

状态：✅ 已实现并自动验证；🟡 已实现但仍需人工/外部验证；⬜ 明确降级或未实现。

| ID | PRD | 优先级 | 实现位置 | 验收证据 | 状态 |
|---|---|---:|---|---|---|
| R01 | P0 首页与三入口 | P1 | `components/ShikeApp.tsx`, `PhotoEntry.tsx`, `PromptEntry.tsx` | 旋转Canvas、指针视差、滚动入口、Playwright三入口 | ✅ 自动验证 |
| R02 | P1 五屏输入、回退、碎片、SKU | P0/P1 | `ShikeApp.tsx`, `CityCombobox.tsx` | 城市联想键盘操作、五屏、标签→默认SKU、桌面/移动E2E | ✅ |
| R03 | P2 两地真实星图与翻转 | P1 | `lib/stars.ts`, `ShikeApp.tsx` | 浏览器时区映射、星等stagger、保存时刻、三城测试 | 🟡 代码完成；未做Stellarium人工抽查 |
| R04 | P3 ReAct、SSE、≤2次LLM、<15秒、断连降级 | P1 | `lib/agent.ts`, `app/api/events/route.ts` | 30ms deadline边界；真实DeepSeek 3.665s/2次/5轮；折叠面板 | ✅ 自动与真实API验证 |
| R05 | P4 分层毫米 SVG 与下载 | P0 | `lib/svg.ts` | 结构/颜色/线宽/命名测试及浏览器下载 | 🟡 未在目标软件打开 |
| R06 | DFM 与真实修复复检 | P0 | `lib/dfm.ts`, `lib/design.ts` | 修复前失败、修复后通过、20 组回归、E2E 审计事件 | ✅ |
| R07 | Falcon/A1C/K1 设备联动 | P0/P1 | `data/devices.ts`, `data/printers.ts` | A1C 300→120mm 修复测试；K1 包络/壁厚测试 | ✅ 自动验证 |
| R08 | 3D拖拽点亮、DFM定位、RAG/材料联动、双语诗 | P1 | `LampPreview.tsx`, `CraftCard.tsx`, `lib/rag.ts`, `lib/dfm.ts` | 指针拖拽、问题脉冲、共享材料状态、真实API | ✅ 代码；目标软件仍未验证 |
| R09 | DXF / STL / PDF | P1/P2 | `lib/dxf.ts`, `lib/stl.ts`, `lib/pdf.ts` | DXF 单位/层；STL 流形/包络；PDF xref；四下载 E2E | 🟡 自动通过，目标软件未人工验证 |
| R10 | P5 分享卡与隐私 | P1 | `lib/privacy.ts`, `ShikeApp.tsx` | 页面真实星图、移动端、下载字节与门牌隔离E2E | ✅ |
| R11 | 照片主体提取 | P2 | `lib/photo.ts`, `lib/photo-vectorize.ts`, `lib/image-gen.ts`, `PhotoEntry.tsx` | Qwen 主体提取、本地连通域降级、闭合 DFM、Potrace SVG | ✅ 自动链路；真实模型效果待人工抽查 |
| R12 | 一句话剪影 | P2 | `lib/silhouette.ts`, `lib/image-gen.ts`, `lib/silhouette-generators.ts`, `app/api/scene/route.ts` | DeepSeek 城市标准化、Wikimedia 地标检索、单场景视觉锚点、Qwen 生成、参数化兜底 | ✅ |
| R13 | MCP 三工具共用核心 | P1 | `mcp/` | schema、错误输入、真实 stdio 客户端调用 | ✅；Claude/Cursor 人工双端未执行 |
| R14 | Next/Tailwind/Motion/部署基础 | P0 | 根配置、`app/` | typecheck/lint/test/build/HTTP | ✅ 本地；外部部署未执行 |
| R15 | PRD 5 视觉语言 | P1 | `app/globals.css` | 限定色、玻璃、窗口、Dock、响应式 | ✅ |
| R16 | 动效与减弱动效 | P1 | CSS、Motion 组件 | `prefers-reduced-motion` 和浏览器 E2E | ✅ |
| R17 | README 与来源/限制 | P0 | `README.md`, `docs/` | 本地运行、架构、格式、设备、MCP、限制 | ✅ |
| R18 | 自动测试清单 | P0 | `tests/`, `e2e/` | 29+ Node 测试；Playwright 桌面/移动矩阵 | ✅ 自动范围 |
| R18A | Agent Reflection ≤3轮 | P1 | `lib/agent.ts`, `app/api/repair/route.ts` | 修复前失败、Reflection后通过、轮次上限和E2E | ✅ |
| R18B | 工艺参数 RAG | P1 | `data/craft-knowledge.ts`, `lib/rag.ts` | Top-K、来源、精确/邻近/无匹配、禁止插值测试 | ✅ |
| R19 | LightBurn/FDS/Creality Print | P0/P2 | `docs/validation.md` | 需要目标软件人工执行 | ⬜ 未执行 |
| R20 | 双部署/GitHub/录屏 | 外部 | README | 需要账号和人工外部操作 | ⬜ 未执行 |
| R21 | 极光之夜/两城时钟扩展 SKU | P2 | — | PRD 允许降级 | ⬜ 未实现，未提供伪入口 |

## 数据真实性边界

- DeepSeek 只选择白名单工具、生成短诗/场景摘要，或选择城市/地标；不接收星点数组、孔径、设备阈值、SVG、DXF 或 STL。ReAct 只回传客观 Observation 摘要。
- RAG 参数来自带来源的结构化语料；邻近厚度不插值，无可靠来源不输出猜测值。
- `.env.local` 仅含可识别的占位 key；占位、401、超时、非法 JSON 均使用离线文案/选景。
- 照片原图只在浏览器 `createImageBitmap` + Canvas 中处理，不上传服务器。
- 所有“未执行”人工验证保持未执行状态，不以自动测试替代。
