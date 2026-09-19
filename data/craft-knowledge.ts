export type CraftKnowledge = {
  id: string;
  deviceIds: string[];
  material: "basswood" | "black-acrylic" | "pla";
  process: "engrave" | "cut" | "print";
  thicknessMm?: number;
  parameters: { powerPercent?: number; speedMmMin?: number; passes?: number; nozzleMm?: number; layerHeightMm?: number; minWallMm?: number };
  guidance: string;
  source: { title: string; url: string; kind: "official" | "prd"; accessed: string };
};

const FALCON_SETTINGS = "https://uk.crealityfalcon.com/blogs/crealityfalcon-tutorial/creality-falcon-laser-series-material-settings";

export const CRAFT_KNOWLEDGE: CraftKnowledge[] = [
  { id:"falcon10-basswood-engrave-2", deviceIds:["falcon-10w"], material:"basswood", process:"engrave", thicknessMm:2, parameters:{powerPercent:40,speedMmMin:3000,passes:1}, guidance:"官方 2mm 椴木雕刻测试值；3mm 材料需先做测试矩阵。", source:{title:"Material Settings of Creality Falcon Laser Series — Falcon CR 10W",url:FALCON_SETTINGS,kind:"official",accessed:"2026-09-18"} },
  { id:"falcon10-basswood-cut-2", deviceIds:["falcon-10w"], material:"basswood", process:"cut", thicknessMm:2, parameters:{powerPercent:100,speedMmMin:350,passes:1}, guidance:"官方 2mm 椴木切割测试值。", source:{title:"Material Settings of Creality Falcon Laser Series — Falcon CR 10W",url:FALCON_SETTINGS,kind:"official",accessed:"2026-09-18"} },
  { id:"falcon10-basswood-cut-4", deviceIds:["falcon-10w"], material:"basswood", process:"cut", thicknessMm:4, parameters:{powerPercent:100,speedMmMin:200,passes:1}, guidance:"官方 4mm 椴木切割测试值；与 2mm 条目共同包围 3mm，但应用不自动插值。", source:{title:"Material Settings of Creality Falcon Laser Series — Falcon CR 10W",url:FALCON_SETTINGS,kind:"official",accessed:"2026-09-18"} },
  { id:"falcon10-acrylic-engrave-4-5", deviceIds:["falcon-10w"], material:"black-acrylic", process:"engrave", thicknessMm:4.5, parameters:{powerPercent:50,speedMmMin:3000,passes:1}, guidance:"官方 4.5mm 黑色亚克力雕刻测试值；透明/浅色亚克力不适用。", source:{title:"Material Settings of Creality Falcon Laser Series — Falcon CR 10W",url:FALCON_SETTINGS,kind:"official",accessed:"2026-09-18"} },
  { id:"falcon10-acrylic-cut-4-5", deviceIds:["falcon-10w"], material:"black-acrylic", process:"cut", thicknessMm:4.5, parameters:{powerPercent:100,speedMmMin:120,passes:2}, guidance:"官方 4.5mm 黑色亚克力切割测试值；3mm 只能视为邻近参考。", source:{title:"Material Settings of Creality Falcon Laser Series — Falcon CR 10W",url:FALCON_SETTINGS,kind:"official",accessed:"2026-09-18"} },
  { id:"k1-pla-print", deviceIds:["k1","k1c"], material:"pla", process:"print", parameters:{nozzleMm:0.4,layerHeightMm:0.2,minWallMm:1.2}, guidance:"PRD 指定的 K1/K1C 几何起始档；温度、流量和速度必须使用实际耗材档案。", source:{title:"PRD v1.1 §6.4 K1 系列适配矩阵",url:"docs/requirements.md",kind:"prd",accessed:"2026-09-18"} }
];
