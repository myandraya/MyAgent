import { getDevice } from "../data/devices.ts";
import { queryStarMap } from "./stars.ts";
import type { StarDesign } from "./types.ts";

export function createStarDesign(input: { city: string; date: string; sizeMm?: number }): StarDesign {
  const map = queryStarMap(input);
  return { ...map, cutStrokeMm: 0.08, vectorStrokeMm: 0.35, registrationHoleMm: 2, repaired: false };
}

export function repairStarDesign(design: StarDesign, deviceId: string): StarDesign {
  const device = getDevice(deviceId);
  const maxSize = device.bedWidthMm && device.bedHeightMm
    ? Math.min(device.bedWidthMm, device.bedHeightMm) - device.safeMarginMm * 2
    : design.sizeMm;
  const sizeMm = Math.min(design.sizeMm, maxSize);
  const factor = sizeMm / design.sizeMm;
  const center = design.sizeMm / 2;
  const nextCenter = sizeMm / 2;
  const candidates = design.stars.map((star) => ({
    ...star,
    x: nextCenter + (star.x - center) * factor,
    y: nextCenter + (star.y - center) * factor,
    radius: Math.max(device.minHoleMm / 2, star.radius * factor)
  }));
  const stars = candidates.filter((star, index) => candidates.slice(0, index).every((kept) => {
    const centerDistance = Math.hypot(star.x - kept.x, star.y - kept.y);
    return centerDistance - star.radius - kept.radius >= device.minSpacingMm;
  }));
  return {
    ...design,
    sizeMm,
    stars,
    cutStrokeMm: Math.min(design.cutStrokeMm, device.maxCutStrokeMm),
    vectorStrokeMm: Math.max(design.vectorStrokeMm, device.minFeatureMm),
    registrationHoleMm: Math.max(design.registrationHoleMm, device.minHoleMm),
    repaired: true
  };
}
