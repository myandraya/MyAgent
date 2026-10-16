"use client";

import { useState } from "react";
import { checkHollowPhotoDfm, generateHollowPhotoSvg, type HollowPhotoDesign } from "../lib/photo.ts";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { ShareDialog, ShareIcon } from "./ShareCard.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { ProgressRing } from "./ProgressRing.tsx";

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

/** 浏览器端把任意支持格式（PNG/JPEG/WebP）统一转为 PNG blob，最长边压到 1024。 */
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

/** 内置示例照片：主体清晰、背景干净，供没有照片的用户一键体验。 */
const SAMPLES = [
  { src: "/samples/sample-london.jpg", labelKey: "photo_sample_london" },
  { src: "/samples/sample-beijing.jpg", labelKey: "photo_sample_beijing" },
  { src: "/samples/sample-edinburgh.png", labelKey: "photo_sample_edinburgh" },
] as const;

export function PhotoEntry({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [design, setDesign] = useState<HollowPhotoDesign | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [zooming, setZooming] = useState(false);
  /** 已选但尚未生成的照片（用户上传或示例），先展示预览，等用户点「生成剪影」才真正生成。 */
  const [pending, setPending] = useState<{ file: File; preview: string } | null>(null);
  /** 生成后用于「原图 vs 剪影」对比展示的原图预览地址。 */
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);

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
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(errMap[code] ?? t("err_photo_process"));
    } finally { setWorking(false); }
  }

  /** 用户选择/拖入照片：先转预览进入待确认态，不直接生成。 */
  function stageFile(file: File | undefined) {
    if (!file || working) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      setError(t("err_photo_size"));
      return;
    }
    setError(""); setDesign(null);
    setPending({ file, preview: URL.createObjectURL(file) });
  }

  const save = () => { if (svg) { downloadFile(svg, `shike-photo-${new Date().toISOString().slice(0, 10)}.svg`, "image/svg+xml"); } };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); stageFile(e.dataTransfer.files?.[0]); };

  /** 点示例缩略图：拉取内置图片转为 File，填入待确认状态。 */
  async function pickSample(src: string) {
    if (working) return;
    setError(""); setDesign(null);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const ext = src.endsWith(".png") ? "png" : "jpg";
      setPending({ file: new File([blob], `sample.${ext}`, { type: blob.type || "image/jpeg" }), preview: src });
    } catch { setError(t("err_photo_process")); }
  }

  /** 确认生成：把待生成的照片送入流程，并记住原图预览用于对比。 */
  function generatePending() {
    if (!pending || working) return;
    const file = pending.file;
    setSourcePreview(pending.preview);
    setPending(null);
    void processFile(file);
  }

  return <section className="special-entry">
    <div className="entry-copy"><h1 dangerouslySetInnerHTML={{ __html: t("photo_title") }} /><button className="secondary" onClick={onBack}>{t("back_home")}</button></div>
    <div className="question-card glass">
      {!working && !design && !pending && (
        <>
          <label className={`upload-zone ${dragOver ? "drag-active" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}><strong>{dragOver ? t("photo_upload_drag") : t("photo_upload_idle")}</strong><span>{t("photo_upload_hint")}</span><input data-testid="photo-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={working} onChange={(event) => stageFile(event.target.files?.[0])} /></label>
          {error && <p className="status fail" role="alert">{error}</p>}
          <div className="sample-strip" role="group" aria-label={t("photo_samples_label")}>
            <span className="sample-strip-label">{t("photo_samples_label")}</span>
            <div className="sample-strip-row">
              {SAMPLES.map((s) => (
                <button key={s.src} className="sample-thumb" onClick={() => void pickSample(s.src)} title={t(s.labelKey)}>
                  <img src={s.src} alt={t(s.labelKey)} loading="lazy" />
                  <span>{t(s.labelKey).split(" · ")[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {!working && !design && pending && (
        <>
          <div className="sample-pending">
            <img src={pending.preview} alt="" />
            <p className="muted">{t("photo_sample_pending_hint")}</p>
          </div>
          {error && <p className="status fail" role="alert">{error}</p>}
          <div className="btn-row">
            <button className="primary" onClick={generatePending}>{t("photo_generate_btn")}</button>
            <button className="secondary" onClick={() => setPending(null)}>{t("photo_sample_replace")}</button>
          </div>
        </>
      )}
      {working && (
        <div className="waiting">
          <ProgressRing label={t("photo_upload_working")} />
          <p className="muted">{t("photo_upload_working")}</p>
        </div>
      )}
      {!working && design && (
        <>
          <div className="compare-grid">
            {sourcePreview && (
              <figure className="compare-item">
                <img src={sourcePreview} alt={t("photo_compare_original")} />
                <figcaption>{t("photo_compare_original")}</figcaption>
              </figure>
            )}
            <figure className="compare-item">
              <img key={svg} className="zoom-target" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={t("photo_compare_carved")} onClick={() => setZooming(true)} />
              <figcaption>{t("photo_compare_carved")}</figcaption>
            </figure>
          </div>
          {error && <p className="status fail" role="alert">{error}</p>}
          <div className="btn-row">
            <button className="primary" disabled={!report?.passed} onClick={save}>{t("download_cta")}</button>
            <button className="secondary" onClick={() => setSharing(true)}><ShareIcon /> {t("share_btn")}</button>
          </div>
          <button className="regenerate-link" onClick={() => { setDesign(null); setError(""); setSourcePreview(null); }}>{t("regenerate_btn")}</button>
        </>
      )}
    </div>
    {sharing && design && <ShareDialog info={{ title: "把这一刻，雕进木头里", svg }} onClose={() => setSharing(false)} />}
    {zooming && svg && <Lightbox svg={svg} onClose={() => setZooming(false)} />}
  </section>;
}
