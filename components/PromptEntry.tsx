"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  candidates?: { label: string; cityEn: string; country: string; administrativeArea: string; type?: string; hint: string }[];
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
async function faithfulVectorize(imageUrls: string[], cityQuery: string, landmark?: string, attribution?: { title: string; pageUrl: string; license: string }, signal?: AbortSignal): Promise<{ cutPath: string; source: "faithful" | "local"; cityNameXml?: string; cityNameText?: string; cityNamePath?: string; cityNameLayout?: CityNameLayout; attribution?: { title: string; pageUrl: string; license: string } }> {
  const response = await fetch("/api/scene-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: imageUrls, city: cityQuery, landmark, attribution }),
    signal,
  });
  if (!response.ok) throw new Error("faithful-failed");
  const result = await response.json() as { cutPath?: string; source?: "faithful" | "local"; cityNameXml?: string; cityNameText?: string; cityNamePath?: string; cityNameLayout?: CityNameLayout; attribution?: { title: string; pageUrl: string; license: string }; error?: string };
  if (!result.cutPath) throw new Error(result.error ?? "faithful-failed");
  return { cutPath: result.cutPath, source: result.source ?? "local", cityNameXml: result.cityNameXml, cityNameText: result.cityNameText, cityNamePath: result.cityNamePath, cityNameLayout: result.cityNameLayout, attribution: result.attribution };
}

