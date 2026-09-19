import { CRAFT_KNOWLEDGE, type CraftKnowledge } from "../data/craft-knowledge.ts";

export type CraftQuery = { deviceId: string; material: CraftKnowledge["material"]; process: CraftKnowledge["process"]; thicknessMm?: number; topK?: number };
export type CraftHit = { document: CraftKnowledge; score: number; thicknessDeltaMm: number | null; exactThickness: boolean };
export type CraftRetrieval = { query: CraftQuery; hits: CraftHit[]; status: "exact" | "nearest" | "no-match"; disclaimer: string };

export function retrieveCraftKnowledge(query: CraftQuery): CraftRetrieval {
  const topK = Math.max(1, Math.min(5, Math.floor(query.topK ?? 3)));
  const hits = CRAFT_KNOWLEDGE.map((document): CraftHit | null => {
    if (!document.deviceIds.includes(query.deviceId) || document.material !== query.material || document.process !== query.process) return null;
    const delta = query.thicknessMm !== undefined && document.thicknessMm !== undefined ? Math.abs(query.thicknessMm-document.thicknessMm) : null;
    const exact = delta === 0;
    const score = 10 + (document.source.kind === "official" ? 2 : 1) + (exact ? 5 : delta === null ? 2 : Math.max(0,3-delta));
    return { document, score:Number(score.toFixed(3)), thicknessDeltaMm:delta, exactThickness:exact };
  }).filter((hit): hit is CraftHit => hit !== null).sort((a,b)=>b.score-a.score || (a.thicknessDeltaMm??0)-(b.thicknessDeltaMm??0) || a.document.id.localeCompare(b.document.id)).slice(0,topK);
  const exact = hits.some((hit)=>hit.exactThickness);
  return {
    query:{...query,topK}, hits,
    status:hits.length===0?"no-match":exact?"exact":"nearest",
    disclaimer: exact ? "命中同机型、同材料、同工艺和同厚度条目；仍需实材测试。" : hits.length ? "仅命中邻近厚度参考，未插值；必须先做材料测试矩阵。" : "没有可靠参数来源，不提供功率/速度猜测。"
  };
}

export function summarizeCraftRetrieval(result: CraftRetrieval) {
  if (!result.hits.length) return result.disclaimer;
  const rows=result.hits.map(({document,thicknessDeltaMm})=>{
    const p=document.parameters;
    const values=[p.powerPercent!==undefined&&`功率 ${p.powerPercent}%`,p.speedMmMin!==undefined&&`速度 ${p.speedMmMin}mm/min`,p.passes!==undefined&&`${p.passes} 遍`,p.nozzleMm!==undefined&&`喷嘴 ${p.nozzleMm}mm`,p.layerHeightMm!==undefined&&`层高 ${p.layerHeightMm}mm`,p.minWallMm!==undefined&&`壁厚≥${p.minWallMm}mm`].filter(Boolean).join("，");
    return `${document.thicknessMm??"通用"}mm：${values}${thicknessDeltaMm?`（厚度差 ${thicknessDeltaMm}mm）`:""}`;
  });
  return `${rows.join("；")}。${result.disclaimer}`;
}
