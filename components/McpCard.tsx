"use client";

import { useState } from "react";

const config=`{"mcpServers":{"shike":{"command":"node","args":["--experimental-strip-types","/ABSOLUTE/PATH/mcp/server.ts"],"cwd":"/ABSOLUTE/PATH"}}}`;
export function McpCard(){const[copied,setCopied]=useState(false);return <section className="panel glass"><details><summary><strong>MCP 接入</strong></summary><p className="mono">npm run mcp</p><p>Claude Desktop / Cursor 通用 stdio 配置：</p><pre className="mono" style={{whiteSpace:"pre-wrap",fontSize:11}}>{config}</pre><button className="secondary" onClick={()=>void navigator.clipboard.writeText(config).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500)})}>{copied?"已复制":"复制配置"}</button><p><code>npx shike-mcp</code> 需 npm 包发布后使用；当前不伪装已发布。</p></details></section>}
