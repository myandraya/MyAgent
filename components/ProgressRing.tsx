"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 生成进度环：SVG 圆环 + 中心百分比数字。
 * 后端生成是单次请求、没有真实分段进度，这里用「快速逼近、末段减速」的曲线
 * 模拟推进，给用户一个持续的进度反馈，不阻塞真实结果。
 */
export function ProgressRing({ label }: { label: string }) {
  const [percent, setPercent] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const duration = 30000; // 曲线推进的总时长（ms），期间逼近 95%
    const tick = (now: number) => {
      const elapsed = now - start;
      const raw = elapsed / duration;
      // 前快后慢：1 - (1-t)^2 近似曲线，最终收敛到 95%。
      const eased = 1 - (1 - Math.min(raw, 1)) ** 2;
      setPercent(Math.round(eased * 95));
      if (raw < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, []);

  const R = 42;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - percent / 100);

  return (
    <div className="progress-ring" role="status" aria-label={label}>
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle className="progress-ring-track" cx="56" cy="56" r={R} />
        <circle
          className="progress-ring-fill"
          cx="56"
          cy="56"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="progress-ring-value">{percent}%</span>
    </div>
  );
}
