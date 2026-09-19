"use client";

import { useMemo } from "react";
import { retrieveCraftKnowledge, summarizeCraftRetrieval } from "../lib/rag.ts";

export function CraftCard({deviceId,material,process,onMaterialChange,onProcessChange}:{deviceId:string;material:"basswood"|"black-acrylic";process:"cut"|"engrave";onMaterialChange:(value:"basswood"|"black-acrylic")=>void;onProcessChange:(value:"cut"|"engrave")=>void}){
  const result=useMemo(()=>retrieveCraftKnowledge({deviceId,material,process,thicknessMm:3}),[deviceId,material,process]);
  return <section className="panel glass" data-testid="craft-rag-card">
    <h3>工艺参数 RAG</h3>
    <div className="craft-controls">
      <select aria-label="材料" className="select" value={material} onChange={(event)=>onMaterialChange(event.target.value as typeof material)}><option value="basswood">3mm 椴木板</option><option value="black-acrylic">3mm 黑亚克力</option></select>
      <select aria-label="工艺" className="select" value={process} onChange={(event)=>onProcessChange(event.target.value as typeof process)}><option value="cut">切割</option><option value="engrave">雕刻</option></select>
    </div>
    <span className={`status ${result.status==="exact"?"":"warn"}`}>{result.status==="exact"?"精确命中":result.status==="nearest"?"邻近厚度参考":"无可靠参数"}</span>
    <p>{summarizeCraftRetrieval(result)}</p>
    {result.hits.map((hit)=><article className="craft-hit" key={hit.document.id}><strong>{hit.document.thicknessMm??"通用"}mm · 匹配分 {hit.score}</strong><p>{hit.document.guidance}</p><a href={hit.document.source.url} target="_blank" rel="noreferrer">{hit.document.source.title} ↗</a></article>)}
    <p className="muted">当前 DFM 档：{material==="basswood"?"3mm 椴木":"3mm 黑亚克力"}；最低制造阈值取 PRD 与设备档的较严值。</p>
  </section>;
}
