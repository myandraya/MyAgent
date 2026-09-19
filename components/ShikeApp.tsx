"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import worldGeo from "../data/world.geo.json";
import { CITIES } from "../data/cities.ts";
import { DEVICES } from "../data/devices.ts";
import { fallbackContent, parseGeneratedContent, type GeneratedContent } from "../lib/content.ts";
import { checkDfm } from "../lib/dfm.ts";
import { createStarDesign, repairStarDesign } from "../lib/design.ts";
import { generateStarDxf } from "../lib/dxf.ts";
import { designFilename, generateStarSvg } from "../lib/svg.ts";
import { generateAssemblyPdf } from "../lib/pdf.ts";
import { shareCardSvg } from "../lib/privacy.ts";
import { generateLampStl } from "../lib/stl.ts";
import type { StarDesign } from "../lib/types.ts";
import { I18nContext, makeT, type Lang } from "../lib/i18n.ts";
import { CityCombobox } from "./CityCombobox.tsx";
import { CraftCard } from "./CraftCard.tsx";
import { LampPreview } from "./LampPreview.tsx";
import { McpCard } from "./McpCard.tsx";
import { PhotoEntry } from "./PhotoEntry.tsx";
import { PromptEntry } from "./PromptEntry.tsx";
import { downloadFile } from "./download.ts";

type Memory = { city: string; startYear: number; endYear: number; address: string; tags: string[]; message: string };
type AgentEvent = { label: string; tool: string; result: string; round?: number; planner?: "deepseek" | "offline" };
const questions = ["你在哪座城市，留下了另一段生活？", "你是哪一年，第一次拖着行李箱走出那座机场的？", "还记得住过的街区或门牌吗？", "那座城，你最想念什么？", "留一句想对那座城说的话。"];
const tags = ["星空", "街景", "食物", "极光", "海", "雪"];
const transition = { type: "spring" as const, stiffness: 260, damping: 30, mass: 1 };
const recommendSku=(selected:string[])=>selected.includes("极光")?"极光星空灯":selected.some((tag)=>["街景","食物"].includes(tag))?"我的街区地图":selected.includes("海")?"海岸星空灯":"两地星空灯";
const detectHomeCity=()=>{if(typeof window==="undefined")return "beijing";const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;return zone.includes("London")?"london":zone.includes("New_York")?"new-york":zone.includes("Sydney")?"sydney":zone.includes("Melbourne")?"melbourne":"beijing"};

function StarView({ design, lit = false, layers = { cut: true, score: true, engrave: true }, issues = [] }: { design: StarDesign; lit?: boolean; layers?: { cut: boolean; score: boolean; engrave: boolean }; issues?: {code:string;starIds?:string[]}[] }) {
  const highlighted=new Set(issues.flatMap((issue)=>issue.starIds??[]));
  const lineIssue=issues.some((issue)=>issue.code==="LINE_WIDTH");
  const bright = design.stars.slice(0, 8);
  const path = bright.map((star, index) => `${index ? "L" : "M"}${star.x} ${star.y}`).join(" ");
  return <svg viewBox={`0 0 ${design.sizeMm} ${design.sizeMm}`} className="star-disc" role="img" aria-label={`${design.city.name} ${design.date} 当地 22 点真实星图`}>
    <defs><radialGradient id="night"><stop stopColor={lit ? "#354d86" : "#172344"}/><stop offset="1" stopColor="#080a10"/></radialGradient></defs>
    <circle cx={design.sizeMm/2} cy={design.sizeMm/2} r={design.sizeMm/2-1} fill="url(#night)" stroke={layers.cut ? "#ff0000" : "transparent"} strokeWidth=".7"/>
    {layers.score && <path className={lineIssue?"dfm-pulse":""} d={path} fill="none" stroke={lineIssue?"#ff5f57":"#5e8bff"} strokeWidth={design.vectorStrokeMm} opacity=".7"/>}
    {layers.cut && design.stars.map((star,index) => <motion.circle initial={{opacity:0}} animate={{opacity:1}} transition={{delay:Math.min(index*.035,1.2)}} className={highlighted.has(star.id)?"dfm-pulse":""} key={star.id} cx={star.x} cy={star.y} r={Math.max(1.1,star.radius)} fill={highlighted.has(star.id)?"#ff5f57":lit ? "#ffe7a5" : "#fff"} style={{filter:lit?"drop-shadow(0 0 3px #ffc75e)":undefined}}/>)}
    {layers.engrave && <path d={`M${design.sizeMm/2-18} ${design.sizeMm-12}h36`} stroke="#8b8b9b" strokeWidth=".5"/>}
  </svg>;
}

function WorldMapCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const context = canvas.getContext("2d"); if (!context) return;
    // 预提取所有多边形坐标
    const polys: GeoJSON.Position[][][] = [];
    for (const f of (worldGeo as GeoJSON.FeatureCollection).features) {
      const g = f.geometry;
      if (g.type === "Polygon") polys.push(g.coordinates);
      else if (g.type === "MultiPolygon") for (const p of g.coordinates) polys.push(p);
    }
    // 等距圆柱投影：经度 [-180,180] → [0,mapW]，纬度 [90,-90] → [0,mapH]
    const project = (lon: number, lat: number, mapW: number, mapH: number) =>
      [((lon + 180) / 360) * mapW, ((90 - lat) / 180) * mapH] as const;
    // 离屏渲染一张地图，fillStyle 控制明暗
    const renderMap = (target: HTMLCanvasElement, mapW: number, fill: string, stroke: string, lw: number) => {
      const mapH = mapW / 2;
      target.width = mapW; target.height = mapH;
      const c = target.getContext("2d"); if (!c) return;
      c.clearRect(0, 0, mapW, mapH);
      c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = lw; c.lineJoin = "round";
      c.beginPath();
      for (const poly of polys) {
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const [lon, lat] = ring[i];
            const [px, py] = project(lon, lat, mapW, mapH);
            if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.closePath();
        }
      }
      c.fill(); c.stroke();
    };
    const dimMap = document.createElement("canvas");   // 暗底
    const brightMap = document.createElement("canvas"); // 亮版
    const spot = document.createElement("canvas");     // 高光蒙版（与主 canvas 同尺寸）
    let mapW = 0, mapH = 0, spotCtx: CanvasRenderingContext2D | null = null;
    let mouseX = -1, mouseY = -1, hasPointer = false, frame = 0;
    const resize = () => {
      const w = canvas.clientWidth * devicePixelRatio, h = canvas.clientHeight * devicePixelRatio;
      canvas.width = w; canvas.height = h;
      spot.width = w; spot.height = h;
      spotCtx = spot.getContext("2d");
      // 离屏地图 2:1，宽度取够铺满屏幕（屏幕宽 与 屏幕高*2 取大）
      mapW = Math.max(w, h * 2); mapH = mapW / 2;
      renderMap(dimMap, mapW, "rgba(127,168,255,.12)", "rgba(127,168,255,.08)", Math.max(0.5, mapW / 1600));
      renderMap(brightMap, mapW, "rgba(150,180,255,.9)", "rgba(180,205,255,.7)", Math.max(0.6, mapW / 1400));
    };
    const draw = () => {
      const w = canvas.width, h = canvas.height;
      context.clearRect(0, 0, w, h);
      // 暗底全图（地图居中纵向撑满，水平居中，超出部分被裁剪）
      const dy = (h - mapH) / 2;
      context.drawImage(dimMap, 0, dy, mapW, mapH);
      if (hasPointer && spotCtx) {
        // 高光蒙版：亮版地图 × 圆形径向渐变 alpha
        spotCtx.clearRect(0, 0, w, h);
        spotCtx.drawImage(brightMap, 0, dy, mapW, mapH);
        spotCtx.globalCompositeOperation = "destination-in";
        const R = Math.min(w, h) * 0.26;
        const grad = spotCtx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, R);
        grad.addColorStop(0, "rgba(0,0,0,1)");
        grad.addColorStop(0.55, "rgba(0,0,0,.55)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        spotCtx.fillStyle = grad;
        spotCtx.fillRect(0, 0, w, h);
        spotCtx.globalCompositeOperation = "source-over";
        context.drawImage(spot, 0, 0);
      }
      frame = requestAnimationFrame(draw);
    };
    const move = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = (e.clientX - rect.left) * devicePixelRatio;
      mouseY = (e.clientY - rect.top) * devicePixelRatio;
      hasPointer = true;
    };
    const leave = () => { hasPointer = false; };
    const out = (e: MouseEvent) => { if (!e.relatedTarget) hasPointer = false; };
    resize(); frame = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move);
    document.addEventListener("mouseleave", leave);
    document.addEventListener("mouseout", out);
    window.addEventListener("blur", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseleave", leave);
      document.removeEventListener("mouseout", out);
      window.removeEventListener("blur", leave);
    };
  }, []);
  return <canvas ref={ref} className="star-canvas" aria-label="鼠标悬停处地图亮起的世界地图"/>;
}

