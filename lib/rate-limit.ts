/**
 * 轻量内存限流 —— 防止 AI 接口被脚本刷量盗刷（烧 DeepSeek / 百炼额度）。
 *
 * 设计取舍：
 *  - 无状态 serverless 环境下用进程内 Map，不做跨实例精确配额（引入 Redis 过重，YAGNI）。
 *  - 阈值宽松，只挡「高频脚本刷量」，不误伤正常用户点击。
 *  - 定时清理过期条目，避免内存无限增长。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 清理所有已过期条目（每次检查时顺带做，成本 O(n)，n 很小）。 */
function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * 检查一个 key 是否在窗口内超限。
 * @param key     限流标识（通常用客户端 IP）
 * @param limit   窗口内最大调用次数
 * @param windowMs 时间窗口（毫秒）
 * @returns true 表示放行，false 表示超限拒绝
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** 从请求头提取客户端 IP（优先 EdgeOne / Vercel 透传的真实 IP）。 */
export function clientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "unknown"
  );
}
