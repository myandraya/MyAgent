"use client";

/**
 * FlowDemo —— 首页右侧「从输入文字到生成 SVG」的流程演示动画。
 *
 * 设计意图：
 *   用一段自循环动画，把产品的核心链路「说一句 → AI 生成 → 建筑镂空 SVG」
 *   直观地演示给访客，让用户第一眼就明白这个场景能做什么。
 *
 * 动画分四个阶段循环（Apple 官网式：柔缓 ease-out 长尾、错峰淡入、克制不跳变）：
 *   1. 输入框内文字逐字浮现（每个字单独错峰淡入，避免 steps 跳变裁字）
 *   2. 中间处理态（三颗跳动圆点）
 *   3. 建筑剪影从下往上浮现
 *   4. 右下角 SVG 代码标签淡入
 *
 * 全部只动 transform / opacity，尊重 prefers-reduced-motion。
 */
const WORD = "巴黎埃菲尔铁塔";

export function FlowDemo() {
  return (
    <div className="flow-demo" aria-hidden="true">
      {/* 步骤 1：输入框，文字逐字错峰淡入 */}
      <div className="flow-input">
        <span className="flow-input-text">
          {WORD.split("").map((ch, i) => (
            <span
              key={i}
              className="flow-char"
              style={{ animationDelay: `${i * 0.14}s` }}
            >
              {ch}
            </span>
          ))}
        </span>
        <span className="flow-caret" />
      </div>

      {/* 步骤 2：AI 处理态 */}
      <div className="flow-processing">
        <span className="flow-dot" />
        <span className="flow-dot" />
        <span className="flow-dot" />
        <span className="flow-processing-label">AI 正在生成镂空…</span>
      </div>

      {/* 步骤 3：真实生成的建筑镂空雕刻成品（「巴黎埃菲尔铁塔」走完整链路的实际产物，已染成主题蓝） */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="flow-building"
        src="/samples/paris-building.png"
        alt=""
        width={170}
        height={190}
      />

      {/* 步骤 4：SVG 代码标签 */}
      <div className="flow-code">
        <span className="flow-code-dot" />
        <code>&lt;svg …&gt; 建筑镂空</code>
      </div>
    </div>
  );
}
