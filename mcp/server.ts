#!/usr/bin/env -S node --experimental-strip-types
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { checkDfmTool, checkInputSchema, generateStarSvgTool, queryStarMapTool, starInputSchema } from "./tools.ts";

const server = new McpServer({ name: "shike", version: "0.1.0" });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.registerTool("query_star_map", {
  description: "按城市、当地日期和默认 22:00 计算真实地平星图；仅返回确定性几何数据。",
  inputSchema: starInputSchema
}, async (input) => text(queryStarMapTool(input)));

server.registerTool("generate_star_svg", {
  description: "生成并落盘经过确定性 DFM 修复与复检的毫米制分层星图 SVG。",
  inputSchema: starInputSchema
}, async (input) => text(await generateStarSvgTool(input)));

server.registerTool("check_dfm", {
  description: "检查拾刻 SVG 的孔径、孔距、线宽和设备包络元数据。",
  inputSchema: checkInputSchema
}, async (input) => text(checkDfmTool(input)));

await server.connect(new StdioServerTransport());
