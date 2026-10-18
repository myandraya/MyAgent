"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import worldGeo from "../data/world.geo.json";
import { I18nContext, makeT } from "../lib/i18n.ts";
import { PromptEntry } from "./PromptEntry.tsx";
import { ShowcasePanel } from "./ShowcasePanel.tsx";

const transition = { type: "spring" as const, stiffness: 260, damping: 30, mass: 1 };

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
      const dy = (h - mapH) / 2;
      context.drawImage(dimMap, 0, dy, mapW, mapH);
      if (hasPointer && spotCtx) {
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
  return <canvas ref={ref} className="map-canvas" aria-label="鼠标悬停处地图亮起的世界地图"/>;
}

export function ShikeApp() {
  const [stage, setStage] = useState(0);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  // 首页直填输入框 / 示例一键带入：把文字带进 PromptEntry 的创作页
  const [seedPrompt, setSeedPrompt] = useState("");

  const t = makeT(lang);
  return (
    <I18nContext.Provider value={{ lang, t }}>
      <main className="shike">
        <div className="shell">
          <header className="topbar">
            <button className="brand" onClick={() => { try { localStorage.removeItem("shike:last-design"); } catch { /* ignore */ } setStage(0); }} style={{ border: 0, background: "none", padding: 0, cursor: "pointer" }}>MakerMuse</button>
            <div className="topbar-right">
              <div className="lang-switch">
                <button className={`lang-btn ${lang === "zh" ? "active" : ""}`} onClick={() => setLang("zh")}>中</button>
                <span className="lang-sep">/</span>
                <button className={`lang-btn ${lang === "en" ? "active" : ""}`} onClick={() => setLang("en")}>EN</button>
              </div>
              <button className="login-btn">{t("nav_login")}</button>
            </div>
          </header>

          <AnimatePresence mode="wait">
            {stage === 0 && (
              <motion.section key="home" className="hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <WorldMapCanvas />
                <div className="hero-landing">
                  <div className="hero-copy">
                    <p className="eyebrow">{t("hero_eyebrow")}</p>
                    <h1 dangerouslySetInnerHTML={{ __html: t("hero_title") }} />
                    <p className="hero-desc">{t("hero_desc")}</p>
                    <div className="hero-entries">
                      <button className="entry-card entry-primary" onClick={() => { setSeedPrompt(""); setStage(7); }}>
                        <span>{t("entry_a_span")}</span>
                        <strong>{t("entry_a_strong")} <b aria-hidden="true">→</b></strong>
                        <small>{t("entry_a_small")}</small>
                      </button>
                    </div>
                  </div>
                  <div className="hero-visual">
                    <ShowcasePanel />
                  </div>
                </div>
              </motion.section>
            )}

            {stage === 7 && (
              <motion.section key="prompt" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={transition}>
                <PromptEntry onBack={() => setStage(0)} seedPrompt={seedPrompt} />
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </main>
    </I18nContext.Provider>
  );
}
