"use client";
import { createContext, useContext } from "react";

export type Lang = "zh" | "en";

// 扁平 key → { zh, en }，ponytail: 不做命名空间嵌套，一个对象搞定
type Dict = Record<string, { zh: string; en: string }>;

export const DICT: Dict = {
  // 通用
  "brand": { zh: "建筑木刻师", en: "Architecture Woodcarver" },
  "back_home": { zh: "← 返回首页", en: "← Home" },
  "saved": { zh: "已保存 ✓", en: "Saved ✓" },
  "lang_label": { zh: "中文", en: "EN" },
  // MakerMuse 子应用对齐 · 顶栏
  "nav_login": { zh: "登录", en: "Log in" },
  // MakerMuse 子应用对齐 · landing hashtag 胶囊
  "tag_laser_engrave": { zh: "#激光雕刻", en: "#Laser Engraving" },
  "tag_laser_cut": { zh: "#激光切割", en: "#Laser Cut" },
  "tag_svg_export": { zh: "#SVG 导出", en: "#SVG Export" },
  "tag_architecture": { zh: "#建筑镂空", en: "#Architectural Hollow" },
  "hero_start": { zh: "开始创作", en: "Start" },
  "hero_cta_gallery": { zh: "逛图库", en: "Browse gallery" },
  "hero_result_label": { zh: "可雕刻的建筑镂空", en: "A carvable architectural cutout" },
  // MakerMuse 对齐 · 场景卡角标
  "badge_hot": { zh: "热门", en: "Hot" },
  "badge_new": { zh: "新品", en: "New" },

  // 首页 hero
  "hero_eyebrow": { zh: "一栋建筑，一段时光", en: "A building, a memory" },
  "hero_title": { zh: "把那栋你忘不掉的楼，<br/>刻下来", en: "Carve the building you<br/>can't forget into wood" },
  "hero_desc": { zh: "一句建筑记忆，AI 帮你把它变成能真正激光雕刻的镂空——说得出，就刻得出。", en: "One memory of a building, AI turns it into a laser-ready hollow cutout — if you can say it, you can carve it." },

  // 首页入口卡
  "entry_a_span": { zh: "推荐 · AI 建筑镂空", en: "Featured · AI Architectural Cutout" },
  "entry_a_strong": { zh: "说一句那栋楼", en: "Say a word about that building" },
  "entry_a_small": { zh: "一句话，把一栋建筑雕成镂空", en: "One sentence, one building carved hollow" },

  // 建筑镂空入口
  "prompt_title": { zh: "说一句，建筑<br/>便有了轮廓", en: "Say a word, the building<br/>takes shape" },
  "prompt_desc": { zh: "不用会画画。你只负责说出那栋建筑，剩下的交给 AI——识别地标、生成镂空图案、按三层激光工艺（切穿/划线/雕刻）输出能直接雕刻的 SVG。", en: "No drawing skills needed. Just name that building — AI identifies the landmark, generates a hollow pattern, and outputs a laser-ready SVG in three layers (cut/score/engrave)." },
  "prompt_label": { zh: "一句建筑记忆", en: "A building memory" },
  "prompt_placeholder": { zh: "例如：我想念巴黎埃菲尔铁塔的轮廓", en: "e.g. I miss the silhouette of the Eiffel Tower" },
  "prompt_hint": { zh: "任何建筑都可以 · 越具体，镂空越像", en: "Any building works · the more specific, the better the cutout" },
  "prompt_btn_working": { zh: "正在雕出你的建筑…", en: "Carving your building…" },
  "prompt_btn": { zh: "生成镂空", en: "Generate cutout" },
  "prompt_empty_tip": { zh: "请先输入一句话，比如「我想念巴黎埃菲尔铁塔的轮廓」", en: "Please enter a line first, e.g. \"I miss the silhouette of the Eiffel Tower\"" },
  "prompt_working_status": { zh: "正在把这栋建筑雕成镂空…", en: "Carving this building into a cutout…" },
  "prompt_empty_status": { zh: "写下一栋你忘不掉的建筑，点「生成镂空」，AI 帮你雕出来", en: "Write down a building you can't forget, hit \"Generate\", and AI carves it out" },
  "prompt_source_ai": { zh: "AI 图像生成", en: "AI image gen" },
  "prompt_source_offline": { zh: "离线参数化", en: "Offline parametric" },
  // 地点定位 + 参考照片（忠实实景还原）
  "geo_confirm_label": { zh: "确认具体建筑", en: "Confirm the building" },
  "geo_confirm_hint": { zh: "有多个同名建筑，请选一个", en: "Multiple buildings share this name — pick one" },
  "geo_no_result": { zh: "没找到这栋建筑，你可以直接上传它的照片", en: "Building not found — you can upload its photo directly" },
  "geo_no_key": { zh: "定位暂不可用，你可以直接上传照片", en: "Geocoding unavailable — upload a photo instead" },
  "photo_search_working": { zh: "正在寻找这栋建筑的真实照片…", en: "Looking for real photos of this building…" },
  "faithful_label": { zh: "忠实还原", en: "Faithful" },
  "local_label": { zh: "直接矢量化", en: "Direct vector" },
  "compare_result": { zh: "镂空", en: "Cutout" },
  "layer_cut": { zh: "切穿", en: "Cut" },
  "layer_score": { zh: "划线", en: "Score" },
  "layer_engrave": { zh: "雕刻", en: "Engrave" },
  "severity_error": { zh: "错误", en: "Error" },
  "severity_warn": { zh: "警告", en: "Warning" },
  "prompt_download": { zh: "下载镂空 SVG", en: "Download cutout SVG" },  "agent_thinking": { zh: "AI 正在想什么", en: "What the AI is thinking" },
  "agent_search": { zh: "检索地标", en: "Searching landmarks" },
  "agent_revise": { zh: "修订简报", en: "Revising brief" },
  "agent_finish": { zh: "定稿", en: "Finalizing" },
  "agent_round": { zh: "第 {n} 轮", en: "Round {n}" },
  "pipeline_identify": { zh: "识别建筑", en: "Identify building" },
  "pipeline_generate": { zh: "生成镂空", en: "Generate cutout" },
  "pipeline_vectorize": { zh: "矢量化", en: "Vectorize" },

  // 照片入口
  "photo_title": { zh: "把一张照片，<br/>刻成镂空的思念", en: "Turn a photo into<br/>a hollow keepsake" },
  "photo_desc": { zh: "那些舍不得删的照片，值得变成看得见、摸得着的东西。上传后 AI 提取主体、去掉杂乱背景，变成能激光雕刻的镂空剪影。原图不存储，安心。", en: "The photos you can't bear to delete deserve to become something you can touch. Upload one, AI isolates the subject and strips the clutter into a laser-ready hollow silhouette. Originals are never stored." },
  "photo_upload_working": { zh: "正在刻出轮廓…", en: "Carving the outline…" },
  "photo_upload_drag": { zh: "松开，让我把它刻出来", en: "Release, let me carve it" },
  "photo_upload_idle": { zh: "选一张舍不得删的照片", en: "Pick a photo you can't delete" },
  "photo_upload_hint": { zh: "PNG / JPEG / WebP · 最大 10MB · 主体清晰、背景干净更出效果", en: "PNG / JPEG / WebP · max 10MB · clearer subject, cleaner background, better result" },
  // 示例照片（没有照片也想试试的用户）
  "photo_samples_label": { zh: "没有照片？试试这些", en: "No photo at hand? Try these" },
  "photo_sample_london": { zh: "伦敦塔桥 · 泰晤士河上的蓝", en: "Tower Bridge · Blue over the Thames" },
  "photo_sample_beijing": { zh: "北京天坛 · 蓝天下的一层檐", en: "Temple of Heaven · Eaves under blue" },
  "photo_sample_edinburgh": { zh: "爱丁堡城堡 · 岩石上的旧时光", en: "Edinburgh Castle · Old times on the rock" },
  "photo_sample_pending_hint": { zh: "照片已就位，点击下方按钮开始雕刻", en: "Photo ready — press the button to carve" },
  "photo_generate_btn": { zh: "生成剪影", en: "Generate silhouette" },
  "photo_sample_replace": { zh: "换一张", en: "Pick another" },
  "photo_compare_original": { zh: "原图", en: "Original" },
  "photo_compare_carved": { zh: "剪影", en: "Carved" },
  // MakerMuse 对齐 · 上传 ✓/✗ 示例引导
  "photo_guide_good_title": { zh: "效果更好", en: "Best results" },
  "photo_guide_good_1": { zh: "主体清晰、居中", en: "Clear, centered subject" },
  "photo_guide_good_2": { zh: "背景干净", en: "Clean background" },
  "photo_guide_good_3": { zh: "单个主体", en: "Single subject" },
  "photo_guide_bad_title": { zh: "尽量避免", en: "Try to avoid" },
  "photo_guide_bad_1": { zh: "多人或杂乱背景", en: "Multiple subjects or cluttered background" },
  "photo_guide_bad_2": { zh: "主体过暗或逆光", en: "Too dark or backlit" },
  "photo_guide_bad_3": { zh: "被裁掉一半", en: "Subject cut off" },
  "photo_working_status": { zh: "正在提取主体、刻出轮廓…", en: "Isolating subject, carving outline…" },
  "photo_empty_status": { zh: "选一张主体清晰的照片，AI 自动把它刻成镂空剪影", en: "Pick a photo with a clear subject, AI carves it into a hollow silhouette" },
  "photo_summary": { zh: "Potrace 镂空矢量化", en: "Potrace hollow vectorization" },
  "photo_source_qwen": { zh: "Qwen 主体提取 · Potrace 矢量化", en: "Qwen subject extraction · Potrace vectorization" },
  "photo_source_local": { zh: "本地主体清理 · Potrace 矢量化", en: "Local subject cleanup · Potrace vectorization" },
  "photo_threshold": { zh: "二值化阈值", en: "threshold" },
  "photo_download": { zh: "下载镂空 SVG", en: "Download hollow SVG" },
  "photo_pipeline_extract": { zh: "提取主体", en: "Extract subject" },
  "photo_pipeline_vectorize": { zh: "矢量化", en: "Vectorize" },
  "photo_pipeline_done": { zh: "完成", en: "Done" },

  // 首页标签栏 + 图库入口
  "home_tabs_label": { zh: "创作方式", en: "Creation modes" },
  "tab_create": { zh: "创作", en: "Create" },
  "tab_gallery": { zh: "图库", en: "Gallery" },
  "gallery_title": { zh: "从图库，挑一栋<br/>想雕的建筑", en: "Pick a building you<br/>want to carve" },
  "gallery_desc": { zh: "没有照片、也不想打字？从各大洲的经典地标建筑里挑一栋——点一下，就能雕成镂空作品。", en: "No photo, no words? Pick a classic landmark building from across the continents — one tap, and it's carved." },
  "gallery_grid_label": { zh: "建筑镂空图库", en: "Architectural cutout gallery" },
  "gallery_back_grid": { zh: "← 回到图库", en: "← Back to gallery" },
  "gallery_source": { zh: "内置矢量剪影", en: "Built-in vector silhouette" },

  // 错误（用户可见）
  "err_scene_unavailable": { zh: "场景服务不可用", en: "Scene service unavailable" },
  "err_invalid_data": { zh: "服务返回无效数据", en: "Service returned invalid data" },
  "err_unparseable": { zh: "无法理解这段建筑记忆。", en: "Couldn't understand that building memory." },
  "err_photo_size": { zh: "请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。", en: "Please choose a PNG/JPEG/WebP image under 10MB." },
  "err_vectorize_failed": { zh: "矢量化失败，请换一张主体清晰、背景简洁的照片。", en: "Vectorization failed, try a photo with clearer subject & simpler background." },
  "err_photo_process": { zh: "图片处理失败。", en: "Image processing failed." },
  "err_no_canvas": { zh: "浏览器不支持 Canvas。", en: "Browser doesn't support Canvas." },
  "err_png_convert": { zh: "图片转 PNG 失败。", en: "Failed to convert image to PNG." },

  // 状态
  "status_waiting": { zh: "等待生成", en: "Waiting" },
  "status_not_generated": { zh: "尚未生成", en: "Not generated yet" },

  // 分享卡片
  "download_cta": { zh: "雕刻这栋建筑", en: "Carve this building" },
  "share_btn": { zh: "分享", en: "Share" },
  "regenerate_btn": { zh: "重新生成", en: "Regenerate" },
  "share_dialog_title": { zh: "分享你的作品", en: "Share your work" },
  "share_card_done": { zh: "创作完成", en: "Created" },
  "share_card_user": { zh: "建筑木刻师", en: "Architecture Woodcarver" },
  "share_card_tagline": { zh: "建筑木刻师 · 把那栋你忘不掉的楼，刻下来", en: "Architecture Woodcarver · Carve the building you can't forget" },
  "share_card_copyright": { zh: "© 2026 建筑木刻师", en: "© 2026 Architecture Woodcarver" },
  "share_to": { zh: "分享至：", en: "Share to:" },
  "share_download_card": { zh: "下载卡片", en: "Download card" },

  // 小红书分享
  "share_xhs": { zh: "分享到小红书", en: "Share to Xiaohongshu" },
  "share_xhs_done": { zh: "已生成分享素材", en: "Share assets ready" },
  "share_xhs_caption_scene": { zh: "{city} · {landmark}｜把那栋你忘不掉的楼，刻成了镂空 🔭 #建筑木刻师 #AI雕刻 #建筑镂空 #记忆", en: "{city} · {landmark} | Carved the building I can't forget into a cutout 🔭 #ArchitectureWoodcarver #AILaser #ArchitecturalHollow #Memory" },
  "share_xhs_caption_photo": { zh: "舍不得删的照片，现在可以刻下来陪我了 ✨ #建筑木刻师 #照片雕刻 #镂空 #回忆", en: "The photo I couldn't delete is now something I can keep forever ✨ #ArchitectureWoodcarver #PhotoLaser #HollowCut #Memory" },
  "share_xhs_caption_gallery": { zh: "{city} · {name}｜从图库挑了一栋建筑，刻成了镂空剪影 🔭 #建筑木刻师 #建筑镂空 #镂空雕刻 #旅行记忆", en: "{city} · {name} | Picked a building from the gallery and carved it into a hollow cutout 🔭 #ArchitectureWoodcarver #ArchitecturalHollow #HollowCut #TravelMemory" },
  "share_madewith": { zh: "Made with MakerMuse", en: "Made with MakerMuse" },
  "share_copy": { zh: "复制文案", en: "Copy caption" },
  "share_copied": { zh: "已复制", en: "Copied" },
};

export const I18nContext = createContext<{ lang: Lang; t: (key: string) => string }>({
  lang: "zh",
  t: (key) => DICT[key]?.zh ?? key,
});

export function useI18n() {
  return useContext(I18nContext);
}

export function makeT(lang: Lang) {
  return (key: string) => DICT[key]?.[lang] ?? key;
}