export function PromptEntry({ onBack, seedPrompt = "" }: { onBack: () => void; seedPrompt?: string }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(seedPrompt);
  const [stage, setStage] = useState<"input" | "working" | "done">("input");
  // 真实阶段：确认建筑 → 找参考照片 → 生成镂空 → 整理结构（替代假的百分比进度环）。
  const [workingPhase, setWorkingPhase] = useState<"parsing" | "searching" | "generating" | "finalizing">("parsing");
  // 错误类型：parse / search / model / timeout，用于给「可操作的下一步」。
  const [errorType, setErrorType] = useState<"parse" | "search" | "model" | "timeout" | "">("");
  const [error, setError] = useState("");
  // 搜图失败、等待用户抉择「换建筑 or 艺术创作」的降级态。
  const [fallbackPending, setFallbackPending] = useState(false);
  const [design, setDesign] = useState<SilhouetteDesign | null>(null);
  // 生成时的「原版」快照：撤销调整 / 恢复原版都回到它，改坏不必重新生成。
  const [originalDesign, setOriginalDesign] = useState<SilhouetteDesign | null>(null);
  // 重新生成时保留的「上一版」，用于前后对比（而非先清掉原结果）。
  // 存 { design, original } 元组：对比查看时连同其原版快照一起切换，避免「恢复原版」错乱。
  const [previousVersion, setPreviousVersion] = useState<{ design: SilhouetteDesign; original: SilhouetteDesign | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [zooming, setZooming] = useState(false);
  const [attribution, setAttribution] = useState<{ title: string; pageUrl: string; license: string } | null>(null);
  const [candidates, setCandidates] = useState<{ label: string; cityEn: string; country: string; administrativeArea: string; type?: string; hint: string }[]>([]);
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);
  // 已取得的参考照片素材：重试时保留，不再重新搜索。
  const [foundPhotos, setFoundPhotos] = useState<PhotoCandidate[]>([]);
  const [nameText, setNameText] = useState("");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  // 取消任务用的 AbortController。
  const abortRef = useRef<AbortController | null>(null);

  // 用 useMemo 缓存 SVG 与 DFM 结果：只在 design 真正变化时重算。
  // 之前每次渲染（含输入文字时的 setState）都同步重算 generateSilhouetteSvg + DFM，
  // 建筑 path 几十 KB + 布尔合并开销大，导致输入卡顿。
  const svg = useMemo(() => (design ? generateSilhouetteSvg(design) : ""), [design]);
  const report = useMemo(() => (design ? checkSilhouetteDfm(design) : null), [design]);

  // 持久化 key：保存当前设计，防止刷新/返回首页/误操作丢失。
  const STORAGE_KEY = "shike:last-design";

  // 挂载时恢复上次未关闭的成果（刷新/误关后回来还能接着编辑）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { design: SilhouetteDesign; original: SilhouetteDesign | null; previous?: { design: SilhouetteDesign; original: SilhouetteDesign | null } | null };
      if (saved?.design?.paths?.length) {
        setDesign(saved.design);
        setOriginalDesign(saved.original ?? saved.design);
        if (saved.previous) setPreviousVersion(saved.previous);
        setStage("done");
      }
    } catch {
      // 数据损坏时静默忽略，不阻塞正常使用。
    }
    // 只在首次挂载恢复一次，避免覆盖用户后续操作。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // design 变化时持久化（含 original 快照），刷新不丢。
  useEffect(() => {
    if (!design) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ design, original: originalDesign, previous: previousVersion }));
    } catch {
      // 存储超限/隐私模式失败时忽略，不影响当前会话内的编辑。
    }
  }, [design, originalDesign, previousVersion]);

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

  /**
   * 搜图开关：搜图忠实还原链路效果不佳，暂关闭。
   * false → 解析地点后直接走文生图兜底（/api/scene）；true → 恢复「搜真实照片→忠实还原」。
   */
  const SEARCH_ENABLED = false;

  /** 阶段一：先解析地点 → 锁定唯一实体 → 用同一地标搜图（不整句直搜、不跨实体随机拼接）。 */
  async function locate() {
    const q = prompt.trim();
    if (!q) { setError(t("prompt_empty_tip")); return; }
    resetTask();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    // 点击即进入 working 态：让进度环与阶段文案立即出现，
    // 避免在 place-parse / 搜图的长耗时里界面看起来「点了没反应」。
    setStage("working");
    setWorkingPhase("parsing");
    try {
      // 1. 地点解析：城市/地标/国家/置信度/是否需确认 + 候选列表。
      const parseResp = await fetch("/api/place-parse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q }), signal,
      });
      const parsed = await parseResp.json() as { ok?: boolean; place?: ParsedPlace };
      const place = parsed.place;
      if (!place) throw new Error("parse-failed");
      // 2. 歧义 / 无法确定：展示候选让用户点选。
      if (place.needsConfirmation || place.confidence === "low") {
        if (place.candidates && place.candidates.length > 1) {
          setCandidates(place.candidates);
          setStage("input");
          return;
        }
        fail("parse", t("error_parse"));
        setStage("input");
        return;
      }
      setResolvedPlace(toResolvedPlace(place));
      // 搜图链路暂关：直接走文生图兜底（/api/scene），跳过「搜照片→忠实还原」。
      if (!SEARCH_ENABLED) {
        await generateFromPrompt(q);
        return;
      }
      await searchAndGenerate(place, signal);
    } catch (reason) {
      if (isAbort(reason)) return;
      fail("parse", t("error_parse"), t("error_parse_action"));
      setStage("input");
    }
  }

  /** 用解析出的地点搜索同一地标的照片并生成。 */
  async function searchAndGenerate(place: ParsedPlace, signal: AbortSignal) {
    const resolved = toResolvedPlace(place);
    const searchQuery = (place.landmarkEn || place.landmark || place.cityEn || place.city || prompt.trim()).trim();
    setWorkingPhase("searching");
    try {
      const response = await fetch("/api/photo-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }), signal,
      });
      const result = await response.json() as { candidates?: PhotoCandidate[] };
      const photos = result.candidates ?? [];
      if (photos.length > 0) {
        setFoundPhotos(photos);  // 保留已取得的素材，供重试复用
        const primary = pickPrimary(photos, resolved);
        const targetId = primary.entity?.id;
        const sameEntity = targetId ? photos.filter((p) => p.entity?.id === targetId) : [primary];
        const picked = sameEntity.length ? sameEntity : [primary];
        const imageUrls = picked.slice(0, 1).map((p) => p.thumbUrl || p.imageUrl);
        await faithfulGenerate(imageUrls, picked[0], resolved, signal);
        return;
      }
      // 没搜到真实照片：明确告知，让用户抉择「换建筑 or 艺术创作」。
      fail("search", t("error_search"), t("error_search_action"));
      setFallbackPending(true);
      setStage("input");
    } catch (reason) {
      if (isAbort(reason)) return;
      // 搜图失败（网络/超时）：同样给抉择，不静默降级。
      fail("search", t("error_search"), t("error_search_action"));
      setFallbackPending(true);
      setStage("input");
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
  async function pickCandidate(candidate: { label: string; cityEn: string; country: string; administrativeArea: string; type?: string; hint: string }) {
    setCandidates([]); setError(""); setFallbackPending(false); setErrorType("");
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
    if (!SEARCH_ENABLED) {
      // 搜图链路关闭：直接文生图。
      await generateFromPrompt(candidate.label);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    await searchAndGenerate(place, controller.signal);
  }

  /** 搜到真实照片后：直接忠实转 SVG。 */
  async function faithfulGenerate(imageUrls: string[], primary: PhotoCandidate, resolved: ResolvedPlace, signal: AbortSignal) {
    setStage("working"); setError(""); setErrorType(""); setFallbackPending(false);
    setWorkingPhase("generating");
    try {
      const att = { title: primary.title, pageUrl: primary.pageUrl, license: primary.license };
      const cityForName = resolved.cityEn || primary.entity?.label || resolved.city;
      const landmarkForPrompt = resolved.landmarkEn || resolved.landmark || primary.entity?.label || "";
      const { cutPath, cityNameXml, cityNameText, cityNamePath, cityNameLayout, attribution: attBack } = await faithfulVectorize(imageUrls, cityForName, landmarkForPrompt, att, signal);
      setWorkingPhase("finalizing");
      const landmark = resolved.landmark || primary.entity?.label || resolved.city;
      const next = composeSilhouetteSelection(landmark, [landmark], "2023-06-01", [], { fillPaths: [cutPath], cityNameXml, cityNameText, cityNamePath, cityNameLayout });
      setDesign(next);
      setOriginalDesign(next);
      setAttribution(attBack ?? att);
      setStage("done");
    } catch (reason) {
      if (isAbort(reason)) return;
      // 忠实还原失败 → 给可操作提示（模型失败），保留地点身份。
      fail("model", t("error_model"), t("error_model_action"));
      setStage("input");
    }
  }

  /** 无真实照片时用户明确选择「艺术创作」→ 调 /api/scene 写意兜底。 */
  async function generateFromPrompt(sceneQuery: string) {
    resetTask();
    const controller = new AbortController();
    abortRef.current = controller;
    setStage("working");
    setWorkingPhase("generating");
    try {
      const promptForScene = resolvedPlace && resolvedPlace.landmark
        ? `${resolvedPlace.landmark}${resolvedPlace.landmarkEn ? ` (${resolvedPlace.landmarkEn})` : ""}, ${resolvedPlace.cityEn || resolvedPlace.city}`
        : resolvedPlace?.cityEn
          ? `${resolvedPlace.cityEn} ${resolvedPlace.city}`
          : sceneQuery;
      const response = await fetch("/api/scene", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptForScene }), signal: controller.signal,
      });
      const result = await response.json() as Partial<SceneResult> & { error?: string };
      if (result.paths && result.paths.length) {
        setWorkingPhase("finalizing");
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
        setOriginalDesign(next);
        setStage("done");
        return;
      }
      throw new Error(result.error ?? "scene-failed");
    } catch (reason) {
      if (isAbort(reason)) return;
      fail("model", t("error_model"), t("error_model_action"));
      setStage("input");
    }
  }

  /** 统一失败处理：记录错误类型与文案，回到可交互态。 */
  function fail(type: "parse" | "search" | "model" | "timeout", message: string, action?: string) {
    setErrorType(type);
    setError(action ? `${message}\n${action}` : message);
  }

  /** 重置任务态：清空错误/降级态/阶段，保留已确认地点与已取得素材。 */
  function resetTask() {
    setError(""); setErrorType(""); setFallbackPending(false); setCandidates([]);
    setDesign(null); setAttribution(null); setOriginalDesign(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /** 取消当前任务：中断请求，回到输入态（保留地点与已搜到的照片）。 */
  function cancelTask() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage("input");
    setError("");
    setErrorType("");
  }

  function isAbort(reason: unknown): boolean {
    return reason instanceof DOMException && reason.name === "AbortError";
  }

  /** 重试：保留已确认地点，按已有进度续跑。 */
  async function retryTask() {
    if (!SEARCH_ENABLED) {
      // 搜图链路关闭：有地点直接文生图，否则重新解析。
      if (resolvedPlace) {
        await generateFromPrompt(prompt.trim());
      } else {
        await locate();
      }
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    if (resolvedPlace && foundPhotos.length > 0) {
      // 已有地点 + 已搜到照片：直接从忠实还原续跑。
      const primary = pickPrimary(foundPhotos, resolvedPlace);
      const imageUrls = [primary.thumbUrl || primary.imageUrl];
      await faithfulGenerate(imageUrls, primary, resolvedPlace, controller.signal);
    } else if (resolvedPlace) {
      // 已确认地点但还没照片：重搜。
      const place: ParsedPlace = {
        originalText: prompt.trim(), city: resolvedPlace.city, cityEn: resolvedPlace.cityEn,
        country: resolvedPlace.country, landmark: resolvedPlace.landmark, landmarkEn: resolvedPlace.landmarkEn,
        mood: "", confidence: "high", needsConfirmation: false, reason: "重试。",
      };
      await searchAndGenerate(place, controller.signal);
    } else {
      // 尚未确认地点：重新解析。
      await locate();
    }
  }

  /** 阶段文案映射。 */
  function phaseLabel(phase: "parsing" | "searching" | "generating" | "finalizing", translate: (k: string) => string): string {
    switch (phase) {
      case "parsing": return translate("phase_parsing");
      case "searching": return translate("phase_searching");
      case "generating": return translate("phase_generating");
      case "finalizing": return translate("phase_finalizing");
    }
  }

  const save = () => { if (svg && design) { downloadFile(svg, `shike-${design.city.slug}-silhouette.svg`, "image/svg+xml"); } };

  /** 保存为草稿：即使制造检查未通过也允许导出，文件名明确标注 draft，避免投入丢失。 */
  const saveDraft = () => {
    if (svg && design) {
      downloadFile(svg, `shike-${design.city.slug}-silhouette-DRAFT.svg`, "image/svg+xml");
    }
  };

  /**
   * 返回首页：先清掉本地缓存的成果，再回首页。
   * 目的：主动「返回首页」应视为「这次创作结束」，下次进来是全新的输入态；
   * 而「刷新页面/误关标签页」不清缓存，仍会恢复上次成果（防丢失功能不受影响）。
   */
  function handleBack() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    onBack();
  }

  /** 撤销最后一次调整：回到上一个设计（若只有原版则回到原版）。 */
  function undoAdjustment() {
    if (!design) return;
    if (originalDesign && design !== originalDesign) {
      setDesign(originalDesign);
      setNameText(originalDesign.cityNameText ?? "");
      setOrientation(originalDesign.orientation ?? "portrait");
      setAdjustError("");
    }
  }

  /** 恢复原版：丢弃所有调整，回到刚生成时的原始设计。 */
  function restoreOriginal() {
    if (!originalDesign) return;
    setDesign(originalDesign);
    setNameText(originalDesign.cityNameText ?? "");
    setOrientation(originalDesign.orientation ?? "portrait");
    setAdjustError("");
  }

  /** 是否已偏离原版（有可撤销/可恢复的改动）。 */
  const hasChanges = design !== null && originalDesign !== null && design !== originalDesign;

  /** 重新生成：保留当前成果为「上一版」供对比，回到输入态重新开始。 */
  function beginRegenerate() {
    if (design) setPreviousVersion({ design, original: originalDesign });
    setDesign(null);
    setOriginalDesign(null);
    setAttribution(null);
    setStage("input");
    // 保留 resolvedPlace 与 foundPhotos，重试/复用更顺；清空输入让用户重写。
  }

  /** 在「上一版」与「当前版」之间切换对比。 */
  function togglePrevious() {
    if (!previousVersion || !design) return;
    // 把当前版连同其原版快照一起暂存，再显示上一版；再点一次切回。
    const currentVersion = { design, original: originalDesign };
    setDesign(previousVersion.design);
    setOriginalDesign(previousVersion.original);
    setPreviousVersion(currentVersion);
    setNameText(previousVersion.design.cityNameText ?? "");
    setOrientation(previousVersion.design.orientation ?? "portrait");
  }

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

  // 当前确认的建筑名（供 searching/working/done 阶段全程回显，让用户始终看见自己选的是哪栋）。
  const currentBuilding = resolvedPlace?.landmark || resolvedPlace?.city || design?.landmarkNames?.[0] || "";

  return <section className="special-entry">
    <div className="entry-copy"><h1 dangerouslySetInnerHTML={{ __html: t("prompt_title") }} /><button className="secondary" onClick={handleBack}>{t("back_home")}</button></div>
    <div className="question-card glass">
      {stage === "input" && (
        <>
          <div className="field-wrap">
            <textarea id="scene-memory" data-testid="scene-memory" className="field" rows={3} maxLength={PROMPT_MAX} placeholder={t("prompt_placeholder")} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <span className={`char-count ${prompt.length >= PROMPT_MAX ? "full" : ""}`}>{prompt.length}/{PROMPT_MAX}</span>
          </div>

          {/* 常驻说明：不依赖输入后就消失的 placeholder */}
          <p className="prompt-howto">{t("prompt_howto")}</p>
          <p className="prompt-limit-note">{t("prompt_limit_note")}</p>

          {/* 可点击示例：一键带入输入框 */}
          <div className="prompt-examples" role="group" aria-label={t("prompt_examples_label")}>
            <span className="prompt-examples-label">{t("prompt_examples_label")}</span>
            {[t("prompt_example_paris"), t("prompt_example_london"), t("prompt_example_sydney")].map((s) => (
              <button key={s} type="button" className="prompt-example" onClick={() => setPrompt(s)}>{s}</button>
            ))}
          </div>

          {candidates.length > 1 ? (
            <div className="candidate-list" role="group" aria-label="选择地点">
              <p className="candidate-hint">这名字，去往过好几处。你想念的是哪一栋？</p>
              {candidates.map((candidate, index) => (
                <button key={`${candidate.label}-${index}`} className="candidate-item" onClick={() => void pickCandidate(candidate)}>
                  <span className="candidate-label">{candidate.label}</span>
                  <span className="candidate-meta">
                    {candidate.type ? <span className="candidate-type">{candidate.type}</span> : null}
                    {candidate.cityEn ? <span className="candidate-city">{candidate.cityEn}</span> : null}
                    {candidate.country ? <span className="candidate-country">{candidate.country}</span> : null}
                    {candidate.administrativeArea ? <span className="candidate-admin">{candidate.administrativeArea}</span> : null}
                    {candidate.hint ? <span className="candidate-hint-text">— {candidate.hint}</span> : null}
                  </span>
                </button>
              ))}
              <button className="secondary candidate-skip" onClick={() => setCandidates([])}>都不是，我重新说</button>
            </div>
          ) : (
            <div className="actions">
              <button className="primary" onClick={() => void locate()}>{t("prompt_btn")}</button>
            </div>
          )}
          {fallbackPending && (
            <div className="fallback-choice" role="group" aria-label="无参考图时的选择">
              <p className="fallback-choice-title">{t("error_search")}</p>
              <p className="fallback-choice-hint">{t("artistic_switch_hint")}</p>
              <div className="fallback-choice-actions">
                <button className="secondary" onClick={() => { setFallbackPending(false); }}>{t("change_building_btn")}</button>
                <button className="primary" onClick={() => { setFallbackPending(false); void generateFromPrompt(prompt.trim()); }}>{t("artistic_create_btn")}</button>
              </div>
            </div>
          )}
          {error && !fallbackPending && (
            <div className="status fail" role="alert">
              <p style={{ whiteSpace: "pre-line" }}>{error}</p>
              {errorType !== "parse" && (
                <button className="secondary error-retry" onClick={() => void retryTask()}>{t("retry_btn")}</button>
              )}
            </div>
          )}
        </>
      )}

      {stage === "working" && (
        <div className="waiting">
          <ProgressRing label={phaseLabel(workingPhase, t)} />
          <p className="muted">{phaseLabel(workingPhase, t)}</p>
          {currentBuilding && <p className="selected-building">{t("selected_building")}：{currentBuilding}</p>}
          <p className="muted working-timeout-hint">{t("working_timeout_hint")}</p>
          <button className="secondary working-cancel" onClick={cancelTask}>{t("working_cancel")}</button>
        </div>
      )}

      {stage === "done" && design && (
        <>
          {currentBuilding && <p className="selected-building done">{t("selected_building")}：{currentBuilding}</p>}
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

          {/* 尺寸 + 版本控制：让用户对成果有控制感（成品宽高 / 撤销 / 恢复原版 / 对比上一版） */}
          <div className="result-meta">
            <span className="result-size">{orientation === "landscape" ? t("size_landscape") : t("size_portrait")}</span>
            <span className="result-meta-spacer" />
            {previousVersion && (
              <button className="link-btn" onClick={togglePrevious}>{t("compare_prev_btn")}</button>
            )}
            {hasChanges && (
              <button className="link-btn" onClick={undoAdjustment}>{t("undo_btn")}</button>
            )}
            {hasChanges && (
              <button className="link-btn" onClick={restoreOriginal}>{t("restore_btn")}</button>
            )}
          </div>

          <div className="adjust-panel">
            <div className="adjust-row">
              <label className="adjust-label" htmlFor="city-name-input">{t("name_label")}</label>
              <input
                id="city-name-input"
                className="field adjust-input"
                type="text"
                maxLength={40}
                value={nameText}
                placeholder={t("name_placeholder")}
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
            <p className="name-limit-hint">{t("name_hint")}</p>
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
          {/* 制造检查结果：明确展示通过/未通过与具体原因，未通过不再只留灰按钮 */}
          {report && (
            <div className={`dfm-status ${report.passed ? "pass" : "fail"}`} role="status">
              <div className="dfm-status-head">
                <span className={`dfm-badge ${report.passed ? "pass" : "fail"}`}>
                  {report.passed ? "✓" : "!"}
                </span>
                <div className="dfm-status-title">
                  <strong>{report.passed ? t("dfm_status_pass") : t("dfm_status_fail")}</strong>
                  <span>{report.passed ? t("dfm_pass_hint") : t("dfm_fail_hint")}</span>
                </div>
              </div>
              {!report.passed && (
                <ul className="dfm-issues">
                  {report.issues.filter((i) => i.severity === "error").map((issue, i) => (
                    <li key={i} className="dfm-issue">{issue.message}</li>
                  ))}
                  {report.issues.filter((i) => i.severity === "warning").map((issue, i) => (
                    <li key={`w${i}`} className="dfm-issue warn">{issue.message}</li>
                  ))}
                </ul>
              )}
              {!report.passed && (
                <p className="dfm-fix-hint">{t("dfm_fix_hint")}</p>
              )}
            </div>
          )}

          {/* 下载前须知：格式 / 尺寸 / 保留与切穿 / 导入方式 */}
          <details className="make-guide">
            <summary>{t("make_guide_btn")}</summary>
            <div className="make-guide-body">
              <ul className="make-guide-list">
                <li><span>{t("file_format_label")}</span><span>{t("file_format_value")}</span></li>
                <li><span>{t("size_label")}</span><span>{orientation === "landscape" ? t("size_landscape") : t("size_portrait")}</span></li>
                <li><span>{t("layer_keep")}</span><span>{design.fillPaths.length} 处保留实心</span></li>
                <li><span>{t("layer_cut_through")}</span><span>{design.cutPaths.length} 处切穿轮廓</span></li>
                <li><span>{t("layer_engrave_line")}</span><span>{design.engravePaths.length + design.scorePaths.length} 处描线</span></li>
              </ul>
              <p className="make-guide-import">{t("import_hint")}</p>
            </div>
          </details>

          <div className="btn-row">
            <button className="primary" disabled={!report?.passed} onClick={save}>{t("download_file_btn")}</button>
            {!report?.passed && (
              <button className="secondary" onClick={saveDraft}>{t("download_draft_btn")}</button>
            )}
            <button className="secondary" onClick={() => setSharing(true)}><ShareIcon /> {t("share_btn")}</button>
          </div>
          <button className="regenerate-link" onClick={beginRegenerate}>{t("regenerate_btn")}</button>
        </>
      )}
    </div>
    {sharing && design && <ShareDialog info={{ title: shareTitle, svg }} onClose={() => setSharing(false)} />}
    {zooming && svg && <Lightbox svg={svg} onClose={() => setZooming(false)} />}
  </section>;
}
