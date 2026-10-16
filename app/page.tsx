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
        <h1>城市木刻师 · 把忘不掉的城刻进木头</h1>
        <p>
          输入一句城市记忆，或上传一张照片，AI 帮你把它变成能真的被激光切割机切出来的镂空剪影 SVG。
          支持城市地标忠实还原、照片主体雕刻，免费在线生成，可下载 SVG 文件直接用于激光切割与雕刻。
        </p>
        <p>
          两种创作方式：说一句那座城——输入「我想念悉尼海港边的歌剧院」这类描述，AI 定位城市、搜索真实照片并忠实转成矢量剪影；
          刻下一张照片——上传一张主体清晰的照片，AI 自动抠出主体，生成镂空雕刻稿。
        </p>
      </section>
      <ShikeApp />
    </>
  );
}
