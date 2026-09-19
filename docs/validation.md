# 验证记录

## 自动验证

最新完整执行日期：2026-09-18。最终结果以本次开发结束时的命令记录为准。

复现命令：

```bash
npm run test
npm run test:e2e
npm run typecheck -- --pretty false
npm run lint
npm run build
```

Playwright 通过本机已安装的 Google Chrome (`channel: chrome`) 运行，不需要另行下载 Chromium。

### 最终执行结果

| 检查 | 结果 | 关键证据 |
|---|---|---|
| `npm run test` | 通过，退出码 0 | 30 tests / 30 pass / 0 fail；含LLM≤2、deadline、RAG、Reflection、格式/MCP |
| `npm run test:e2e` | 通过，退出码 0 | 9 passed / 3 expected skipped；城市键盘、SKU、DFM脉冲、星穹滚动、P5真实下载 |
| `npm run typecheck -- --pretty false` | 通过，退出码 0 | `tsc --noEmit` 无诊断 |
| `npm run lint` | 通过，退出码 0 | `eslint .` 无诊断 |
| `npm run build` | 通过，退出码 0 | Next.js 16.3.5 编译成功，6/6 页面生成；含 `/`、`/api/events`、`/api/repair`、`/api/scene` |
| 生产首页烟测 | 通过，退出码 0 | HTTP 200，HTML 含“拾刻” |
| 生产 ReAct/RAG SSE 烟测 | 通过，真实DeepSeek | HTTP 200；3665ms；rounds=5；modelCalls=2；deadline=15000；含craft/content/done |
| 生产 Reflection 烟测 | 通过，退出码 0 | `dfm.passed=true`；repairRounds=1；含 `repair_svg` 与 `run_dfm_check` 复检 |
| 生产场景 API 回归 | 通过，退出码 0 | HTTP 200，城市 `sydney` |

生产烟测完成后已停止 3100 端口服务，无本次测试服务器残留。

### 覆盖范围

- 固定输入星图重复性、三城与南北半球、20 组 DFM 回归。
- SVG 毫米尺寸/viewBox/三层颜色/线宽/四角对位孔/无 `<text>`。
- DXF 毫米单位和三层实体；下载内容和扩展名一致。
- DFM 修复前发现问题、修复后复检、Falcon 与 A1C 缩放联动。
- K1/K1C STL 封闭流形、198×198×24mm 包络、1.2mm 最小壁厚；OpenSCAD 参数源。
- PDF 文件头、对象交叉引用和非空组装内容。
- DeepSeek ReAct 每轮动作白名单、Observation回填、非法动作离线降级、主循环≤6轮、模型调用≤2、总deadline 15秒、Reflection≤3轮；不记录思维链。
- 工艺 RAG 的 Top-K、官方/PRD来源、匹配分、精确/邻近/无匹配与禁止插值。
- DeepSeek 文案成功、占位 key、错误结构与离线兜底；制造几何不进入模型请求。
- 照片本地半调、制造 SVG、输入边界和浏览器网络无原图上传。
- 一句话任意城市标准化、Wikimedia 地标检索、单场景视觉锚点、离线兜底、Potrace 闭合复合轮廓与制造 SVG。
- MCP schema、错误输入、文件生成和真实 stdio client/server 调用。
- Playwright 桌面/移动主旅程、DFM 审计、四格式下载、三入口与水平溢出。
- 首页、SSE 和场景 API 的生产 HTTP 烟测。

## 人工验证（尚未执行）

| 目标 | 状态 | 操作 |
|---|---|---|
| LightBurn | 未执行：本机未安装 | 安装后导入 SVG/DXF，确认 300×300mm、红蓝黑图层与线宽 |
| Falcon Design Space | 未执行：本机未安装 | 安装后导入 SVG/DXF，确认尺寸、图层和路径闭合 |
| Creality Print | 未执行：本机未安装 | 安装后导入 STL，核对 198×198×24mm 包络、朝向与切片壁厚 |
| OpenSCAD | 未执行：本机未安装 | 安装后打开参数源并渲染，与直接生成 STL 包络比对 |
| Stellarium | 未执行：本机未安装 | 安装后抽查爱丁堡、悉尼、纽约在当地 22:00 的亮星方位 |
| Claude Desktop / Cursor | 未执行 | 按 README MCP 配置分别调用三工具 |
| DeepSeek 真实账号 | 已执行最小与完整Agent验证 | Key最小请求HTTP 200；完整ReAct为3.665s、2次模型调用、5轮；未输出密钥 |
| 实机材料测试 | 未执行 | 3mm 椴木建立功率×速度测试矩阵后记录 |

不得将自动格式检查表述为已通过目标软件或实机制造验证。
