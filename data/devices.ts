import type { Device } from "../lib/types.ts";

export const DEVICES: Device[] = [
  {
    id: "falcon-10w", name: "Falcon 10W", bedWidthMm: 400, bedHeightMm: 415, safeMarginMm: 15,
    minHoleMm: 1.5, minSpacingMm: 2.5, minFeatureMm: 0.5, maxCutStrokeMm: 0.1,
    parameterNote: "3mm 椴木参数需按材料批次做测试矩阵；本应用不提供未经核验的功率/速度。",
    source: "PRD 6.4（幅面与制造阈值）；功率/速度待官方材料表或实机测试。"
  },
  {
    id: "falcon-20w", name: "Falcon 20W+", bedWidthMm: 400, bedHeightMm: 415, safeMarginMm: 15,
    minHoleMm: 1.5, minSpacingMm: 2.5, minFeatureMm: 0.5, maxCutStrokeMm: 0.1,
    parameterNote: "功率更高不改变本设计的几何安全阈值；速度/功率仍需材料测试。",
    source: "PRD 6.4；具体加工参数未在 PRD 中给出。"
  },
  {
    id: "falcon-a1c", name: "Falcon A1C", bedWidthMm: 150, bedHeightMm: 150, safeMarginMm: 15,
    minHoleMm: 1.5, minSpacingMm: 2.5, minFeatureMm: 0.5, maxCutStrokeMm: 0.1,
    parameterNote: "150×150mm 紧凑工作区；300mm 设计会按 15mm/侧安全边距缩放至 120mm。功率/速度仍需材料测试。",
    source: "Creality Falcon A1C 官方产品页：工作区 150×150×148mm；安全边距采用本项目 15mm 规则。"
  }
];

export function getDevice(id: string): Device {
  const device = DEVICES.find((item) => item.id === id);
  if (!device) throw new Error(`未知机型：${id}`);
  return device;
}
