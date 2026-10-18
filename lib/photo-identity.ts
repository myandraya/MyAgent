/**
 * 图片文件身份工具：文件名的归一化比较规则（对齐整改方案 S01）。
 *
 * 统一空格、下划线、百分号编码与 File: 前缀，作为「比较键」；不盲目把展示名转小写。
 */

/** 归一化文件名为可比较的键（小写、空格统一）。展示名仍用规范标题，不用此键。 */
export function normalizeFileKey(name: string): string {
  let value = name.trim();
  value = value.replace(/^File:/i, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    /* 非法编码时保留原样 */
  }
  return value.replace(/_/g, " ").replace(/\s+/g, " ").toLowerCase();
}
