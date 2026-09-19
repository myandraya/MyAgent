"use client";

import { useState } from "react";
import { checkHollowPhotoDfm, generateHollowPhotoSvg, type HollowPhotoDesign } from "../lib/photo.ts";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { svgToPngBlob, copyText } from "../lib/share.ts";

type PhotoApiResponse = {
  cutPath: string;
  widthMm: number;
  heightMm: number;
  threshold: number;
  holeCount: number;
  foregroundRatio: number;
  ok: boolean;
  source: "qwen" | "local";
  error?: string;
};

/**
 * 浏览器端把任意支持格式（PNG/JPEG/WebP）统一转为 PNG blob：
 *   1. createImageBitmap 解码（浏览器原生支持所有常见格式）
 *   2. canvas 缩放（最长边压到 1024，加速服务端 Potrace）
 *   3. canvas.toBlob("image/png") 输出干净 PNG
 */
async function fileToPngBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("ERR_NO_CANVAS");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("ERR_PNG_CONVERT"))), "image/png");
  });
}

export function PhotoEntry({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [design, setDesign] = useState<HollowPhotoDesign | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [source, setSource] = useState<"qwen" | "local">("local");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saved, setSaved] = useState(false);
  const [phase, setPhase] = useState(0); // 0 待机 / 1 提取主体 / 2 矢量化 / 3 完成

  const svg = design ? generateHollowPhotoSvg(design) : "";
  const report = design ? checkHollowPhotoDfm(design) : null;
  const errMap: Record<string, string> = { ERR_NO_CANVAS: t("err_no_canvas"), ERR_PNG_CONVERT: t("err_png_convert") };

  async function processFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      setError(t("err_photo_size"));
      return;
    }
    setWorking(true); setError(""); setDesign(null);
    setPhase(1);
    const t2 = setTimeout(() => setPhase(2), 800);
    try {
      const pngBlob = await fileToPngBlob(file);
      const formData = new FormData();
      formData.append("photo", pngBlob, "photo.png");
      const response = await fetch("/api/photo", { method: "POST", body: formData });
      const result = (await response.json()) as Partial<PhotoApiResponse>;
      if (!response.ok || !result.ok || typeof result.cutPath !== "string" || result.cutPath.length < 20) {
        setError(result.error ?? t("err_vectorize_failed"));
        return;
      }
      setDesign({
        widthMm: result.widthMm ?? 180,
        heightMm: result.heightMm ?? 120,
        cutPath: result.cutPath,
        cutStrokeMm: 0.08,
        minFeatureMm: 0.6,
        holeCount: typeof result.holeCount === "number" ? result.holeCount : undefined,
        foregroundRatio: typeof result.foregroundRatio === "number" ? result.foregroundRatio : undefined,
      });
      if (typeof result.threshold === "number") setThreshold(result.threshold);
      setSource(result.source === "qwen" ? "qwen" : "local");
      setPhase(3);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(errMap[code] ?? t("err_photo_process"));
    } finally { clearTimeout(t2); setWorking(false); }
  }

  const sizeLabel = design ? `${design.widthMm}×${design.heightMm}mm` : "";
  const [sharing, setSharing] = useState(false);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const save = () => { downloadFile(svg,`shike-photo-${new Date().toISOString().slice(0,10)}.svg`,"image/svg+xml"); setSaved(true); setTimeout(()=>setSaved(false),1400); };
  const shareXhs = async () => {
    if (!svg) return;
    setSharing(true);
    try {
      const png = await svgToPngBlob(svg, 2);
      downloadFile(png, `shike-photo-${new Date().toISOString().slice(0,10)}.png`, "image/png");
      const cap = t("share_xhs_caption_photo");
      setCaption(cap);
      await copyText(cap);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("err_png_convert"));
    } finally { setSharing(false); }
  };
  const copyCaption = async () => { if (caption) { await copyText(caption); setCopied(true); setTimeout(()=>setCopied(false),1400); } };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if(!working) void processFile(e.dataTransfer.files?.[0]); };
  const phaseLabel = [t("photo_pipeline_extract"), t("photo_pipeline_vectorize"), t("photo_pipeline_done")];

  return <section className="special-entry">
    <div className="entry-copy"><h1 dangerouslySetInnerHTML={{__html:t("photo_title")}}/><p className="muted">{t("photo_desc")}</p><button className="secondary" onClick={onBack}>{t("back_home")}</button></div>
    <div className="question-card glass">
      <label className={`upload-zone ${dragOver?"drag-active":""}`} onDragOver={(e)=>{e.preventDefault(); setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}><strong>{working ? t("photo_upload_working") : dragOver ? t("photo_upload_drag") : t("photo_upload_idle")}</strong><span>{t("photo_upload_hint")}</span><input data-testid="photo-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={working} onChange={(event)=>void processFile(event.target.files?.[0])}/></label>
      {error && <p className="status fail" role="alert">{error}</p>}
      {phase > 0 && <div className="pipeline">{phaseLabel.map((label, i) => { const idx = i + 1; const isDone = idx < phase; const isActive = idx === phase; return <div key={label} className={`pipeline-step${isDone ? " is-done" : isActive ? " is-active" : ""}`}><span className="pipeline-dot"/>{isDone ? <span className="pipeline-check">✓</span> : <span>{label}</span>}{idx < 3 && <span className="pipeline-sep"/>}</div>; })}</div>}
      {design && <><div className={`special-preview ${working?"is-working":""}`}><object key={svg} data={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} type="image/svg+xml" aria-label="hollow photo preview"/></div><div className="entry-result"><span className={`status ${report?.passed?"":"fail"}`}>{report?.summary}</span><span className="muted">{source === "qwen" ? t("photo_source_qwen") : t("photo_source_local")}{threshold !== null ? ` · ${t("photo_threshold")} ${threshold}` : ""} · {sizeLabel}</span></div>{report && !report.passed && report.issues.length > 0 && <ul className="dfm-issues" role="alert">{report.issues.map((issue, idx) => <li key={idx} className={`dfm-issue dfm-${issue.severity}`}><span className="dfm-code">{issue.code}</span><span className="dfm-severity">{issue.severity === "error" ? t("severity_error") : t("severity_warn")}</span><span className="dfm-message">{issue.message}</span></li>)}</ul>}<div className="btn-row"><button className={`primary ${saved?"is-saved":""}`} disabled={!report?.passed} onClick={save}>{saved?t("saved"):t("photo_download")}</button><button className="secondary" disabled={!report?.passed||sharing} onClick={()=>void shareXhs()}>{sharing?t("share_xhs_done"):t("share_xhs")}</button></div></>}
      {!design && <div className={`special-preview ${working?"is-working":""}`}><p className="muted" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%"}}>{working?t("photo_working_status"):t("photo_empty_status")}</p></div>}
      {caption && <div className="share-caption"><textarea readOnly value={caption}/><button className="secondary" onClick={()=>void copyCaption()}>{copied?t("share_copied"):t("share_copy")}</button></div>}
    </div>
  </section>;
}
