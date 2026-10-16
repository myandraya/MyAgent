"use client";

import { useState } from "react";
import { checkSilhouetteDfm, composeSilhouetteSelection, generateSilhouetteSvg, type SilhouetteDesign } from "../lib/silhouette.ts";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { ShareDialog, ShareIcon } from "./ShareCard.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { ProgressRing } from "./ProgressRing.tsx";

/** 地点定位候选（来自 /api/geocode）。 */
type GeocodeCandidate = { id: string; name: string; address: string; province: string; city: string; district: string; longitude: number; latitude: number; type: string };
/** 参考照片候选（来自 /api/photo-search）。 */
type PhotoCandidate = { title: string; thumbUrl: string; imageUrl: string; pageUrl: string; width: number; height: number; license: string };

type SceneResult = {
  city: string;
  landmark: string;
  paths: string[];
};

/** 把参考照片 URL 数组送入忠实转 SVG 链路（后端随机抽 2 张拼接），返回 cutPath。 */
async function faithfulVectorize(imageUrls: string[]): Promise<{ cutPath: string; source: "faithful" | "local" }> {
  const response = await fetch("/api/scene-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: imageUrls }),
  });
  if (!response.ok) throw new Error("faithful-failed");
  const result = await response.json() as { cutPath?: string; source?: "faithful" | "local"; error?: string };
  if (!result.cutPath) throw new Error(result.error ?? "faithful-failed");
  return { cutPath: result.cutPath, source: result.source ?? "local" };
}

