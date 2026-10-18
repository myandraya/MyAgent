import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "建筑木刻师 · 把那栋你忘不掉的楼，刻下来",
    template: "%s | 建筑木刻师",
  },
  description:
    "建筑木刻师：一句话，AI 帮你把记忆里的那栋建筑，变成可被激光切割机真实切出来的镂空 SVG。支持地标建筑忠实还原，免费在线生成。",
  keywords: [
    "激光切割",
    "激光雕刻",
    "SVG 生成",
    "建筑镂空",
    "地标建筑",
    "建筑剪影",
    "镂空雕刻",
    "MakerMuse",
    "激光切割设计",
    "DIY 激光雕刻",
  ],
  authors: [{ name: "建筑木刻师" }],
  creator: "建筑木刻师",
  robots: { index: true, follow: true, "max-image-preview": "large" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: "建筑木刻师",
    title: "建筑木刻师 · 把那栋你忘不掉的楼，刻下来",
    description:
      "一句话，AI 把它变成能真的被激光切出来的建筑镂空 SVG。",
  },
  twitter: {
    card: "summary_large_image",
    title: "建筑木刻师 · 把那栋你忘不掉的楼，刻下来",
    description: "一句话，AI 把它变成激光可切的建筑镂空 SVG。",
  },
};

/** 结构化数据：描述本产品是什么、能做什么，便于搜索引擎理解。 */
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "建筑木刻师 Architecture Woodcarver",
  applicationCategory: "DesignApplication",
  operatingSystem: "Web",
  description:
    "输入一句建筑记忆，AI 自动生成可被激光切割机真实切出来的建筑镂空 SVG 文件。",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  inLanguage: "zh-CN",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
