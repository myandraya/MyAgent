/**
 * 内置城市剪影图库。
 *
 * 各大洲经典城市景观的手绘矢量剪影（0..100 坐标系，闭合 path），
 * 用于首页「图库」入口：用户点选一张剪影，直接生成可激光雕刻的镂空 SVG，
 * 无需上传照片、无需调用 AI 生图，秒出结果、零失败。
 *
 * 每项剪影遵循激光雕刻语义：
 *   - path 为闭合复合路径（外轮廓 + 内部孔洞，evenodd）
 *   - 外轮廓是「黑色主体」，内部孔洞是「白色镂空」
 *   - 全部子路径闭合，可直接雕刻
 */

export type GalleryItem = {
  id: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  /** 所在城市（中文） */
  city: string;
  /** 所在城市（英文） */
  cityEn: string;
  /** 所属大洲（中文） */
  continent: string;
  /** 所属大洲（英文） */
  continentEn: string;
  /** 闭合复合 path（0..100，外轮廓 + 内部孔洞，evenodd） */
  path: string;
  /** 一句情感文案（中文） */
  tagline: string;
  /** 一句情感文案（英文） */
  taglineEn: string;
};

/**
 * 各剪影的闭合轮廓。为简化手绘并保证可雕刻，每个地标用「外轮廓 + 若干内部孔洞」
 * 表达。path 内的子路径按 evenodd 填充规则：外轮廓顺/逆时针，孔洞反向。
 */

