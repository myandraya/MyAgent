import type { StarDesign } from "./types.ts";

const number = (value: number) => Number(value.toFixed(3));
const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function generateStarSvg(design: StarDesign): string {
  const size = number(design.sizeMm);
  const center = size / 2;
  const discRadius = center - design.cutStrokeMm / 2;
  const registrationInset = 4;
  const registration = [[registrationInset, registrationInset], [size - registrationInset, registrationInset], [registrationInset, size - registrationInset], [size - registrationInset, size - registrationInset]];
  const scoreStars = design.stars.slice(0, Math.min(8, design.stars.length));
  const scorePath = scoreStars.map((star, index) => `${index ? "L" : "M"}${number(star.x)} ${number(star.y)}`).join(" ");
  const metadata = escapeXml(JSON.stringify(design));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}" data-units="mm">
  <title>Shike ${escapeXml(design.city.nameEn)} ${design.date}</title>
  <metadata id="shike-design">${metadata}</metadata>
  <g id="cut-through" fill="none" stroke="#ff0000" stroke-width="${number(design.cutStrokeMm)}">
    <circle data-kind="disc" cx="${center}" cy="${center}" r="${number(discRadius)}" />
    ${registration.map(([x, y]) => `<circle data-kind="registration" cx="${x}" cy="${y}" r="${number(design.registrationHoleMm / 2)}" />`).join("\n    ")}
    ${design.stars.map((star) => `<circle data-kind="star" data-star-id="${star.id}" cx="${number(star.x)}" cy="${number(star.y)}" r="${number(star.radius)}" />`).join("\n    ")}
  </g>
  <g id="vector-score" fill="none" stroke="#0000ff" stroke-width="${number(design.vectorStrokeMm)}" stroke-linecap="round" stroke-linejoin="round">
    ${scorePath ? `<path d="${scorePath}" />` : ""}
  </g>
  <g id="engraving" fill="none" stroke="#000000" stroke-width="${number(Math.max(0.5, design.vectorStrokeMm))}" stroke-linecap="round">
    <path aria-label="Shike mark converted to vector path" d="M${number(center - 18)} ${number(size - 12)} h36 M${number(center - 9)} ${number(size - 16)} l9 8 9 -8" />
  </g>
</svg>`;
}

export function designFilename(design: Pick<StarDesign, "city" | "date">, extension: "svg" | "dxf") {
  return `shike-${design.city.slug}-${design.date}.${extension}`;
}
