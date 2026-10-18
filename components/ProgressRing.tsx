"use client";

/**
 * 生成进度环：SVG 圆环。
 *
 * 后端生成是单次请求、没有真实分段进度。为避免「固定曲线逼近 95%」给用户
 * 造成「快好了」的假象（实际并未完成），这里不再伪造百分比数字，改为
 * 「不确定进度」的旋转环：只传达「正在处理」，不承诺具体完成度。
 * 只有在后台能提供可靠进度时，才应显示百分比数字。
 */
export function ProgressRing({ label }: { label: string }) {
  return (
    <div className="progress-ring" role="status" aria-label={label}>
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle className="progress-ring-track" cx="56" cy="56" r="42" />
        <circle
          className="progress-ring-fill progress-ring-indeterminate"
          cx="56"
          cy="56"
          r="42"
          strokeDasharray="66 198"
        />
      </svg>
    </div>
  );
}
