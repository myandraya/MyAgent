import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "城市木刻师 · 把忘不掉的城刻进木头",
    template: "%s | 城市木刻师",
  },
  description:
    "城市木刻师：一句话或一张照片，AI 帮你把记忆里的那座城，变成可被激光切割机真实切出来的镂空剪影 SVG。支持城市地标忠实还原与照片主体雕刻，免费在线生成。",
  keywords: [
    "激光切割",
    "激光雕刻",
    "SVG 生成",
    "城市剪影",
    "地标剪影",
    "照片转雕刻稿",
    "镂空剪影",
    "MakerMuse",
    "激光切割设计",
    "DIY 激光雕刻",
  ],
  authors: [{ name: "城市木刻师" }],
  creator: "城市木刻师",
  robots: { index: true, follow: true, "max-image-preview": "large" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: "城市木刻师",
    title: "城市木刻师 · 把忘不掉的城刻进木头",
    description:
      "一句话或一张照片，AI 把它变成能真的被激光切出来的矢量镂空剪影 SVG。",
  },
  twitter: {
    card: "summary_large_image",
    title: "城市木刻师 · 把忘不掉的城刻进木头",
    description: "一句话或一张照片，AI 把它变成激光可切的镂空剪影 SVG。",
  },
};

/** 结构化数据：描述本产品是什么、能做什么，便于搜索引擎理解。 */
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "城市木刻师 City Woodcarver",
  applicationCategory: "DesignApplication",
  operatingSystem: "Web",
  description:
    "输入一句城市记忆或上传一张照片，AI 自动生成可被激光切割机真实切出来的镂空剪影 SVG 文件。",
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
