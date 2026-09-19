export function maskAddress(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "未填写";
  return cleaned.replace(/\d[\dA-Za-z-]*/g, "•••").slice(0, 24);
}

export function shareCardSvg(input: { city: string; poem: string; stars: { x: number; y: number; radius: number }[] }) {
  const safeCity = input.city.replace(/[<>&"]/g, "");
  const safePoem = input.poem.replace(/[<>&"]/g, "").slice(0, 36);
  const stars = input.stars.slice(0, 40).map((star) => `<circle cx="${(star.x / 300 * 720).toFixed(1)}" cy="${(star.y / 300 * 720 + 250).toFixed(1)}" r="${Math.max(2, star.radius * 1.8).toFixed(1)}" fill="#fff"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#0B0B12"/><circle cx="540" cy="610" r="390" fill="#111827" stroke="#5E8BFF" stroke-width="3"/>${stars}<text x="540" y="1120" text-anchor="middle" fill="#8FAEFF" font-size="34" font-family="sans-serif">${safeCity}</text><text x="540" y="1220" text-anchor="middle" fill="#fff" font-size="42" font-family="sans-serif">${safePoem}</text><text x="540" y="1700" text-anchor="middle" fill="#8b8b9b" font-size="28" font-family="sans-serif">#我把第二故乡带回了家</text><text x="540" y="1770" text-anchor="middle" fill="#fff" font-size="24" font-family="sans-serif">拾刻 SHIKE</text></svg>`;
}
