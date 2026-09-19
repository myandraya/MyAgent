import { getPrintProfile } from "../data/printers.ts";

export type LampMeshOptions = { diameterMm?: number; depthMm?: number; wallMm?: number; backMm?: number; segments?: number; printerId?: string };
type Point = [number, number, number];
type Triangle = [Point, Point, Point];

function normal([a, b, c]: Triangle): Point {
  const u: Point = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const v: Point = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const cross: Point = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const length = Math.hypot(...cross) || 1;
  return cross.map((value) => value / length) as Point;
}

function point(radius: number, index: number, segments: number, z: number): Point {
  const angle = index / segments * Math.PI * 2;
  return [radius * Math.cos(angle), radius * Math.sin(angle), z];
}

export function lampTriangles(options: LampMeshOptions = {}): Triangle[] {
  const diameter = options.diameterMm ?? 198;
  const depth = options.depthMm ?? 24;
  const wall = options.wallMm ?? 1.6;
  const back = options.backMm ?? 1.6;
  const segments = options.segments ?? 96;
  const profile = getPrintProfile(options.printerId ?? "k1");
  if (diameter < 40 || diameter > Math.min(profile.buildVolumeMm[0], profile.buildVolumeMm[1]) - 20) throw new Error("灯壳直径超出打印机安全包络。");
  if (depth <= back || depth > profile.buildVolumeMm[2] - 20) throw new Error("灯壳深度无效。");
  if (wall < profile.minWallMm || back < profile.minWallMm) throw new Error(`壁厚和背板不得小于 ${profile.minWallMm}mm。`);
  if (!Number.isInteger(segments) || segments < 24 || segments > 256) throw new Error("圆周分段必须为 24..256 的整数。");
  const outer = diameter / 2;
  const inner = outer - wall;
  const triangles: Triangle[] = [];
  const quad = (a: Point, b: Point, c: Point, d: Point) => triangles.push([a,b,c], [a,c,d]);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const o0 = point(outer,index,segments,0), o1 = point(outer,next,segments,0), ot0 = point(outer,index,segments,depth), ot1 = point(outer,next,segments,depth);
    const ib0 = point(inner,index,segments,back), ib1 = point(inner,next,segments,back), it0 = point(inner,index,segments,depth), it1 = point(inner,next,segments,depth);
    quad(o0,o1,ot1,ot0);
    quad(ib0,it0,it1,ib1);
    quad(ot0,ot1,it1,it0);
    triangles.push([[0,0,0],o1,o0]);
    triangles.push([[0,0,back],ib0,ib1]);
  }
  return triangles;
}

const format = (value: number) => Number(value.toFixed(6));
export function generateLampStl(options: LampMeshOptions = {}) {
  const facets = lampTriangles(options).map((triangle) => {
    const n = normal(triangle);
    return `  facet normal ${format(n[0])} ${format(n[1])} ${format(n[2])}\n    outer loop\n${triangle.map((vertex)=>`      vertex ${format(vertex[0])} ${format(vertex[1])} ${format(vertex[2])}`).join("\n")}\n    endloop\n  endfacet`;
  }).join("\n");
  return `solid shike_lamp_housing\n${facets}\nendsolid shike_lamp_housing\n`;
}

export function generateLampScad(options: LampMeshOptions = {}) {
  const diameter = options.diameterMm ?? 198, depth = options.depthMm ?? 24, wall = options.wallMm ?? 1.6, back = options.backMm ?? 1.6, segments = options.segments ?? 96;
  lampTriangles(options);
  return `// Shike parametric lamp housing — millimeters\ndiameter=${diameter}; depth=${depth}; wall=${wall}; back=${back}; $fn=${segments};\ndifference(){\n  cylinder(d=diameter,h=depth);\n  translate([0,0,back]) cylinder(d=diameter-2*wall,h=depth);\n}\n`;
}

export function inspectLampStl(stl: string) {
  const vertices = [...stl.matchAll(/vertex (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)].map((match) => match.slice(1).map(Number));
  if (!stl.startsWith("solid shike_lamp_housing") || !stl.endsWith("endsolid shike_lamp_housing\n") || vertices.length === 0) throw new Error("STL 结构无效。");
  const axes = [0,1,2].map((axis) => ({ min: Math.min(...vertices.map((vertex)=>vertex[axis])), max: Math.max(...vertices.map((vertex)=>vertex[axis])) }));
  return { triangles: vertices.length / 3, boundsMm: axes.map((axis) => Number((axis.max-axis.min).toFixed(3))) as [number,number,number] };
}
