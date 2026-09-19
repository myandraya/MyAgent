import assert from "node:assert/strict";
import test from "node:test";
import { createStarDesign, repairStarDesign } from "../lib/design.ts";
import { generateAssemblyPdf } from "../lib/pdf.ts";
import { generateLampScad, generateLampStl, inspectLampStl, lampTriangles } from "../lib/stl.ts";

const vertexKey = (vertex: number[]) => vertex.map((value)=>value.toFixed(6)).join(",");

test("K1 灯壳 STL 是封闭流形且位于 200mm 安全尺寸内", () => {
  const triangles = lampTriangles({ printerId: "k1" });
  const edges = new Map<string, number>();
  for (const triangle of triangles) for (const [a,b] of [[triangle[0],triangle[1]],[triangle[1],triangle[2]],[triangle[2],triangle[0]]]) {
    const key = [vertexKey(a),vertexKey(b)].sort().join("|");
    edges.set(key,(edges.get(key)??0)+1);
  }
  assert.ok(triangles.length > 500);
  assert.ok([...edges.values()].every((count)=>count===2), "每条网格边必须恰好属于两个三角面");
  const stl = generateLampStl({ printerId: "k1" });
  const inspected = inspectLampStl(stl);
  assert.deepEqual(inspected.boundsMm,[198,198,24]);
  assert.equal(inspected.triangles,triangles.length);
  assert.match(stl,/^solid shike_lamp_housing/);
});

test("灯壳参数遵守 K1 壁厚和包络并提供 OpenSCAD 源", () => {
  assert.throws(()=>generateLampStl({wallMm:0.8}),/不得小于 1.2mm/);
  assert.throws(()=>generateLampStl({diameterMm:205}),/安全包络/);
  const scad=generateLampScad({diameterMm:198,wallMm:1.6});
  assert.match(scad,/diameter=198/);
  assert.match(scad,/difference\(\)/);
  assert.match(scad,/cylinder/);
});

test("组装说明书是具有正确 xref 偏移的非空 PDF", () => {
  const design=repairStarDesign(createStarDesign({city:"edinburgh",date:"2023-06-01"}),"falcon-10w");
  const pdf=generateAssemblyPdf(design);
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.length>1200);
  assert.match(pdf,/SHIKE ASSEMBLY GUIDE/);
  assert.match(pdf,/Edinburgh \/ 2023-06-01/);
  const offset=Number(pdf.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(pdf.slice(offset,offset+4),"xref");
});
