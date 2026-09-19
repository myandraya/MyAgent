import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { checkDfm, checkSvg, createStarDesign, designFilename, generateStarSvg, queryStarMap, repairStarDesign } from "../lib/index.ts";

export const starInputSchema = z.object({ city: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), size_mm: z.number().min(80).max(370).default(300) });
export const checkInputSchema = z.object({ svg: z.string().min(1).max(2_000_000), device: z.enum(["falcon-10w", "falcon-20w", "falcon-a1c"]).default("falcon-10w") });
export const MCP_TOOL_NAMES = ["query_star_map", "generate_star_svg", "check_dfm"] as const;

export function queryStarMapTool(input: z.input<typeof starInputSchema>) {
  const value = starInputSchema.parse(input);
  return queryStarMap({ city: value.city, date: value.date, sizeMm: value.size_mm });
}

export async function generateStarSvgTool(input: z.input<typeof starInputSchema>, outputDirectory = path.resolve("shike-output")) {
  const value = starInputSchema.parse(input);
  const design = repairStarDesign(createStarDesign({ city: value.city, date: value.date, sizeMm: value.size_mm }), "falcon-10w");
  const svg = generateStarSvg(design);
  const dfm = checkDfm(design);
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, designFilename(design, "svg"));
  await writeFile(outputPath, svg, "utf8");
  return { path: outputPath, dfm, bytes: Buffer.byteLength(svg) };
}

export function checkDfmTool(input: z.input<typeof checkInputSchema>) {
  const value = checkInputSchema.parse(input);
  return checkSvg(value.svg, value.device);
}
