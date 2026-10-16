"use client";

import { useEffect } from "react";

/** 剪影放大预览浮层：点击剪影打开，点叉号或浮层空白处关闭。 */
export function Lightbox({ svg, onClose }: { svg: string; onClose: () => void }) {
  // Esc 键关闭
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="zoom-overlay" role="dialog" aria-modal="true" aria-label="剪影放大预览" onClick={onClose}>
      <div className="zoom-stage" onClick={(event) => event.stopPropagation()}>
        <button className="zoom-close" aria-label="关闭" onClick={onClose}>×</button>
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="剪影放大预览" />
      </div>
    </div>
  );
}
