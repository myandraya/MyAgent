"use client";

import { useEffect, useState } from "react";
import { checkSilhouetteDfm, composeSilhouette, composeSilhouetteSelection, generateSilhouetteSvg, type SilhouetteDesign } from "../lib/silhouette.ts";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { svgToPngBlob, copyText } from "../lib/share.ts";

// 数字滚动：目标值变化时，从旧值在 duration 内平滑滚到新值
function useCountUp(target: number, duration = 400) {
  const [num, setNum] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setNum(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return { num };
}

type SceneAgentEvent = { round: number; action: "search_landmarks" | "revise_brief" | "finish"; decision: string; observation: string };
type SceneResult = {
  city: string;
  landmark: string;
  cutPaths?: string[];
  scorePaths?: string[];
  engravePaths?: string[];
  fillPaths?: string[];
  paths: string[];
  source: "image-gen" | "offline";
  agent?: { rounds: number; status: "completed" | "degraded"; events: SceneAgentEvent[] };
};

export function PromptEntry({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [design, setDesign] = useState<SilhouetteDesign | null>(null);
  const [source, setSource] = useState<"image-gen"|"offline">("offline");
  const [landmark, setLandmark] = useState<string>("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<SceneAgentEvent[]>([]);
  const [traceVisible, setTraceVisible] = useState(0);
  const [phase, setPhase] = useState(0); // 0 待机 / 1 识别城市 / 2 生成剪影 / 3 矢量化(完成)
  const [counts, setCounts] = useState({ cut: 0, score: 0, engrave: 0 }); // 数字滚动目标值
  const svg = design ? generateSilhouetteSvg(design) : "";
  const report = design ? checkSilhouetteDfm(design) : null;

  async function compose() {
    setDesign(null);
    setSource("offline");
    setLandmark("");
    setError("");
    setTrace([]);
    setTraceVisible(0);
    setPhase(1);
    setCounts({ cut: 0, score: 0, engrave: 0 });
    setWorking(true);
    // 阶段推进：识别城市 → 生成剪影，矢量化阶段在拿到结果后点亮
    const t1 = setTimeout(() => setPhase(2), 700);
    try {
      const response=await fetch("/api/scene",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
      if(!response.ok)throw new Error(t("err_scene_unavailable"));
      const result=await response.json() as Partial<SceneResult>;
      if(typeof result.city==="string"&&Array.isArray(result.paths)&&result.paths.every((path)=>typeof path==="string"&&path.length)) {
        const next=composeSilhouetteSelection(
          result.city,
          [result.landmark ?? ""],
          "2023-06-01",
          result.paths,
          { cutPaths: result.cutPaths, scorePaths: result.scorePaths, engravePaths: result.engravePaths, fillPaths: result.fillPaths },
        );
        setDesign(next);
        setLandmark(result.landmark ?? next.city.name);
        setSource(result.source==="image-gen"?"image-gen":"offline");
        setPhase(3);
        setCounts({ cut: next.cutPaths.length, score: next.scorePaths.length, engrave: next.engravePaths.length + next.fillPaths.length });
        // 回放 ReAct 思考轨迹（生成完一次性返回，逐条弹出模拟思考过程）
        const events = result.agent?.events ?? [];
        setTrace(events);
        if (events.length) {
          let i = 0;
          const step = () => { i += 1; setTraceVisible(i); if (i < events.length) setTimeout(step, 520); };
          setTimeout(step, 220);
        }
      } else {
        throw new Error(t("err_invalid_data"));
      }
    } catch (reason) {
      try {
        const fallback=composeSilhouette(prompt);
        setDesign(fallback);
        setSource("offline");
        setLandmark(fallback.landmarkNames[0] ?? fallback.city.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : (reason instanceof Error ? reason.message : t("err_unparseable")));
      }
    } finally { clearTimeout(t1); setWorking(false); }
  }

  const sourceLabel = source==="image-gen" ? t("prompt_source_ai") : t("prompt_source_offline");
  const layerSummary = design ? `${t("layer_cut")} ${design.cutPaths.length} · ${t("layer_score")} ${design.scorePaths.length} · ${t("layer_engrave")} ${design.engravePaths.length + design.fillPaths.length}` : "";  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const save = () => { if(svg&&design){ downloadFile(svg,`shike-${design.city.slug}-silhouette.svg`,"image/svg+xml"); setSaved(true); setTimeout(()=>setSaved(false),1400); } };
  const shareXhs = async () => {
    if (!svg || !design) return;
    setSharing(true);
    try {
      const png = await svgToPngBlob(svg, 2);
      downloadFile(png, `shike-${design.city.slug}-silhouette.png`, "image/png");
      const cap = t("share_xhs_caption_scene").replace("{city}", design.city.name).replace("{landmark}", landmark);
      setCaption(cap);
      await copyText(cap);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("err_png_convert"));
    } finally { setSharing(false); }
  };
  const copyCaption = async () => { if (caption) { await copyText(caption); setCopied(true); setTimeout(()=>setCopied(false),1400); } };
  const actionLabel = (a: SceneAgentEvent["action"]) => a === "search_landmarks" ? t("agent_search") : a === "finish" ? t("agent_finish") : t("agent_revise");
  const phaseLabel = [t("pipeline_identify"), t("pipeline_generate"), t("pipeline_vectorize")];
  // 数字滚动：目标值 counts，逐帧从 0 滚到目标
  const { num } = useCountUp(counts.cut + counts.score + counts.engrave, 400);

  return <section className="special-entry">
    <div className="entry-copy"><h1 dangerouslySetInnerHTML={{__html:t("prompt_title")}}/><p className="muted">{t("prompt_desc")}</p><button className="secondary" onClick={onBack}>{t("back_home")}</button></div>
    <div className="question-card glass"><label className="step" htmlFor="scene-memory">{t("prompt_label")}</label><textarea id="scene-memory" data-testid="scene-memory" className="field" rows={3} maxLength={160} placeholder={t("prompt_placeholder")} value={prompt} onChange={(event)=>setPrompt(event.target.value)} /><div className="actions"><span className="muted">{t("prompt_hint")}</span><button className="primary" disabled={working||!prompt.trim()} onClick={()=>void compose()}>{working?t("prompt_btn_working"):t("prompt_btn")}</button></div>{error && <p className="status fail" role="alert">{error}</p>}{phase > 0 && <div className="pipeline">{phaseLabel.map((label, i) => { const idx = i + 1; const isDone = idx < phase; const isActive = idx === phase; return <div key={label} className={`pipeline-step${isDone ? " is-done" : isActive ? " is-active" : ""}`}><span className="pipeline-dot"/>{isDone ? <span className="pipeline-check">✓</span> : <span>{label}</span>}{idx < 3 && <span className="pipeline-sep"/>}</div>; })}</div>}{trace.length > 0 && <div className="agent-trace"><div className="agent-trace-title">{t("agent_thinking")}</div>{trace.slice(0, traceVisible).map((ev) => <div key={ev.round} className="agent-step"><span className={`agent-badge agent-${ev.action}`}>{actionLabel(ev.action)}</span><span className="agent-decision">{ev.decision}</span></div>)}</div>}{design ? <div className={`special-preview ${working?"is-working":""}`}><object key={svg} data={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} type="image/svg+xml" aria-label={`${design.city.name}`}/></div> : <div className={`special-preview ${working?"is-working":""}`}><p className="muted" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%"}}>{working?t("prompt_working_status"):t("prompt_empty_status")}</p></div>}<div className="entry-result"><span className={`status ${report?.passed?"":"fail"}`}>{report ? report.summary : t("status_waiting")}</span><span className="muted">{design ? <><span className="num-tick">{num}</span> 条路径 · {design.city.name} · {landmark} · {sourceLabel} · {layerSummary}</> : t("status_not_generated")}</span></div>{report && !report.passed && report.issues.length > 0 && <ul className="dfm-issues" role="alert">{report.issues.map((issue, idx) => <li key={idx} className={`dfm-issue dfm-${issue.severity}`}><span className="dfm-code">{issue.code}</span><span className="dfm-severity">{issue.severity === "error" ? t("severity_error") : t("severity_warn")}</span><span className="dfm-message">{issue.message}</span></li>)}</ul>}<div className="btn-row"><button className={`primary ${saved?"is-saved":""}`} disabled={!design||!report?.passed} onClick={save}>{saved?t("saved"):t("prompt_download")}</button><button className="secondary" disabled={!design||!report?.passed||sharing} onClick={()=>void shareXhs()}>{sharing?t("share_xhs_done"):t("share_xhs")}</button></div>{caption && <div className="share-caption"><textarea readOnly value={caption}/><button className="secondary" onClick={()=>void copyCaption()}>{copied?t("share_copied"):t("share_copy")}</button></div>}</div>
  </section>;
}
