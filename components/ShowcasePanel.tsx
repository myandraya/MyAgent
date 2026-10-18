"use client";

import { useState } from "react";

/**
 * ShowcasePanel —— 首页右侧「作品预览 + 案例切换」面板。
 *
 * 设计意图（对齐首页改进建议）：
 *   1. 第一屏始终保留一张完整作品预览（静态成品，不用等动画循环才能理解结果）；
 *   2. 三张不同结构的真实生成案例（铁塔/歌剧院/天坛），帮助用户判断生成稳定性；
 *   3. 明确标注「效果示意」——当前无实物样件照片，不虚构实物。
 */

type Case = { key: string; name: string; city: string; img: string };

const CASES: Case[] = [
  { key: "paris", name: "埃菲尔铁塔", city: "Paris", img: "/samples/paris-building.png" },
  { key: "sydney", name: "悉尼歌剧院", city: "Sydney", img: "/samples/sydney-building.png" },
  { key: "tiantan", name: "天坛祈年殿", city: "Beijing", img: "/samples/tiantan-building.png" },
];

export function ShowcasePanel() {
  const [active, setActive] = useState(0);
  const current = CASES[active];

  return (
    <div className="showcase" aria-label="建筑镂空作品预览">
      {/* 主预览：完整成品，第一眼即所见 */}
      <figure className="showcase-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.key}
          className="showcase-art"
          src={current.img}
          alt={`${current.name}镂空雕刻效果示意`}
          width={300}
          height={450}
        />
        <figcaption className="showcase-caption">
          <span className="showcase-name">{current.name}</span>
          <span className="showcase-city">{current.city}</span>
          <span className="showcase-note">效果示意 · 下载后用于激光雕刻</span>
        </figcaption>
      </figure>

      {/* 案例切换：不同结构的真实生成案例 */}
      <div className="showcase-cases" role="tablist" aria-label="真实生成案例">
        {CASES.map((c, i) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={i === active}
            className={`showcase-case ${i === active ? "on" : ""}`}
            onClick={() => setActive(i)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.img} alt="" width={54} height={81} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
