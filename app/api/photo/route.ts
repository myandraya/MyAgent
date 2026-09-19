import { vectorizePhoto, type PhotoVectorizeResult } from "../../../lib/photo-vectorize.ts";
import { extractPhotoSubjectImage, hasImageGenConfig } from "../../../lib/image-gen.ts";
import { allow, clientIp } from "../../../lib/rate-limit.ts";

// Qwen 抠图 + Potrace 矢量化链路实测约 29s，需放宽函数执行时长上限。
export const maxDuration = 120;

type PhotoAgentEvent = { round: number; action: "extract_subject" | "repair_holes" | "finish"; observation: string };

type PhotoResult = {
  cutPath: string;       // 镂空复合 path（外轮廓 + 内部孔洞，evenodd），0..100 坐标系
  widthMm: number;
  heightMm: number;
  threshold: number;     // Otsu 二值化阈值（调试/展示用）
  holeCount: number;
  foregroundRatio: number;
  ok: boolean;
  source: "qwen" | "local";
  agent: { rounds: number; status: "completed" | "degraded"; events: PhotoAgentEvent[] };
};

function photoAudit(result: PhotoVectorizeResult): string[] {
  const issues: string[] = [];
  if (!result.ok) issues.push("未提取到有效闭合轮廓");
  if (result.holeCount < 1) issues.push("内部有效镂空孔洞为 0");
  if (result.foregroundRatio < 0.03) issues.push("主体占比过小");
  if (result.foregroundRatio > 0.85) issues.push("主体或背景黑色占比过大");
  return issues;
}

/**
 * 照片入口 API：浏览器上传图片 → Qwen 主体提取 → 本地清理 → Potrace → 镂空 path。
 *
 * 流程：
 *   1. 接收 multipart/form-data 上传的图片（前端已统一转为 PNG）
 *   2. Qwen 图像编辑提取单一主体、清除背景；失败则使用原图
 *   3. Otsu 自适应阈值二值化并删除与主体断开的黑色孤岛
 *   4. Potrace 追踪主体暗部轮廓 + 内部孔洞
 *   5. 输出 0..100 坐标系的复合 path（fill-rule=evenodd 实现镂空）
 */
export async function POST(request: Request): Promise<Response> {
  // 限流：同一 IP 每 15 秒最多 1 次，防止脚本刷量盗刷 AI 额度。
  if (!allow(clientIp(request), 1, 15_000)) {
    return Response.json({ error: "上传太频繁，请稍后再试。" }, { status: 429 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("photo");
    if (!(file instanceof File)) {
      return Response.json({ error: "请上传图片文件。" }, { status: 400 });
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      return Response.json({ error: "仅支持 PNG、JPEG、WebP 格式。" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: "图片不能超过 10MB。" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    // 支持可选的阈值偏移（前端可调"保留更多暗部/亮部"）
    const biasRaw = formData.get("thresholdBias");
    const thresholdBias = typeof biasRaw === "string" && Number.isFinite(Number(biasRaw))
      ? Math.max(-60, Math.min(60, Number(biasRaw)))
      : 0;

    // Qwen 生成候选，本地矢量审计输出 Observation；没有真实孔洞时最多修复 3 轮。
    const events: PhotoAgentEvent[] = [];
    let currentImage = base64;
    let feedback = "";
    let result: PhotoVectorizeResult | undefined;
    let bestResult: PhotoVectorizeResult | undefined;
    let source: "qwen" | "local" = "local";
    if (hasImageGenConfig()) {
      for (let round = 1; round <= 3; round += 1) {
        const extracted = await extractPhotoSubjectImage({ base64: currentImage, signal: AbortSignal.timeout(45_000), feedback: feedback || undefined });
        if (!extracted) break;
        currentImage = extracted.base64;
        const candidate = await vectorizePhoto(currentImage, { thresholdBias });
        if (!bestResult || candidate.holeCount > bestResult.holeCount) bestResult = candidate;
        const issues = photoAudit(candidate);
        const observation = issues.length
          ? `${issues.join("；")}；黑色主体占比 ${(candidate.foregroundRatio * 100).toFixed(1)}%`
          : `检测到 ${candidate.holeCount} 个有效闭合孔洞，黑色主体占比 ${(candidate.foregroundRatio * 100).toFixed(1)}%`;
        events.push({ round, action: issues.length ? round === 1 ? "extract_subject" : "repair_holes" : "finish", observation });
        if (issues.length === 0) {
          result = candidate;
          source = "qwen";
          break;
        }
        feedback = `${observation}. Keep one recognizable connected black subject and add large fully enclosed white negative-space cutouts; do not add detached marks.`;
      }
    }
    if (!result) {
      const local = await vectorizePhoto(base64, { thresholdBias });
      result = bestResult && bestResult.holeCount > local.holeCount ? bestResult : local;
      source = result === bestResult ? "qwen" : "local";
    }
    if (!result.ok) {
      return Response.json({ error: result.error ?? "矢量化失败。" }, { status: 422 });
    }

    const photoResult: PhotoResult = {
      cutPath: result.cutPath,
      widthMm: 180,
      heightMm: 120,
      threshold: result.threshold,
      holeCount: result.holeCount,
      foregroundRatio: result.foregroundRatio,
      ok: true,
      source,
      agent: { rounds: events.length, status: photoAudit(result).length === 0 ? "completed" : "degraded", events },
    };
    return Response.json(photoResult);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "图片处理失败。";
    return Response.json({ error: message }, { status: 500 });
  }
}
