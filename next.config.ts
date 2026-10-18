import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // potrace/jimp 是复杂 CJS 包（类 + instanceof 链），Turbopack 内联会破坏运行时行为，
  // 声明为 external 后运行时从 node_modules 加载，部署产物由输出文件追踪自动携带。
  // opentype.js 同时发 UMD+ESM 两套构建，Turbopack 内联会按 .mjs 解析（无 default 导出）
  // 与 Node 直跑的 UMD（仅 default）冲突，同样标 external 走 createRequire 统一加载。
  serverExternalPackages: ["potrace", "jimp", "opentype.js"],
};

export default nextConfig;
