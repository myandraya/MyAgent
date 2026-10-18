"use client";

import { useEffect, useMemo, useState } from "react";
import { checkSilhouetteDfm, composeSilhouetteSelection, generateSilhouetteSvg, type SilhouetteDesign } from "../lib/silhouette.ts";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { ShareDialog, ShareIcon } from "./ShareCard.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { ProgressRing } from "./ProgressRing.tsx";

/** 参考照片候选（来自 /api/photo-search）。 */
type PhotoCandidate = {
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  license: string;
  entity?: { id: string; label: string; description: string };
};

/** 地点解析结果（来自 /api/place-parse）。 */
type ParsedPlace = {
  originalText: string;
  city: string;
  cityEn: string;
  country: string;
  landmark: string;
  landmarkEn: string;
  mood: string;
  confidence: "high" | "low";
  needsConfirmation: boolean;
  reason: string;
  candidates?: { label: string; cityEn: string; country: string; administrativeArea: string; hint: string }[];
};

/**
 * 确认后的地点身份（贯穿搜索/生成/重试的稳定记录，对齐方案 S03）。
 * 名称只是检索别名，身份字段才决定主体不漂移。
 */
type ResolvedPlace = {
  cityEn: string;
  city: string;
  country: string;
  administrativeArea: string;
  landmarkEn: string;
  landmark: string;
  confirmationStatus: "confirmed" | "needs_confirmation" | "place_not_found";
};

type SceneResult = {
  city: string;
  landmark: string;
  paths: string[];
  fillPaths?: string[];
  engravePaths?: string[];
  cityNameXml?: string;
  cityNameText?: string;
  cityNamePath?: string;
  cityNameLayout?: { x: number; baselineY: number; glyphTopY: number };
};

type CityNameLayout = { x: number; baselineY: number; glyphTopY: number };

type CityNameResult = {
  ok: boolean;
  cityNameXml?: string;
  cityNameText?: string;
  cityNamePath?: string;
  cityNameLayout?: CityNameLayout;
  orientation?: "portrait" | "landscape";
  error?: string;
};

/** 生成后调整文字内容 / 横竖幅：调服务端重新排版字形，返回新字形与布局。 */
async function relayoutCityName(text: string, orientation: "portrait" | "landscape"): Promise<CityNameResult> {
  const response = await fetch("/api/city-name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, orientation }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "relayout-failed");
  }
  return response.json() as Promise<CityNameResult>;
}

/** 把「同一地标」的参考照片送入忠实转 SVG 链路，返回 cutPath 与城市名信息。 */
async function faithfulVectorize(imageUrls: string[], cityQuery: string, landmark?: string, attribution?: { title: string; pageUrl: string; license: string }): Promise<{ cutPath: string; source: "faithful" | "local"; cityNameXml?: string; cityNameText?: string; cityNamePath?: string; cityNameLayout?: CityNameLayout; attribution?: { title: string; pageUrl: string; license: string } }> {
  const response = await fetch("/api/scene-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: imageUrls, city: cityQuery, landmark, attribution }),
  });
  if (!response.ok) throw new Error("faithful-failed");
  const result = await response.json() as { cutPath?: string; source?: "faithful" | "local"; cityNameXml?: string; cityNameText?: string; cityNamePath?: string; cityNameLayout?: CityNameLayout; attribution?: { title: string; pageUrl: string; license: string }; error?: string };
  if (!result.cutPath) throw new Error(result.error ?? "faithful-failed");
  return { cutPath: result.cutPath, source: result.source ?? "local", cityNameXml: result.cityNameXml, cityNameText: result.cityNameText, cityNamePath: result.cityNamePath, cityNameLayout: result.cityNameLayout, attribution: result.attribution };
}

