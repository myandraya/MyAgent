import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // potrace/jimp 是复杂 CJS 包（类 + instanceof 链），Turbopack 内联会破坏运行时行为，
  // 声明为 external 后运行时从 node_modules 加载，部署产物由输出文件追踪自动携带。
  serverExternalPackages: ["potrace", "jimp"],
};

export default nextConfig;