export function ShikeApp() {
  const [stage,setStage]=useState(0); const [question,setQuestion]=useState(0); const [flipped,setFlipped]=useState(false);
  const [lang,setLang]=useState<"zh"|"en">("zh");
  const [memory,setMemory]=useState<Memory>({city:"edinburgh",startYear:2020,endYear:2023,address:"",tags:["星空"],message:"我仍记得那晚的风"});
  const [events,setEvents]=useState<AgentEvent[]>([]); const [generated,setGenerated]=useState<GeneratedContent>(()=>fallbackContent(CITIES[0],"2023-06-01",["星空"])); const [device,setDevice]=useState("falcon-10w"); const [material,setMaterial]=useState<"basswood"|"black-acrylic">("basswood"); const [process,setProcess]=useState<"cut"|"engrave">("cut"); const [fixed,setFixed]=useState(false); const [repairing,setRepairing]=useState(false); const [lit,setLit]=useState(false); const [layers,setLayers]=useState({cut:true,score:true,engrave:true});
  const reduced=useReducedMotion(); const date=`${memory.endYear}-06-01`; const recommendedSku=recommendSku(memory.tags); const homeCity=detectHomeCity();
  const rawDesign=useMemo(()=>createStarDesign({city:memory.city,date}),[memory.city,date]);
  const design=useMemo(()=>fixed?repairStarDesign(rawDesign,device):rawDesign,[rawDesign,fixed,device]);
  const report=useMemo(()=>checkDfm(design,device,material),[design,device,material]);

  useEffect(()=>{ if(stage!==2)return; const timer=setTimeout(()=>setFlipped(true),reduced?80:1200); return()=>clearTimeout(timer); },[stage,reduced]);
  useEffect(()=>{
    if(stage!==3)return;
    const controller=new AbortController();
    let closed=false;
    void (async()=>{
      try {
        const response=await fetch("/api/events",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({city:memory.city,date,deviceId:device,material,process,thicknessMm:3,tags:memory.tags,message:memory.message})});
        if(!response.ok||!response.body)throw new Error("生成服务不可用");
        const reader=response.body.getReader();
        const decoder=new TextDecoder();
        let buffer="";
        let completed=false;
        while(!closed){
          const {done,value}=await reader.read();
          buffer+=decoder.decode(value,{stream:!done});
          const frames=buffer.split("\n\n");
          buffer=frames.pop()??"";
          for(const frame of frames){
            const event=frame.match(/^event:\s*(.+)$/m)?.[1]??"message";
            const data=frame.match(/^data:\s*(.+)$/m)?.[1];
            if(!data)continue;
            if(event==="message")setEvents((items)=>[...items,JSON.parse(data) as AgentEvent]);
            if(event==="content")setGenerated(parseGeneratedContent(JSON.parse(data),fallbackContent(rawDesign.city,date,memory.tags)));
            if(event==="done"){completed=true;setTimeout(()=>!closed&&setStage(4),500);}
          }
          if(done)break;
        }
        if(!completed&&!closed)throw new Error("生成流未完成");
      } catch {
        if(!closed){setEvents((items)=>[...items,{label:"降级",tool:"offline_fallback",result:"生成流中断，使用本地确定性管线和离线文案"}]);setTimeout(()=>!closed&&setStage(4),900);}
      }
    })();
    return()=>{closed=true;controller.abort()};
  },[stage,rawDesign.city,date,device,material,process,memory.city,memory.tags,memory.message]);

  const fragments=[memory.city&&CITIES.find(c=>c.slug===memory.city)?.name,question>0&&`${memory.startYear}—${memory.endYear}`,question>1&&memory.address,question>2&&memory.tags.join(" · "),question>3&&memory.message].filter(Boolean) as string[];
  const nextQuestion=()=>{if(question<4)setQuestion(question+1);else setStage(2)};
  const setTag=(tag:string)=>setMemory((value)=>({...value,tags:value.tags.includes(tag)?value.tags.filter(item=>item!==tag):[...value.tags,tag]}));
  const repairDesign=async()=>{
    setRepairing(true);
    try{
      const response=await fetch("/api/repair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({city:memory.city,date,deviceId:device,material,process,thicknessMm:3,tags:memory.tags,message:memory.message})});
      if(!response.ok)throw new Error("修复服务不可用");
      const result=await response.json() as {dfm?:{passed?:boolean;summary?:string};events?:AgentEvent[]};
      if(!result.dfm?.passed)throw new Error(result.dfm?.summary??"三轮内仍有未解决问题");
      setFixed(true);
      setEvents((items)=>[...items,...(result.events??[]).filter((event)=>event.tool==="repair_svg"||event.tool==="run_dfm_check")]);
    }catch(reason){
      setEvents((items)=>[...items,{label:"观察",tool:"repair_svg",result:reason instanceof Error?reason.message:"修复失败"}]);
    }finally{setRepairing(false)}
  };

  const t = makeT(lang);
  return <I18nContext.Provider value={{ lang, t }}><main className="shike"><div className="shell"><header className="topbar"><button className="brand" onClick={()=>setStage(0)} style={{border:0,background:"none",padding:0,cursor:"pointer"}}>拾刻 <small>SHIKE</small></button><div className="lang-switch"><button className={`lang-btn ${lang==="zh"?"active":""}`} onClick={()=>setLang("zh")}>中</button><span className="lang-sep">/</span><button className={`lang-btn ${lang==="en"?"active":""}`} onClick={()=>setLang("en")}>EN</button></div></header>
    <AnimatePresence mode="wait">
      {stage===0&&<motion.section key="home" className="hero" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><WorldMapCanvas/><div className="hero-copy"><div className="eyebrow">{t("hero_eyebrow")}</div><h1 dangerouslySetInnerHTML={{__html:t("hero_title")}}/><p>{t("hero_desc")}</p><nav className="entry-grid" aria-label={t("entry_a_strong")}><button className="entry-card entry-primary" onClick={()=>setStage(7)}><span>{t("entry_a_span")}</span><strong>{t("entry_a_strong")} <b aria-hidden="true">→</b></strong><small>{t("entry_a_small")}</small></button><button className="entry-card entry-secondary" onClick={()=>setStage(6)}><span>{t("entry_b_span")}</span><strong>{t("entry_b_strong")} <b aria-hidden="true">→</b></strong><small>{t("entry_b_small")}</small></button></nav></div></motion.section>}
      {stage===1&&<motion.section key="journey" className="journey" initial={{x:60,opacity:0}} animate={{x:0,opacity:1}} exit={{x:-60,opacity:0}} transition={transition}><div style={{width:"min(760px,100%)"}}><div className="timeline glass">{fragments.map((item,index)=><motion.span layoutId={`fragment-${index}`} className="fragment" key={`${index}-${item}`}>{item}</motion.span>)}</div><AnimatePresence mode="wait" initial={false}><motion.div key={question} className="question-card glass" initial={{x:50,opacity:0}} animate={{x:0,opacity:1}} exit={{x:-50,opacity:0}} transition={transition}><span className="step">MEMORY {question+1} / 5</span><h2>{questions[question]}</h2>{question===0&&<CityCombobox value={memory.city} onChange={(city)=>setMemory({...memory,city})}/>}{question===1&&<div className="range-row"><div className="range-wrap"><label>落地 <strong>{memory.startYear}</strong></label><input type="range" min="2000" max="2026" value={memory.startYear} onChange={e=>setMemory({...memory,startYear:Number(e.target.value)})}/></div><div className="range-wrap"><label>回来 <strong>{memory.endYear}</strong></label><input type="range" min={memory.startYear} max="2026" value={memory.endYear} onChange={e=>setMemory({...memory,endYear:Number(e.target.value)})}/></div></div>}{question===2&&<input className="field" maxLength={80} value={memory.address} onChange={e=>setMemory({...memory,address:e.target.value})} placeholder="选填，例如 Marchmont（分享时默认脱敏）"/>}{question===3&&<div className="tags">{tags.map(tag=><button key={tag} className={`tag ${memory.tags.includes(tag)?"active":""}`} onClick={()=>setTag(tag)}>{tag}</button>)}</div>}{question===4&&<textarea className="field" rows={3} maxLength={120} value={memory.message} onChange={e=>setMemory({...memory,message:e.target.value})}/>}<div className="actions"><button className="secondary" onClick={()=>question===0?setStage(0):setQuestion(question-1)}>返回</button><button className="primary" disabled={question===3&&memory.tags.length===0} onClick={nextQuestion}>{question===4?"看看那片星空":"继续"}</button></div></motion.div></AnimatePresence></div></motion.section>}
      {stage===2&&<motion.section key="flip" className="flip-stage" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><div className="flip-copy"><div className="eyebrow">22:00 · REAL SKY CALCULATION</div><h2>{flipped?"但你怀念的，\n是这一片":"此刻，家的上空"}</h2><p>{flipped?`${rawDesign.city.name} · ${date} · 当地 22:00\n${rawDesign.stars.length} 颗亮星位于地平线上方`:`${CITIES.find((city)=>city.slug===homeCity)?.name??"北京"} · 同日当地 22:00`}</p><span className="sku-chip">根据记忆推荐 · {recommendedSku}</span><div style={{display:"flex",gap:10}}><button className="secondary" onClick={()=>downloadFile(generateStarSvg(repairStarDesign(rawDesign,device)),`shike-${rawDesign.city.slug}-${date}-moment.svg`,"image/svg+xml")}>保存此刻</button><button className="primary" onClick={()=>{setEvents([]);setGenerated(fallbackContent(rawDesign.city,date,memory.tags));setStage(3)}} disabled={!flipped}>把它装进木头</button></div></div><motion.div animate={reduced?{opacity:[0,1]}:{rotateY:flipped?180:0}} transition={{duration:reduced?.2:1.6,ease:[.32,.72,0,1]}} style={{transformStyle:"preserve-3d"}}><div style={{transform:flipped?"rotateY(180deg)":"none"}}><StarView design={flipped?rawDesign:createStarDesign({city:homeCity,date})}/></div></motion.div></motion.section>}
      {stage===3&&<motion.section key="generate" className="generator" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><div className="route glass"><div className="eyebrow">{rawDesign.city.name} → 中国</div><h2>拾刻正在把那座城<br/>装进木头</h2><svg viewBox="0 0 500 180"><path className="route-path" d="M40 130 C170 15 340 15 460 115" fill="none" stroke="#5e8bff" strokeWidth="3" strokeLinecap="round"/><circle cx="460" cy="115" r="6" fill="#fff"/></svg></div><details className="agent-panel glass" open aria-live="polite"><summary className="eyebrow">可审计执行事件 · 最多 6 轮 · LLM ≤2 次</summary>{events.map((event,index)=><motion.div className="agent-event" key={index} initial={{y:12,opacity:0}} animate={{y:0,opacity:1}}><strong>{event.label}{event.round?` · R${event.round}`:""}</strong><code>{event.tool}{event.planner?` · ${event.planner}`:""}</code><p>{event.result}</p></motion.div>)}{events.length===0&&<p className="muted">正在连接确定性工具链…</p>}</details></motion.section>}
      {stage===4&&<motion.section key="result" className="result" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}><div className="result-head"><div><div className="eyebrow">MANUFACTURING RESULT</div><h1>{rawDesign.city.name}的那片夜空</h1><span className="sku-chip">默认 SKU · {recommendedSku}</span></div><button className="secondary" onClick={()=>setStage(5)}>生成分享卡 →</button></div><LampPreview stars={design.stars} size={design.sizeMm} lit={lit}/><div style={{display:"flex",justifyContent:"center",marginBottom:20}}><button className="primary" onClick={()=>setLit(!lit)}>{lit?"熄灯":"点亮星空灯"}</button></div><div className="result-grid"><div className="window glass"><div className="window-bar"><div className="traffic"><i/><i/><i/></div><div className="layer-buttons">{(["cut","score","engrave"] as const).map(key=><button key={key} className={`layer-toggle ${layers[key]?"active":""}`} onClick={()=>setLayers({...layers,[key]:!layers[key]})}>{key==="cut"?"红·切穿":key==="score"?"蓝·划线":"黑·雕刻"}</button>)}</div></div><div className="preview-area"><StarView design={design} lit={lit} layers={layers} issues={report.issues}/></div></div><aside className="side-stack"><section className="panel glass"><h3>DFM 制造检查</h3><span className={`status ${report.passed?report.issues.length?"warn":"":"fail"}`}>{report.passed?report.issues.length?"几何通过 · 设备待确认":"全部通过":"发现问题"}</span><p>{report.summary}</p>{report.issues.length>0&&<ul className="issue-list">{report.issues.slice(0,6).map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}{!report.passed&&<button className="primary" disabled={repairing} onClick={()=>void repairDesign()}>{repairing?"Reflection 修复中…":"Agent 修复并复检"}</button>}<details><summary>查看最近审计事件</summary>{events.slice(-3).map((event,index)=><p key={`${event.tool}-${index}`}><code>{event.tool}</code> · {event.result}</p>)}</details></section><section className="panel glass"><h3>设备与工艺</h3><select className="select" value={device} onChange={e=>{setDevice(e.target.value);setFixed(false)}}>{DEVICES.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><p>{DEVICES.find(item=>item.id===device)?.parameterNote}</p><p className="mono">{design.sizeMm}×{design.sizeMm}mm · 最小孔径 1.5mm · 净距 2.5mm</p><p className="mono">K1/K1C 灯壳 · 198×198×24mm · 壁厚 1.6mm · 建议层高 0.2mm</p></section><CraftCard deviceId={device} material={material} process={process} onMaterialChange={(value)=>{setMaterial(value);setFixed(false)}} onProcessChange={setProcess}/><section className="panel glass"><h3>下载制造文件</h3><div className="downloads"><button className="primary" disabled={!report.passed} onClick={()=>downloadFile(generateStarSvg(design),designFilename(design,"svg"),"image/svg+xml")}>SVG</button><button className="secondary" disabled={!report.passed} onClick={()=>downloadFile(generateStarDxf(design),designFilename(design,"dxf"),"application/dxf")}>DXF</button><button className="secondary" onClick={()=>downloadFile(generateLampStl({printerId:"k1"}),`shike-${design.city.slug}-${design.date}.stl`,"model/stl")}>STL · K1 灯壳</button><button className="secondary" onClick={()=>downloadFile(generateAssemblyPdf(design),`shike-${design.city.slug}-${design.date}-assembly.pdf`,"application/pdf")}>组装 PDF</button></div></section><McpCard/><section className="panel glass"><h3>写给 {design.city.name}</h3><p className="poem">{generated.poem[0]}</p><p>{generated.poem[1]}</p><p>{generated.source==="deepseek"?"由 DeepSeek 生成；制造几何未发送给模型。":"DeepSeek 未配置或调用失败，已使用离线文案兜底。"}</p></section></aside></div></motion.section>}
      {stage===5&&<motion.section key="share" className="share" initial={{opacity:0}} animate={{opacity:1}}><div className="share-card glass"><div><div className="eyebrow">{design.city.nameEn}</div><h2>{design.city.name}</h2></div><div className="share-star-preview"><StarView design={design} lit/></div><div><p className="poem">{generated.poem[0]}</p><p className="muted">#我把第二故乡带回了家</p></div></div><div><div className="eyebrow">9:16 · PRIVACY SAFE</div><h1>把这一刻<br/>带回家</h1><p className="muted">分享图只包含城市、星图与诗句；街区和门牌不会写入文件。</p><div style={{display:"flex",gap:10,marginTop:24}}><button className="primary" onClick={()=>downloadFile(shareCardSvg({city:design.city.name,poem:generated.poem[0],stars:design.stars}),`shike-${design.city.slug}-share.svg`,"image/svg+xml")}>保存分享图</button><button className="secondary" onClick={()=>setStage(4)}>返回结果</button></div></div></motion.section>}
      {stage===6&&<motion.section key="photo" initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{x:40,opacity:0}} transition={transition}><PhotoEntry onBack={()=>setStage(0)}/></motion.section>} 
      {stage===7&&<motion.section key="prompt" initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{x:40,opacity:0}} transition={transition}><PromptEntry onBack={()=>setStage(0)}/></motion.section>}
    </AnimatePresence></div></main></I18nContext.Provider>;
}