export function PromptEntry({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<"input" | "searching" | "working" | "done">("input");
  const [error, setError] = useState("");
  const [design, setDesign] = useState<SilhouetteDesign | null>(null);
  const [sharing, setSharing] = useState(false);
  const [zooming, setZooming] = useState(false);
  const [attribution, setAttribution] = useState<{ title: string; pageUrl: string; license: string } | null>(null);
  const [candidates, setCandidates] = useState<{ label: string; cityEn: string; country: string; administrativeArea: string; hint: string }[]>([]);
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);
  const [nameText, setNameText] = useState("");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState("");

  // 用 useMemo 缓存 SVG 与 DFM 结果：只在 design 真正变化时重算。
  // 之前每次渲染（含输入文字时的 setState）都同步重算 generateSilhouetteSvg + DFM，
  // 建筑 path 几十 KB + 布尔合并开销大，导致输入卡顿。
  const svg = useMemo(() => (design ? generateSilhouetteSvg(design) : ""), [design]);
  const report = useMemo(() => (design ? checkSilhouetteDfm(design) : null), [design]);

  // design 就绪时，同步「文字内容」与「方向」的编辑态初值。
  useEffect(() => {
    if (design) {
      setNameText(design.cityNameText ?? "");
      setOrientation(design.orientation ?? "portrait");
    }
  }, [design]);

  /** 把 ParsedPlace 收敛成贯穿全程的 ResolvedPlace 身份。 */
  function toResolvedPlace(place: ParsedPlace): ResolvedPlace {
    return {
      cityEn: place.cityEn || place.city,
      city: place.city,
      country: place.country || "",
      administrativeArea: "",
      landmarkEn: place.landmarkEn || "",
      landmark: place.landmark || "",
      confirmationStatus: "confirmed",
    };
  }

  /** 阶段一：先解析地点 → 锁定唯一实体 → 用同一地标搜图（不整句直搜、不跨实体随机拼接）。 */
  async function locate() {
    const q = prompt.trim();
    if (!q) { setError(t("prompt_empty_tip")); return; }
    setError(""); setStage("searching"); setAttribution(null); setCandidates([]);
    try {
      // 1. 地点解析：城市/地标/国家/置信度/是否需确认 + 候选列表。
      const parseResp = await fetch("/api/place-parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q }) });
      const parsed = await parseResp.json() as { ok?: boolean; place?: ParsedPlace };
      const place = parsed.place;
      if (!place) throw new Error("parse-failed");
      // 2. 歧义 / 无法确定：展示候选让用户点选（文艺提示）。
      if (place.needsConfirmation || place.confidence === "low") {
        if (place.candidates && place.candidates.length > 1) {
          setCandidates(place.candidates);
          setStage("input");
          return;
        }
        setError("这栋建筑，抓抓还没听清。\n再多说一点点——是哪座城、哪栋楼呢？");
        setStage("input");
        return;
      }
      setResolvedPlace(toResolvedPlace(place));
      await searchAndGenerate(place);
    } catch {
      // 解析/搜图异常 → 降级到 AI 写意生成，不打断用户。
      await generateFromPrompt(q);
    }
  }

  /** 用解析出的地点搜索同一地标的照片并生成。 */
  async function searchAndGenerate(place: ParsedPlace) {
    const resolved = toResolvedPlace(place);
    // 搜索词优先地标（锁定建筑），其次城市；整句不再直接塞给实体搜索。
    const searchQuery = (place.landmarkEn || place.landmark || place.cityEn || place.city || prompt.trim()).trim();
    try {
      const response = await fetch("/api/photo-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const result = await response.json() as { candidates?: PhotoCandidate[] };
      const photos = result.candidates ?? [];
      if (photos.length > 0) {
        // 锁定唯一实体：优先取「标签与确认地点/地标最接近」的候选所属实体，只保留同一实体的照片。
        const primary = pickPrimary(photos, resolved);
        const targetId = primary.entity?.id;
        const sameEntity = targetId ? photos.filter((p) => p.entity?.id === targetId) : [primary];
        const picked = sameEntity.length ? sameEntity : [primary];
        const imageUrls = picked.slice(0, 1).map((p) => p.thumbUrl || p.imageUrl);
        await faithfulGenerate(imageUrls, picked[0], resolved);
        return;
      }
      // 没搜到真实照片：明确走 AI 写意生成。
      await generateFromPrompt(prompt.trim());
    } catch {
      await generateFromPrompt(prompt.trim());
    }
  }

  /** 从候选里选出与确认地点最匹配的一张作为主参考（优先同名地标，其次同城市标签）。 */
  function pickPrimary(photos: PhotoCandidate[], resolved: ResolvedPlace): PhotoCandidate {
    if (resolved.landmarkEn) {
      const byLandmark = photos.find((p) => (p.entity?.label ?? "").toLowerCase().includes(resolved.landmarkEn.toLowerCase()) || (p.title ?? "").toLowerCase().includes(resolved.landmarkEn.toLowerCase()));
      if (byLandmark) return byLandmark;
    }
    if (resolved.cityEn) {
      const byCity = photos.find((p) => (p.entity?.label ?? "").toLowerCase().includes(resolved.cityEn.toLowerCase()));
      if (byCity) return byCity;
    }
    return photos[0];
  }

  /** 用户从候选里选定一个地点后：用它锁定并搜图。 */
  async function pickCandidate(candidate: { label: string; cityEn: string; country: string; administrativeArea: string; hint: string }) {
    setCandidates([]); setError(""); setStage("searching");
    const place: ParsedPlace = {
      originalText: prompt.trim(),
      city: candidate.label,
      cityEn: candidate.cityEn || candidate.label,
      country: candidate.country || "",
      landmark: "",
      landmarkEn: "",
      mood: "",
      confidence: "high",
      needsConfirmation: false,
      reason: "用户从候选确认。",
    };
    setResolvedPlace({ ...toResolvedPlace(place), administrativeArea: candidate.administrativeArea || "" });
    await searchAndGenerate(place);
  }

  /** 阶段二：确认具体地点 → 自动找参考照片；搜到直接生成，搜不到则 AI 兜底生成。 */
  /** 搜到真实照片后：直接忠实转 SVG。 */
  async function faithfulGenerate(imageUrls: string[], primary: PhotoCandidate, resolved: ResolvedPlace) {
    setStage("working"); setError("");
    try {
      const att = { title: primary.title, pageUrl: primary.pageUrl, license: primary.license };
      // 城市名排版使用确认后的标准城市名（resolved.cityEn），不重新从整句推断。
      // 地标名一路传给图像转换指令，锁定主体（S03 身份贯穿）。
      const cityForName = resolved.cityEn || primary.entity?.label || resolved.city;
      const landmarkForPrompt = resolved.landmarkEn || resolved.landmark || primary.entity?.label || "";
      const { cutPath, cityNameXml, cityNameText, cityNamePath, cityNameLayout, attribution: attBack } = await faithfulVectorize(imageUrls, cityForName, landmarkForPrompt, att);
      const landmark = resolved.landmark || primary.entity?.label || resolved.city;
      const next = composeSilhouetteSelection(landmark, [landmark], "2023-06-01", [], { fillPaths: [cutPath], cityNameXml, cityNameText, cityNamePath, cityNameLayout });
      setDesign(next);
      setAttribution(attBack ?? att);
      setStage("done");
    } catch {
      // 忠实还原失败 → 写意兜底（保留已确认地点身份，不重新随机选主体）。
      await generateFromPrompt(prompt.trim());
    }
  }

  /** 无真实照片时的 AI 生成：调 /api/scene 写意兜底链路。 */
  async function generateFromPrompt(sceneQuery: string) {
    setStage("working"); setError("");
    try {
      // 切换到艺术创作时，保留已确认的城市/地标约束（方案 S03），除非用户主动更换。
      const promptForScene = resolvedPlace && resolvedPlace.landmark
        ? `${resolvedPlace.landmark}${resolvedPlace.landmarkEn ? ` (${resolvedPlace.landmarkEn})` : ""}, ${resolvedPlace.cityEn || resolvedPlace.city}`
        : resolvedPlace?.cityEn
          ? `${resolvedPlace.cityEn} ${resolvedPlace.city}`
          : sceneQuery;
      const response = await fetch("/api/scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: promptForScene }) });
      const result = await response.json() as Partial<SceneResult> & { error?: string };
      if (result.paths && result.paths.length) {
        // 关键：必须把后端下发的 fillPaths（Potrace 实心闭合轮廓）放进填充层，
        // 而不是把合并后的 paths 塞进 engrave 描线层 —— 否则建筑会被描成线条而非实心剪纸。
        const fillPaths = Array.isArray(result.fillPaths) && result.fillPaths.length ? result.fillPaths : [];
        const engravePaths = fillPaths.length ? [] : result.paths;
        const next = composeSilhouetteSelection(result.city ?? prompt.trim(), [result.landmark ?? ""], "2023-06-01", [], {
          fillPaths,
          engravePaths,
          cityNameXml: result.cityNameXml,
          cityNameText: result.cityNameText,
          cityNamePath: result.cityNamePath,
          cityNameLayout: result.cityNameLayout,
        });
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

  /**
   * 生成后调整：改文字内容 / 切横竖幅。只重排版字形，不动建筑/相框/横条。
   * 调 /api/city-name 取新字形 path + 布局，替换 design 对应字段后重渲染。
   */
  async function applyAdjustment(nextText: string, nextOrientation: "portrait" | "landscape") {
    if (!design) return;
    setAdjusting(true); setAdjustError("");
    try {
      const res = await relayoutCityName(nextText, nextOrientation);
      if (!res.ok || !res.cityNameLayout) throw new Error(res.error ?? "relayout-failed");
      setDesign({
        ...design,
        cityNameXml: res.cityNameXml ?? "",
        cityNameText: res.cityNameText ?? nextText,
        cityNamePath: res.cityNamePath ?? "",
        cityNameLayout: res.cityNameLayout,
        orientation: nextOrientation,
      });
      setNameText(res.cityNameText ?? nextText);
      setOrientation(nextOrientation);
    } catch (reason) {
      setAdjustError(reason instanceof Error ? reason.message : "文字调整失败，请重试。");
    } finally {
      setAdjusting(false);
    }
  }

  /** 横竖幅切换（复用 applyAdjustment，文字内容不变）。 */
  function toggleOrientation() {
    const next = orientation === "portrait" ? "landscape" : "portrait";
    void applyAdjustment(nameText || design?.cityNameText || "", next);
  }
  const shareTitle = "把那栋你忘不掉的楼，刻下来";
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
          {candidates.length > 1 ? (
            <div className="candidate-list" role="group" aria-label="选择地点">
              <p className="candidate-hint">这名字，去往过好几处。你想念的是哪一栋？</p>
              {candidates.map((candidate, index) => (
                <button key={`${candidate.label}-${index}`} className="candidate-item" onClick={() => void pickCandidate(candidate)}>
                  <span className="candidate-label">{candidate.label}</span>
                  <span className="candidate-meta">{candidate.country}{candidate.administrativeArea ? ` · ${candidate.administrativeArea}` : ""}{candidate.hint ? ` — ${candidate.hint}` : ""}</span>
                </button>
              ))}
              <button className="secondary candidate-skip" onClick={() => setCandidates([])}>都不是，我重新说</button>
            </div>
          ) : (
            <div className="actions">
              <button className="primary" onClick={() => void locate()}>{t("prompt_btn")}</button>
            </div>
          )}
          {error && <p className="status fail" role="alert" style={{ whiteSpace: "pre-line" }}>{error}</p>}
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
          {attribution ? (
            <p className="muted attribution">
              参考图：{attribution.title}
              {attribution.license ? ` · ${attribution.license}` : ""}
              {attribution.pageUrl ? (
                <> · <a href={attribution.pageUrl} target="_blank" rel="noreferrer">来源</a></>
              ) : null}
            </p>
          ) : (
            <p className="muted attribution">AI 想象创作（非实景还原）。</p>          )}
          {error && <p className="status fail" role="alert">{error}</p>}
          <div className="adjust-panel">
            <div className="adjust-row">
              <label className="adjust-label" htmlFor="city-name-input">城市名</label>
              <input
                id="city-name-input"
                className="field adjust-input"
                type="text"
                maxLength={40}
                value={nameText}
                placeholder="如 Cologne"
                onChange={(event) => setNameText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void applyAdjustment(nameText, orientation); }}
              />
              <button
                className="primary adjust-apply"
                disabled={adjusting || !nameText.trim() || nameText.trim() === design.cityNameText}
                onClick={() => void applyAdjustment(nameText, orientation)}
              >
                {adjusting ? "排版中…" : "替换"}
              </button>
            </div>
            <div className="adjust-row">
              <span className="adjust-label">方向</span>
              <div className="segmented" role="group" aria-label="排版方向">
                <button className={`segment ${orientation === "portrait" ? "on" : ""}`} disabled={adjusting} onClick={() => { if (orientation !== "portrait") void applyAdjustment(nameText || design.cityNameText || "", "portrait"); }}>竖幅</button>
                <button className={`segment ${orientation === "landscape" ? "on" : ""}`} disabled={adjusting} onClick={() => { if (orientation !== "landscape") void applyAdjustment(nameText || design.cityNameText || "", "landscape"); }}>横幅</button>
              </div>
              {adjusting && <span className="muted adjust-hint">排版中…</span>}
            </div>
            {adjustError && <p className="status fail" role="alert">{adjustError}</p>}
          </div>
          <div className="btn-row">
            <button className="primary" disabled={!report?.passed} onClick={save}>{t("download_cta")}</button>
            <button className="secondary" onClick={() => setSharing(true)}><ShareIcon /> {t("share_btn")}</button>
          </div>
          <button className="regenerate-link" onClick={() => { setDesign(null); setAttribution(null); setStage("input"); }}>{t("regenerate_btn")}</button>
        </>
      )}
    </div>
    {sharing && design && <ShareDialog info={{ title: shareTitle, svg }} onClose={() => setSharing(false)} />}
    {zooming && svg && <Lightbox svg={svg} onClose={() => setZooming(false)} />}
  </section>;
}
