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
  "hero_desc": { zh: "输入建筑名称，生成可编辑的镂空设计，下载后用于激光制作。写「城市 + 具体建筑名」（如巴黎埃菲尔铁塔）更容易得到准确结果。", en: "Type a building's name to get an editable cutout design you can download and laser-cut. \"City + building\" (e.g. Eiffel Tower, Paris) gives the most accurate results." },
  "hero_quickstart_placeholder": { zh: "输入一栋建筑，如：巴黎埃菲尔铁塔", en: "Type a building, e.g. Eiffel Tower, Paris" },

  // 首页入口卡
  "entry_a_span": { zh: "推荐 · AI 建筑镂空", en: "Featured · AI Architectural Cutout" },
  "entry_a_strong": { zh: "说一句那栋楼", en: "Say a word about that building" },
  "entry_a_small": { zh: "一句话，把一栋建筑雕成镂空", en: "One sentence, one building carved hollow" },

  // 建筑镂空入口
  "prompt_title": { zh: "说一句，把一栋建筑<br/>雕成镂空", en: "Say a word, carve a building<br/>into a cutout" },
  "prompt_desc": { zh: "不用会画画。你只负责说出那栋建筑，剩下的交给 AI——识别地标、生成镂空图案、按三层激光工艺（切穿/划线/雕刻）输出能直接雕刻的 SVG。", en: "No drawing skills needed. Just name that building — AI identifies the landmark, generates a hollow pattern, and outputs a laser-ready SVG in three layers (cut/score/engrave)." },
  "prompt_label": { zh: "一句建筑记忆", en: "A building memory" },
  "prompt_placeholder": { zh: "例如：巴黎埃菲尔铁塔", en: "e.g. Eiffel Tower, Paris" },
  "prompt_hint": { zh: "写「城市 + 建筑名」即可，不需要长提示词", en: "Just write \"city + building name\" — no long prompt needed" },
  "prompt_howto": { zh: "不需要写长提示词，写城市和建筑名称即可", en: "No long prompt needed — just the city and building name" },
  "prompt_limit_note": { zh: "知名地标、公共建筑还原最准；普通住宅或资料稀少的建筑，可能因缺乏可靠素材而无法生成。", en: "Famous landmarks and public buildings reproduce best; ordinary homes or under-documented buildings may fail due to lack of reliable references." },
  "prompt_examples_label": { zh: "试试这些", en: "Try one" },
  "prompt_example_paris": { zh: "巴黎埃菲尔铁塔", en: "Eiffel Tower, Paris" },
  "prompt_example_london": { zh: "伦敦大本钟", en: "Big Ben, London" },
  "prompt_example_sydney": { zh: "悉尼歌剧院", en: "Sydney Opera House" },
  "prompt_btn_working": { zh: "正在雕出你的建筑…", en: "Carving your building…" },
  "prompt_btn": { zh: "生成镂空", en: "Generate cutout" },
  "prompt_empty_tip": { zh: "请先输入建筑名，比如「巴黎埃菲尔铁塔」", en: "Please enter a building first, e.g. \"Eiffel Tower, Paris\"" },
  "prompt_working_status": { zh: "正在把这栋建筑雕成镂空…", en: "Carving this building into a cutout…" },
  "prompt_empty_status": { zh: "写下一栋你忘不掉的建筑，点「生成镂空」，AI 帮你雕出来", en: "Write down a building you can't forget, hit \"Generate\", and AI carves it out" },
  "prompt_source_ai": { zh: "AI 图像生成", en: "AI image gen" },
  "prompt_source_offline": { zh: "离线参数化", en: "Offline parametric" },
  // 地点定位 + 参考照片（忠实实景还原）
  "geo_confirm_label": { zh: "确认具体建筑", en: "Confirm the building" },
  "geo_confirm_hint": { zh: "有多个同名建筑，请选一个", en: "Multiple buildings share this name — pick one" },
  "geo_confirm_type": { zh: "类型", en: "Type" },
  "selected_building": { zh: "正在雕刻", en: "Carving" },
  "geo_no_result": { zh: "没找到这栋建筑，你可以直接上传它的照片", en: "Building not found — you can upload its photo directly" },
  "geo_no_key": { zh: "定位暂不可用，你可以直接上传照片", en: "Geocoding unavailable — upload a photo instead" },
  "photo_search_working": { zh: "正在寻找这栋建筑的真实照片…", en: "Looking for real photos of this building…" },
  "phase_parsing": { zh: "正在确认建筑", en: "Confirming the building" },
  "phase_searching": { zh: "寻找参考照片", en: "Finding reference photos" },
  "phase_generating": { zh: "生成镂空", en: "Generating the cutout" },
  "phase_finalizing": { zh: "整理结构", en: "Arranging the structure" },
  "working_cancel": { zh: "取消", en: "Cancel" },
  "working_timeout_hint": { zh: "生成通常需要 30 秒到 1 分钟，请稍候", en: "This usually takes 30s to 1min — please wait" },
  "error_timeout_title": { zh: "这一步超时了", en: "This step timed out" },
  "error_parse": { zh: "没能确定你要刻的是哪栋楼。", en: "Couldn't figure out which building you meant." },
  "error_parse_action": { zh: "换个说法，写「城市 + 建筑名」（如「伦敦大本钟」）再试。", en: "Try rephrasing as \"city + building name\" (e.g. \"Big Ben, London\")." },
  "error_search": { zh: "暂时没有找到这栋建筑的可靠参考图。", en: "Couldn't find a reliable reference photo for this building." },
  "error_search_action": { zh: "可以换一个建筑，或让 AI 用艺术创作的方式为你画一张。", en: "Try another building, or let AI draw one for you instead." },
  "error_model": { zh: "生成过程中出了点问题。", en: "Something went wrong while generating." },
  "error_model_action": { zh: "请重试一次；若仍失败，换个建筑或稍后再试。", en: "Try again; if it still fails, try another building or come back later." },
  "retry_btn": { zh: "重试", en: "Retry" },
  "artistic_create_btn": { zh: "选择艺术创作", en: "Use artistic creation" },
  "artistic_switch_hint": { zh: "没有可靠参考图时，AI 会凭印象创作，可能和实景有出入。", en: "Without a reliable reference, AI will draw from memory — it may differ from the real building." },
  "change_building_btn": { zh: "换一个建筑", en: "Try another building" },
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
  "undo_btn": { zh: "撤销调整", en: "Undo" },
  "restore_btn": { zh: "恢复原版", en: "Restore original" },
  "compare_prev_btn": { zh: "对比上一版", en: "Compare previous" },
  "back_current_btn": { zh: "回到当前版", en: "Back to current" },
  "size_label": { zh: "成品尺寸", en: "Size" },
  "size_portrait": { zh: "竖幅 120×180 mm", en: "Portrait 120×180 mm" },
  "size_landscape": { zh: "横幅 180×120 mm", en: "Landscape 180×120 mm" },
  "name_label": { zh: "底部英文文字", en: "Bottom text (English)" },
  "name_placeholder": { zh: "如 London", en: "e.g. London" },
  "name_hint": { zh: "仅支持英文字母、空格与连字符，暂不支持中文、数字与年份。", en: "Letters, spaces and hyphens only — no Chinese, numbers or years yet." },

  // 下载 / 制造检查（对齐「下载是最高优先级」整改）
  "download_file_btn": { zh: "下载设计文件（SVG）", en: "Download design file (SVG)" },
  "download_draft_btn": { zh: "保存为草稿", en: "Save as draft" },
  "make_guide_btn": { zh: "查看制作说明", en: "View making guide" },
  "dfm_status_pass": { zh: "制造检查通过", en: "Manufacturing check passed" },
  "dfm_status_fail": { zh: "制造检查未通过", en: "Manufacturing check failed" },
  "dfm_pass_hint": { zh: "可导出制作文件。", en: "Ready to export for making." },
  "dfm_fail_hint": { zh: "当前存在未连接的结构，调整后才能导出制作文件。", en: "There are disconnected structures — fix them before exporting." },
  "dfm_issue_label": { zh: "检查项", en: "Checks" },
  "dfm_fix_hint": { zh: "可执行动作：查看问题位置、调整文字/方向，或先保存草稿。", en: "You can locate the issue, adjust the text/orientation, or save a draft first." },
  "file_format_label": { zh: "文件格式", en: "Format" },
  "file_format_value": { zh: "SVG 矢量（激光软件通用）", en: "SVG vector (laser-ready)" },
  "layer_keep": { zh: "保留（黑色实心）", en: "Keep (solid black)" },
  "layer_cut_through": { zh: "切穿（白色镂空）", en: "Cut through (white holes)" },
  "layer_engrave_line": { zh: "描线雕刻", en: "Engrave lines" },
  "import_hint": { zh: "导入方式：LightBurn、LaserGRBL 等激光软件直接打开 SVG 即可。", en: "Import: open the SVG directly in LightBurn, LaserGRBL, or similar laser software." },
  "dfm_checks_progress": { zh: "检查进度", en: "Check progress" },
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
