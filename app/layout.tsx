import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "拾刻 Shike · 第二故乡",
  description: "把第二故乡的真实星空，变成可制造的分层文件。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
