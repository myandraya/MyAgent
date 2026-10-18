import { ShikeApp } from "../components/ShikeApp.tsx";

/**
 * 首页：交互由客户端组件 ShikeApp 承担。
 * 这里额外输出一段服务端渲染（SSR）的落地文案，供搜索引擎与无障碍阅读器读取，
 * 视觉上隐藏（.sr-only），不影响现有界面。
 */
export default function Home() {
  return (
    <>
      <section className="sr-only" aria-label="产品介绍">
        <h1>建筑木刻师 · 把那栋你忘不掉的楼，刻下来</h1>
        <p>
          输入一句建筑记忆，AI 帮你把它变成能真的被激光切割机切出来的镂空 SVG。
          支持地标建筑忠实还原，免费在线生成，可下载 SVG 文件直接用于激光切割与雕刻。
        </p>
        <p>
          说一句那栋楼——输入「巴黎埃菲尔铁塔」这类建筑名，AI 识别建筑、生成镂空图案，并转成可雕刻的矢量 SVG。
        </p>
      </section>
      <ShikeApp />
    </>
  );
}
