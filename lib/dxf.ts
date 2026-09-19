import type { StarDesign } from "./types.ts";

const n = (value: number) => Number(value.toFixed(4)).toString();
const circle = (layer: string, x: number, y: number, radius: number) => `0\nCIRCLE\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0\n40\n${n(radius)}\n`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => `0\nLINE\n8\n${layer}\n10\n${n(x1)}\n20\n${n(y1)}\n30\n0\n11\n${n(x2)}\n21\n${n(y2)}\n31\n0\n`;

export function generateStarDxf(design: StarDesign): string {
  const center = design.sizeMm / 2;
  let entities = circle("CUT_RED", center, center, center - design.cutStrokeMm / 2);
  for (const [x, y] of [[4, 4], [design.sizeMm - 4, 4], [4, design.sizeMm - 4], [design.sizeMm - 4, design.sizeMm - 4]]) entities += circle("CUT_RED", x, y, design.registrationHoleMm / 2);
  for (const star of design.stars) entities += circle("CUT_RED", star.x, design.sizeMm - star.y, star.radius);
  for (let index = 1; index < Math.min(8, design.stars.length); index += 1) {
    const a = design.stars[index - 1]; const b = design.stars[index];
    entities += line("SCORE_BLUE", a.x, design.sizeMm - a.y, b.x, design.sizeMm - b.y);
  }
  entities += line("ENGRAVE_BLACK", center - 18, 12, center + 18, 12);
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}
