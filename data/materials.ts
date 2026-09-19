export const MATERIAL_DFM = {
  basswood: { name:"3mm 椴木板", minHoleMm:1.5, minSpacingMm:2.5, minFeatureMm:0.5, source:"PRD 6.3 全局制造下限" },
  "black-acrylic": { name:"3mm 黑亚克力", minHoleMm:1.5, minSpacingMm:2.5, minFeatureMm:0.5, source:"PRD 6.3 全局制造下限；无额外可靠值时不加严" }
} as const;
export type LaserMaterial=keyof typeof MATERIAL_DFM;