export const GALLERY: GalleryItem[] = [
  {
    id: "eiffel",
    name: "埃菲尔铁塔",
    nameEn: "Eiffel Tower",
    city: "巴黎",
    cityEn: "Paris",
    continent: "欧洲",
    continentEn: "Europe",
    tagline: "铁塔下的黄昏，是巴黎最温柔的时分",
    taglineEn: "Dusk beneath the tower, Paris at its gentlest",
    // 塔身：底部弧形基座 → 收窄 → 中间平台 → 塔尖。内部 3 个镂空拱门。
    path:
      "M50 4 L54 20 L57 20 L57 40 L54 40 L60 58 L60 62 L58 64 L58 70 L68 82 L68 96 L32 96 L32 82 L42 70 L42 64 L40 62 L40 58 L46 40 L43 40 L43 20 L46 20 Z " +
      "M44 22 L46 22 L46 36 L44 36 Z " +
      "M54 22 L56 22 L56 36 L54 36 Z " +
      "M45 62 L48 62 L48 76 L45 76 Z " +
      "M52 62 L55 62 L55 76 L52 76 Z",
  },
  {
    id: "liberty",
    name: "自由女神像",
    nameEn: "Statue of Liberty",
    city: "纽约",
    cityEn: "New York",
    continent: "北美洲",
    continentEn: "North America",
    tagline: "她高举的火炬，照亮过多少追梦的人",
    taglineEn: "Her raised torch has lit the way for so many dreamers",
    // 雕像：底座 → 长袍 → 举火炬的手臂 → 头冠。内部镂空：火炬、脸部留白。
    path:
      "M50 6 L53 6 L53 12 L50 12 Z " +
      "M58 14 L66 10 L66 16 L62 18 L62 22 L58 22 Z " +
      "M47 12 L53 12 L54 18 L46 18 Z " +
      "M42 20 L58 20 L58 26 L42 26 Z " +
      "M40 26 L60 26 L66 44 L64 56 L60 60 L60 96 L40 96 L40 60 L36 56 L34 44 Z " +
      "M44 30 L48 30 L48 38 L44 38 Z " +
      "M52 30 L56 30 L56 38 L52 38 Z",
  },
  {
    id: "sydney-opera",
    name: "悉尼歌剧院",
    nameEn: "Sydney Opera House",
    city: "悉尼",
    cityEn: "Sydney",
    continent: "大洋洲",
    continentEn: "Oceania",
    tagline: "风帆一样的屋顶，停泊在南半球的港湾",
    taglineEn: "Sail-shaped roofs docked in a southern harbor",
    // 风帆屋顶（几片叠起的贝壳）+ 基座，内部镂空窗格。
    path:
      "M12 62 L24 40 L34 62 Z " +
      "M24 40 L34 34 L40 62 L34 62 Z " +
      "M34 62 L48 30 L58 62 Z " +
      "M48 30 L56 40 L62 62 L58 62 Z " +
      "M56 62 L72 46 L82 62 Z " +
      "M18 62 L82 62 L82 96 L18 96 Z " +
      "M28 72 L34 72 L34 84 L28 84 Z " +
      "M40 72 L46 72 L46 84 L40 84 Z " +
      "M52 72 L58 72 L58 84 L52 84 Z " +
      "M64 72 L70 72 L70 84 L64 84 Z",
  },
  {
    id: "big-ben",
    name: "大本钟",
    nameEn: "Big Ben",
    city: "伦敦",
    cityEn: "London",
    continent: "欧洲",
    continentEn: "Europe",
    tagline: "钟声穿过泰晤士河的雾，敲响整点",
    taglineEn: "The bell cuts through Thames fog, striking the hour",
    // 钟楼：方形塔身 → 尖顶，内部镂空钟面 + 窗。
    path:
      "M44 4 L56 4 L56 16 L44 16 Z " +
      "M42 16 L58 16 L58 26 L42 26 Z " +
      "M40 26 L60 26 L60 96 L40 96 Z " +
      "M46 34 L54 34 L54 42 L46 42 Z " +
      "M44 52 L56 52 L56 60 L44 60 Z " +
      "M46 70 L54 70 L54 78 L46 78 Z",
  },
  {
    id: "great-wall",
    name: "长城",
    nameEn: "Great Wall",
    city: "北京",
    cityEn: "Beijing",
    continent: "亚洲",
    continentEn: "Asia",
    tagline: "绵延万里的砖石，守望千年",
    taglineEn: "Brick and stone stretching ten thousand miles, keeping watch for millennia",
    // 城墙 + 敌楼（方形塔），沿山势起伏。
    path:
      "M6 78 L22 70 L30 74 L34 66 L36 66 L36 60 L42 60 L42 66 L44 66 L48 72 L54 68 L60 68 L64 62 L70 62 L70 68 L72 68 L74 72 L82 74 L94 80 L94 88 L6 88 Z " +
      "M38 60 L40 60 L40 64 L38 64 Z " +
      "M66 62 L68 62 L68 66 L66 66 Z " +
      "M24 72 L26 72 L26 76 L24 76 Z " +
      "M78 74 L80 74 L80 78 L78 78 Z",
  },
  {
    id: "pyramid",
    name: "吉萨金字塔",
    nameEn: "Pyramids of Giza",
    city: "开罗",
    cityEn: "Cairo",
    continent: "非洲",
    continentEn: "Africa",
    tagline: "在沙漠里站了四千年的谜",
    taglineEn: "A riddle standing in the desert for four thousand years",
    // 大金字塔 + 小金字塔，内部镂空石缝。
    path:
      "M20 96 L50 12 L80 96 Z " +
      "M86 96 L92 60 L98 96 Z " +
      "M36 60 L40 60 L40 76 L36 76 Z " +
      "M44 46 L48 46 L48 66 L44 66 Z " +
      "M52 60 L56 60 L56 76 L52 76 Z",
  },
  {
    id: "fuji",
    name: "富士山",
    nameEn: "Mount Fuji",
    city: "东京",
    cityEn: "Tokyo",
    continent: "亚洲",
    continentEn: "Asia",
    tagline: "雪顶之下，是关东平原的清晨",
    taglineEn: "Below the snow cap, a Kanto morning",
    // 山体 + 雪顶 + 山脚，内部镂空雪线与云。
    path:
      "M8 96 L34 48 L44 42 L50 30 L56 42 L66 48 L92 96 Z " +
      "M44 30 L50 22 L56 30 L54 34 L50 32 L46 34 Z " +
      "M40 54 L50 48 L60 54 L60 58 L40 58 Z",
  },
  {
    id: "christ-redeemer",
    name: "基督像",
    nameEn: "Christ the Redeemer",
    city: "里约热内卢",
    cityEn: "Rio de Janeiro",
    continent: "南美洲",
    continentEn: "South America",
    tagline: "张开双臂，拥抱整座海湾",
    taglineEn: "Arms wide open, embracing the whole bay",
    // 张臂雕像 + 底座，内部镂空手臂间隙。
    path:
      "M50 8 L53 8 L53 16 L50 16 Z " +
      "M34 18 L42 14 L44 20 L40 24 L34 24 Z " +
      "M58 14 L66 18 L66 24 L60 24 L56 20 Z " +
      "M42 16 L58 16 L58 24 L42 24 Z " +
      "M44 24 L56 24 L60 40 L64 60 L62 72 L62 96 L38 96 L38 72 L36 60 L40 40 Z " +
      "M46 34 L50 34 L50 46 L46 46 Z " +
      "M52 34 L54 34 L54 46 L52 46 Z",
  },
  {
    id: "burj-khalifa",
    name: "哈利法塔",
    nameEn: "Burj Khalifa",
    city: "迪拜",
    cityEn: "Dubai",
    continent: "亚洲",
    continentEn: "Asia",
    tagline: "直插云端的尖塔，是沙漠里的野心",
    taglineEn: "A spire piercing the clouds, ambition in the desert",
    // 螺旋收窄的塔身，内部镂空窗带。
    path:
      "M50 2 L54 2 L54 12 L50 12 Z " +
      "M48 12 L56 12 L57 24 L43 24 Z " +
      "M43 24 L57 24 L60 40 L40 40 Z " +
      "M40 40 L60 40 L64 60 L36 60 Z " +
      "M36 60 L64 60 L68 80 L32 80 Z " +
      "M32 80 L68 80 L72 96 L28 96 Z " +
      "M46 30 L50 30 L50 44 L46 44 Z " +
      "M50 50 L54 50 L54 66 L50 66 Z",
  },
  {
    id: "colosseum",
    name: "罗马斗兽场",
    nameEn: "Colosseum",
    city: "罗马",
    cityEn: "Rome",
    continent: "欧洲",
    continentEn: "Europe",
    tagline: "两千年前的欢呼，还回荡在石墙里",
    taglineEn: "Cheers from two thousand years ago still echo in the stone",
    // 椭圆形斗兽场 + 拱门，内部镂空拱洞。
    path:
      "M14 58 L30 40 L70 40 L86 58 L82 96 L18 96 Z " +
      "M22 52 L32 46 L40 52 L40 70 L32 76 L22 70 Z " +
      "M38 52 L48 46 L56 52 L56 70 L48 76 L38 70 Z " +
      "M60 52 L68 46 L78 52 L78 70 L68 76 L60 70 Z " +
      "M50 78 L50 88 L46 88 L46 78 Z",
  },
  {
    id: "pisa",
    name: "比萨斜塔",
    nameEn: "Leaning Tower of Pisa",
    city: "比萨",
    cityEn: "Pisa",
    continent: "欧洲",
    continentEn: "Europe",
    tagline: "歪了八百年，却站成了一道风景",
    taglineEn: "Leaning for eight centuries, yet standing as a landmark",
    // 圆柱塔身（多层柱廊）+ 斜角，内部镂空柱间。
    path:
      "M40 10 L60 10 L64 96 L36 96 Z " +
      "M42 16 L58 16 L58 26 L42 26 Z " +
      "M42 34 L58 34 L58 44 L42 44 Z " +
      "M42 52 L58 52 L58 62 L42 62 Z " +
      "M42 70 L58 70 L58 80 L42 80 Z",
  },
];