export function PromptEntry({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<"input" | "locating" | "confirm" | "searching" | "working" | "done">("input");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [confirmed, setConfirmed] = useState<GeocodeCandidate | null>(null);
  const [design, setDesign] = useState<SilhouetteDesign | null>(null);
  const [sharing, setSharing] = useState(false);
  const [zooming, setZooming] = useState(false);

  const svg = design ? generateSilhouetteSvg(design) : "";
  const report = design ? checkSilhouetteDfm(design) : null;

  /** 阶段一：输入地名 → 定位，返回候选地点。 */
  async function locate() {
    const q = prompt.trim();
    if (!q) { setError(t("prompt_empty_tip")); return; }
    setError(""); setStage("locating"); setCandidates([]);
    try {
      const response = await fetch("/api/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const result = await response.json() as { ok?: boolean; reason?: string; candidates?: GeocodeCandidate[] };
      const list = result.candidates ?? [];
      if (result.ok && list.length > 0) {
        if (list.length === 1) {
          await confirmLocation(list[0]);
        } else {
          setCandidates(list); setStage("confirm");
        }
      } else {
        // 定位失败：没有可用地点，直接按用户输入写意生成。
        setCandidates([]);
        await generateFromPrompt(q);
      }
    } catch {
      setError(t("err_scene_unavailable"));
      setStage("input");
    }
  }

  /** 阶段二：确认具体地点 → 自动找参考照片；搜到直接生成，搜不到则 AI 兜底生成。 */
  async function confirmLocation(loc: GeocodeCandidate) {
    setConfirmed(loc); setStage("searching"); setError("");
    const name = loc.name;
    const queries = [
      [loc.city, name].filter(Boolean).join(" "),   // 「市 + 地名」命中率最高
      name,                                          // 只用地名
      [loc.province, loc.city, loc.district, name].filter(Boolean).join(" "), // 完整串兜底
    ];
    const searchOne = async (query: string): Promise<PhotoCandidate[]> => {
      const response = await fetch("/api/photo-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const result = await response.json() as { candidates?: PhotoCandidate[] };
      return result.candidates ?? [];
    };
    let photos: PhotoCandidate[] = [];
    try {
      for (const query of queries) {
        const found = await searchOne(query);
        if (found.length > 0) { photos = found; break; }
      }
    } catch {
      /* 搜索异常 → 视为未找到，走 AI 生成 */
    }
    if (photos.length > 0) {
      // 取 top5 照片缩略图 URL，交给后端随机抽 2 张拼接生成，提升忠实度与多样性。
      // 用 thumbUrl（640px 缩略图）而非 imageUrl（原图）：体积小、下载快、不易触发源站限流。
      const imageUrls = photos.slice(0, 5).map((p) => p.thumbUrl || p.imageUrl);
      await faithfulGenerate(imageUrls);
      return;
    }
    // 没有真实照片：直接让 AI 生成剪影，继续流程，不打断用户。
    await generateFromPrompt([loc.city, name].filter(Boolean).join(" "));
  }

  /** 搜到真实照片后：直接忠实转 SVG。 */
  async function faithfulGenerate(imageUrls: string[]) {
    setStage("working"); setError("");
    try {
      const { cutPath } = await faithfulVectorize(imageUrls);
      const landmark = confirmed?.name ?? prompt.trim();
      const next = composeSilhouetteSelection(landmark, [landmark], "2023-06-01", [], { fillPaths: [cutPath] });
      setDesign(next);
      setStage("done");
    } catch {
      // 忠实还原失败 → 写意兜底
      await generateFromPrompt(prompt.trim());
    }
  }

  /** 无真实照片时的 AI 生成：调 /api/scene 写意兜底链路。 */
  async function generateFromPrompt(sceneQuery: string) {
    setStage("working"); setError("");
    try {
      const response = await fetch("/api/scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: sceneQuery }) });
      const result = await response.json() as Partial<SceneResult> & { error?: string };
      if (result.paths && result.paths.length) {
        const next = composeSilhouetteSelection(result.city ?? prompt.trim(), [result.landmark ?? ""], "2023-06-01", result.paths);
        setDesign(next);
        setStage("done");
        return;
      }
      throw new Error(result.error ?? "scene-failed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("err_photo_process"));
      setStage("input");
    }
  }

  const save = () => { if (svg && design) { downloadFile(svg, `shike-${design.city.slug}-silhouette.svg`, "image/svg+xml"); } };
  const shareTitle = "把这一刻，雕进木头里";
  const PROMPT_MAX = 80;

  return <section className="special-entry">
    <div className="entry-copy"><h1 dangerouslySetInnerHTML={{ __html: t("prompt_title") }} /><button className="secondary" onClick={onBack}>{t("back_home")}</button></div>
    <div className="question-card glass">
      {stage === "input" && (
        <>
          <div className="field-wrap">
            <textarea id="scene-memory" data-testid="scene-memory" className="field" rows={3} maxLength={PROMPT_MAX} placeholder={t("prompt_placeholder")} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <span className={`char-count ${prompt.length >= PROMPT_MAX ? "full" : ""}`}>{prompt.length}/{PROMPT_MAX}</span>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => void locate()}>{t("prompt_btn")}</button>
          </div>
          {error && <p className="status fail" role="alert">{error}</p>}
        </>
      )}

      {stage === "locating" && (
        <div className="waiting"><div className="waiting-spinner" aria-label={t("geo_confirm_label")} /><p className="muted">{t("geo_confirm_label")}…</p></div>
      )}

      {stage === "confirm" && (
        <>
          <p className="muted" style={{ textAlign: "center", margin: "0 0 16px" }}>{t("geo_confirm_hint")}</p>
          <div className="geo-list" role="listbox" aria-label={t("geo_confirm_label")}>
            {candidates.map((c) => (
              <button key={c.id} className="geo-option" onClick={() => void confirmLocation(c)}>
                <strong>{c.name}</strong>
                <span>{[c.province, c.city, c.district, c.address].filter(Boolean).join(" · ") || c.type}</span>
              </button>
            ))}
          </div>
          <button className="regenerate-link" onClick={() => setStage("input")}>{t("back_home")}</button>
        </>
      )}

      {stage === "searching" && (
        <div className="waiting"><div className="waiting-spinner" aria-label={t("photo_search_working")} /><p className="muted">{t("photo_search_working")}</p></div>
      )}

      {stage === "working" && (
        <div className="waiting"><ProgressRing label={t("prompt_btn_working")} /><p className="muted">{t("prompt_btn_working")}</p></div>
      )}

      {stage === "done" && design && (
        <>
          <div className="compare-grid single">
            <figure className="compare-item">
              <img key={svg} className="zoom-target" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={t("compare_result")} onClick={() => setZooming(true)} />
              <figcaption>{t("compare_result")}</figcaption>
            </figure>
          </div>
          {error && <p className="status fail" role="alert">{error}</p>}
          <div className="btn-row">
            <button className="primary" disabled={!report?.passed} onClick={save}>{t("download_cta")}</button>
            <button className="secondary" onClick={() => setSharing(true)}><ShareIcon /> {t("share_btn")}</button>
          </div>
          <button className="regenerate-link" onClick={() => { setDesign(null); setStage("input"); }}>{t("regenerate_btn")}</button>
        </>
      )}
    </div>
    {sharing && design && <ShareDialog info={{ title: shareTitle, svg }} onClose={() => setSharing(false)} />}
    {zooming && svg && <Lightbox svg={svg} onClose={() => setZooming(false)} />}
  </section>;
}
