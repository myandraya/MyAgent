export type PrintProfile = {
  id: "k1" | "k1c";
  name: string;
  buildVolumeMm: [number, number, number];
  nozzleMm: number;
  minWallMm: number;
  defaultLayerMm: number;
  material: string;
  note: string;
};

export const PRINT_PROFILES: PrintProfile[] = [
  { id: "k1", name: "Creality K1", buildVolumeMm: [220, 220, 250], nozzleMm: 0.4, minWallMm: 1.2, defaultLayerMm: 0.2, material: "PLA / Hyper PLA", note: "198mm 灯壳为 K1 留出 11mm/侧余量；温度与速度使用材料厂商档案并先打印测试件。" },
  { id: "k1c", name: "Creality K1C", buildVolumeMm: [220, 220, 250], nozzleMm: 0.4, minWallMm: 1.2, defaultLayerMm: 0.2, material: "PLA / Hyper PLA", note: "几何档与 K1 共用；切片参数需按实际材料和喷嘴校准。" }
];

export function getPrintProfile(id: string) {
  const profile = PRINT_PROFILES.find((item) => item.id === id);
  if (!profile) throw new Error(`未知打印机：${id}`);
  return profile;
}
