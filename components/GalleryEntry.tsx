"use client";

import { useMemo, useState } from "react";
import { GALLERY, type GalleryItem } from "../data/gallery.ts";
import { generateHollowPhotoSvg, checkHollowPhotoDfm, type HollowPhotoDesign } from "../lib/photo.ts";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { svgToPngBlob, copyText } from "../lib/share.ts";

/**
 * 图库入口：从内置城市剪影库挑一张，直接生成可激光雕刻的镂空 SVG。
 *
 * 与照片入口不同，图库的剪影已是闭合矢量轮廓，无需上传、无需 AI 生图，
 * 点选即出成品。复用 photo.ts 的镂空 SVG 生成 + DFM 检查 + 下载/分享链路。
 */

/** 把画廊剪影 path 包装成 HollowPhotoDesign（0..100 → 180×120mm）。 */
function toDesign(item: GalleryItem): HollowPhotoDesign {
  return {
    widthMm: 180,
    heightMm: 120,
    cutPath: item.path,
    cutStrokeMm: 0.08,
    minFeatureMm: 0.6,
    holeCount: 4, // 每个剪影都含内部镂空孔洞
    foregroundRatio: 0.35, // 合理主体占比，避开 DFM 的 0.03/0.85 边界
  };
}

export function GalleryEntry({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);

  const design = useMemo(() => (selected ? toDesign(selected) : null), [selected]);
  const svg = useMemo(() => (design ? generateHollowPhotoSvg(design) : ""), [design]);
  const report = useMemo(() => (design ? checkHollowPhotoDfm(design) : null), [design]);

  const save = () => {
    if (!svg || !selected) return;
    downloadFile(svg, `shike-${selected.id}-${new Date().toISOString().slice(0, 10)}.svg`, "image/svg+xml");
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const shareXhs = async () => {
    if (!svg || !selected) return;
    setSharing(true);
    try {
      const png = await svgToPngBlob(svg, 2);
      downloadFile(png, `shike-${selected.id}-${new Date().toISOString().slice(0, 10)}.png`, "image/png");
      const cap = t("share_xhs_caption_gallery")
        .replace("{city}", selected.city)
        .replace("{name}", selected.name);
      setCaption(cap);
      await copyText(cap);
    } catch (e) {
      setCaption(t("err_png_convert"));
    } finally {
      setSharing(false);
    }
  };

  const copyCaption = async () => {
    if (caption) {
      await copyText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const sizeLabel = design ? `${design.widthMm}×${design.heightMm}mm` : "";

  return (
    <section className="special-entry gallery-entry">
      <div className="entry-copy">
        <h1 dangerouslySetInnerHTML={{ __html: t("gallery_title") }} />
        <p className="muted">{t("gallery_desc")}</p>
        <button className="secondary" onClick={onBack}>{t("back_home")}</button>
      </div>

      <div className="question-card glass">
        {!selected ? (
          <div className="gallery-grid" role="listbox" aria-label={t("gallery_grid_label")}>
            {GALLERY.map((item) => (
              <button
                key={item.id}
                className="gallery-card"
                onClick={() => setSelected(item)}
                role="option"
                aria-selected="false"
              >
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <path d={item.path} fill="#0a0a0a" fillRule="evenodd" />
                </svg>
                <div className="gallery-card-meta">
                  <strong>{item.name}</strong>
                  <span>{item.cityEn}</span>
                  <small>{item.continent}</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="gallery-detail">
            <button className="secondary" onClick={() => setSelected(null)}>{t("gallery_back_grid")}</button>
            <div className="gallery-detail-head">
              <div>
                <div className="eyebrow">{selected.continentEn} · {selected.cityEn}</div>
                <h2>{selected.name}</h2>
                <p className="muted">{selected.tagline}</p>
              </div>
              <svg viewBox="0 0 100 100" aria-hidden="true" className="gallery-detail-src">
                <path d={selected.path} fill="#0a0a0a" fillRule="evenodd" />
              </svg>
            </div>

            <div className="special-preview">
              <object data={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} type="image/svg+xml" aria-label={selected.name} />
            </div>

            <div className="entry-result">
              <span className={`status ${report?.passed ? "" : "fail"}`}>{report?.summary}</span>
              <span className="muted">{t("gallery_source")} · {sizeLabel}</span>
            </div>

            {report && !report.passed && report.issues.length > 0 && (
              <ul className="dfm-issues" role="alert">
                {report.issues.map((issue, idx) => (
                  <li key={idx} className={`dfm-issue dfm-${issue.severity}`}>
                    <span className="dfm-code">{issue.code}</span>
                    <span className="dfm-severity">{issue.severity === "error" ? t("severity_error") : t("severity_warn")}</span>
                    <span className="dfm-message">{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="btn-row">
              <button className={`primary ${saved ? "is-saved" : ""}`} disabled={!report?.passed} onClick={save}>
                {saved ? t("saved") : t("photo_download")}
              </button>
              <button className="secondary" disabled={!report?.passed || sharing} onClick={() => void shareXhs()}>
                {sharing ? t("share_xhs_done") : t("share_xhs")}
              </button>
            </div>

            {caption && (
              <div className="share-caption">
                <textarea readOnly value={caption} />
                <button className="secondary" onClick={() => void copyCaption()}>{copied ? t("share_copied") : t("share_copy")}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
