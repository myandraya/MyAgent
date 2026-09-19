import type { StarDesign } from "./types.ts";

function pdfEscape(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }

export function generateAssemblyPdf(design: StarDesign): string {
  const lines = [
    "SHIKE ASSEMBLY GUIDE",
    `${design.city.nameEn} / ${design.date}`,
    `Front panel: ${design.sizeMm} x ${design.sizeMm} mm laser file`,
    "Housing: 198 x 198 x 24 mm STL, wall 1.6 mm",
    "1. Run a material test before cutting the final panel.",
    "2. Import SVG or DXF in millimeters; keep layer colors unchanged.",
    "3. Cut the red layer, score the blue layer, engrave the black layer.",
    "4. Print the housing at 0.2 mm layer height with at least 3 walls.",
    "5. Use low-voltage LED lighting only; keep heat away from wood.",
    "6. Dry-fit all parts before adhesive. Verify ventilation and wiring.",
    "Automatic format checks are not a substitute for machine testing."
  ];
  const stream = `BT\n/F1 18 Tf\n72 790 Td\n${lines.map((line,index)=>`${index ? "0 -32 Td\n" : ""}(${pdfEscape(line)}) Tj`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n% SHIKE\n";
  const offsets = [0];
  objects.forEach((object,index)=>{ offsets.push(pdf.length); pdf += `${index+1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>`${String(offset).padStart(10,"0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
