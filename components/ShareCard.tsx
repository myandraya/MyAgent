"use client";

import { useState } from "react";
import { useI18n } from "../lib/i18n.ts";
import { downloadFile } from "./download.ts";
import { svgToPngBlob } from "../lib/share.ts";

export type ShareCardInfo = {
  /** 作品标题（城市名 / 地标名） */
  title: string;
  /** 作品 SVG 字符串（完整 <svg>…</svg>） */
  svg: string;
};

/** 提取 <svg> 的内部内容（去掉外层标签），用于嵌入分享卡片。 */
function svgInner(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

/** 提取原 SVG 的 viewBox，用于正确缩放入卡。 */
function svgViewBox(svg: string): string {
  const m = svg.match(/viewBox="([^"]+)"/);
  return m ? m[1] : "0 0 180 120";
}

/**
 * 用 SVG 构建分享卡片（1200×1440），完全对齐 MakerMuse 浅色白底 + slate 灰阶风格：
 * 顶部品牌行 → 标题 + 日期 → 白底作品预览 → 底部用户头像 + 二维码 + slogan。
 */
export function buildShareCardSvg(info: ShareCardInfo): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const inner = svgInner(info.svg);
  const viewBox = svgViewBox(info.svg);
  const [vbW, vbH] = (() => {
    const parts = viewBox.split(/\s+/).map(Number);
    return [parts[2] || 180, parts[3] || 120];
  })();
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  // 作品预览区：900×560，居中嵌入 SVG（等比缩放，保留留白）
  const previewW = 900, previewH = 560;
  const scale = Math.min((previewW - 80) / vbW, (previewH - 80) / vbH);
  const dx = (previewW - vbW * scale) / 2;
  const dy = (previewH - vbH * scale) / 2;

  // 二维码占位（装饰图形，正式版接真二维码）
  const qrCells: string[] = [];
  for (let r = 0; r < 9; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      const corner = (r < 3 && c < 3) || (r < 3 && c > 5) || (r > 5 && c < 3);
      const on = corner ? (r === 1 && c === 1 ? false : true) : (r * 9 + c) % 3 !== 1;
      if (on) qrCells.push(`<rect x="${c * 12}" y="${r * 12}" width="10" height="10"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1440" viewBox="0 0 1200 1440">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#ea580c"/>
    </linearGradient>
  </defs>
  <!-- 背景：浅色白底 -->
  <rect width="1200" height="1440" fill="#f8fafc"/>
  <!-- 顶部品牌行 -->
  <g transform="translate(80 96)">
    <circle cx="0" cy="0" r="20" fill="url(#brand)"/>
    <text x="40" y="12" text-anchor="start" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="44" font-weight="700" fill="#0f172a">建筑木刻师 <tspan font-weight="500" fill="#64748b">ARCHITECTURE WOODCARVER</tspan></text>
  </g>
  <!-- 标题 + 日期 -->
  <text x="80" y="240" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="64" font-weight="700" fill="#0f172a">${esc(info.title.slice(0, 16))}</text>
  <text x="80" y="300" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="28" fill="#94a3b8">${esc("创作完成 · " + dateStr)}</text>
  <!-- 作品预览（白底描边圆角） -->
  <g transform="translate(150 340)">
    <rect width="900" height="560" rx="24" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
    <g transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${scale.toFixed(4)})">${inner}</g>
  </g>
  <!-- 底部：用户 + 二维码 -->
  <g transform="translate(80 1000)">
    <circle cx="36" cy="36" r="36" fill="#f97316"/>
    <text x="36" y="50" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="32" font-weight="700" fill="#ffffff">建</text>
    <text x="92" y="48" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="30" font-weight="600" fill="#0f172a">建筑木刻师</text>
  </g>
  <g transform="translate(1040 1000)">
    <rect x="-16" y="-16" width="144" height="144" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
    <g fill="#0f172a">${qrCells.join("")}</g>
  </g>
  <!-- 底部 slogan + 版权 -->
  <text x="600" y="1290" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="28" fill="#64748b">${esc("建筑木刻师 · 把那栋你忘不掉的楼，刻下来")}</text>
  <text x="600" y="1332" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="22" fill="#cbd5e1">${esc("© 2026 建筑木刻师 Architecture Woodcarver")}</text>
</svg>`;
}

/** Lucide 风格分享图标（share-2：三圆点连线）。 */
export function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </svg>
  );
}

/** Lucide 风格下载图标。 */
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

/** 通用分享平台占位图标（后续替换为真实平台图标）。 */
function PlatformIcon({ label }: { label: string }) {
  const initials: Record<string, string> = { "微信": "微", "小红书": "红", "微博": "博", "朋友圈": "圈", "复制链接": "链" };
  return (
    <span className="share-platform" title={label}>
      <span className="share-platform-icon">{initials[label] ?? label.slice(0, 1)}</span>
      <span className="share-platform-label">{label}</span>
    </span>
  );
}

const PLATFORMS = ["微信", "朋友圈", "小红书", "微博", "复制链接"];

/** 分享弹窗：浅色卡片 + 分享至平台图标行 + 下载卡片。 */
export function ShareDialog({ info, onClose }: { info: ShareCardInfo; onClose: () => void }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const cardSvg = buildShareCardSvg(info);

  const downloadCard = async () => {
    setSaving(true);
    try {
      const png = await svgToPngBlob(cardSvg, 2);
      downloadFile(png, "shike-share-card.png", "image/png");
    } finally { setSaving(false); }
  };

  return (
    <div className="share-dialog-mask" role="dialog" aria-modal="true" aria-label={t("share_dialog_title")} onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-head">
          <h2>{t("share_dialog_title")}</h2>
          <button className="share-dialog-close" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <div className="share-dialog-card">
          <object data={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cardSvg)}`} type="image/svg+xml" aria-label="share card" />
        </div>
        <div className="share-dialog-platforms">
          <span className="muted">{t("share_to")}</span>
          <div className="share-platform-row">
            {PLATFORMS.map((p) => <PlatformIcon key={p} label={p} />)}
          </div>
        </div>
        <div className="share-dialog-actions">
          <button className="share-btn-outline" disabled={saving} onClick={() => void downloadCard()}>
            <DownloadIcon /> {saving ? t("saved") : t("share_download_card")}
          </button>
        </div>
      </div>
    </div>
  );
}
