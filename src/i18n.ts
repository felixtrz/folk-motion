/** Interface language: Chinese for Chinese-language browsers, English for everyone else.
 *  `?lang=zh` or `?lang=en` overrides the browser. */
export type Lang = 'zh' | 'en';

/** Opened inside a Chinese social app's own browser (Xiaohongshu, WeChat, Weibo, Douyin, QQ),
 *  where the system share sheet and downloads are unavailable but long-press saving works. */
export const IN_APP = /xhsdiscover|xiaohongshu|MicroMessenger|Weibo|aweme|BytedanceWebview|\bQQ\//i.test(navigator.userAgent);

function detect(): Lang {
  const forced = new URLSearchParams(location.search).get('lang');
  if (forced === 'zh' || forced === 'en') return forced;
  if (IN_APP) return 'zh';
  const first = (navigator.languages?.length ? navigator.languages : [navigator.language]).find(Boolean) ?? 'en';
  return first.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const LANG: Lang = detect();

const STRINGS = {
  en: {
    title: 'Folk Motion Studies', brand: 'Folk Motion Studies', guide: 'Field Guide', notes: 'Field notes', plate: 'Pl.',
    subject: 'Subject', subjects: [['Human', 'Homo sapiens, folk-trained'], ['Robot', 'Automaton, general purpose'], ['Croc', 'Homo sapiens in Crocodylus costume']],
    function: 'Observed function', t: 't', pelvis: 'pelvis', hand: 'hand', planted: 'planted · own', feetTitle: 'Filled: foot planted. Outline: foot in the air.',
    left: 'L', right: 'R', contact: 'foot contact', notesButton: 'Notes', close: 'Close', measurements: 'Measurements',
    speed: 'Playback speed', play: 'Play', pause: 'Pause', scrub: 'Scrub through the movement', xr: 'View in headset ↗',
    rows: ['Classification', 'Tradition', 'Genre', 'Observed subject', 'Observed function', 'Duration', 'Foot contacts', 'Lateral excursion', 'Pelvis height', 'Peak hand speed', 'Hand oscillation', 'Head yaw range'],
    method: 'Method. Reconstructed from a single 720p teaching video by monocular pose estimation. Depth is estimated, feet are pinned to observed contacts, and legs in close-up shots are inferred. Source: ',
    imprint: 'Published by', studio: 'EliXR Games — more experiments',
    trial: 'Trial', protocol: 'Protocol', idleZh: '待机', idleBinomial: 'Status expectans', idleCommon: 'At rest', idleClass: 'Baseline posture',
    idleFunction: 'Throw something. Record the response.',
    // Tray slots, each a family that provokes one response; [label, accessible description].
    items: [
      [['Soda', 'Throw a soda can'], ['Beer', 'Throw a beer bottle'], ['Slipper', 'Throw a slipper (a mother’s classic)'], ['Eraser', 'Throw a blackboard eraser (a teacher’s classic)'], ['Duster', 'Throw a feather duster']],
      [['Shuttle', 'Throw a shuttlecock (jianzi)'], ['Football', 'Throw a football'], ['Bun', 'Throw a steamed bun'], ['Melon', 'Throw a watermelon'], ['Mooncake', 'Throw a mooncake']],
      [['Balloon', 'Throw a water balloon'], ['Coffee', 'Throw a coffee'], ['Boba', 'Throw a bubble tea'], ['Egg', 'Throw an egg'], ['Tomato', 'Throw a tomato']],
      [['Flower', 'Award a red paper flower'], ['Medal', 'Award a gold medal'], ['Hongbao', 'Give a red envelope'], ['Pennant', 'Present a silk pennant'], ['Gold star', 'Award a gold star']],
    ],
    log: ['Dodged', 'Returned', 'Soaked', 'Flattered'], sound: 'Sound',
    savePlate: 'Save plate', share: 'Share', download: 'Download', plateHint: 'Long-press the image to save it.', site: 'fm.elixr.games',
    caution: 'Not a substitute for an instructor. Do not attempt the bear near furniture.',
  },
  zh: {
    title: '民间舞动作研究所', brand: '民间舞动作研究所', guide: '田野图鉴', notes: '田野笔记', plate: '图版',
    subject: '对象', subjects: [['人类', '智人，受过民间舞训练'], ['机器人', '通用型自动机'], ['鳄鱼', '身穿鳄鱼服的智人']],
    function: '观察到的功能', t: '时间', pelvis: '骨盆', hand: '手速', planted: '着地', feetTitle: '实心：脚着地。空心：脚离地。',
    left: '左', right: '右', contact: '着地时段', notesButton: '笔记', close: '关闭', measurements: '测量',
    speed: '播放速度', play: '播放', pause: '暂停', scrub: '拖动以浏览动作', xr: '在头显中观看 ↗',
    rows: ['分类', '流派', '类别', '观察对象', '观察到的功能', '时长', '着地次数', '横向位移', '骨盆高度', '手部峰值速度', '手部摆动频率', '头部转动范围'],
    method: '方法：基于一段 720p 教学视频，用单目姿态估计重建。深度为估计值，双脚固定在观察到的着地点上，特写镜头中的腿部为推断。来源：',
    imprint: '出品', studio: 'EliXR Games — 更多实验',
    trial: '试验', protocol: '实验步骤', idleZh: '待机', idleBinomial: 'Status expectans', idleCommon: '静息状态', idleClass: '基线姿态',
    idleFunction: '扔点什么，记录反应。',
    items: [
      [['可乐罐', '扔一个可乐罐'], ['啤酒', '扔一个啤酒瓶'], ['拖鞋', '扔拖鞋（妈妈的绝招）'], ['黑板擦', '扔黑板擦（老师的绝招）'], ['鸡毛掸子', '扔鸡毛掸子']],
      [['毽子', '扔一个毽子'], ['足球', '扔一个足球'], ['包子', '扔一个包子'], ['西瓜', '扔一个西瓜'], ['月饼', '扔一个月饼']],
      [['水气球', '扔一个水气球'], ['咖啡', '泼一杯咖啡'], ['奶茶', '泼一杯珍珠奶茶'], ['鸡蛋', '扔一个鸡蛋'], ['西红柿', '扔一个西红柿']],
      [['小红花', '奖励一朵小红花'], ['金牌', '颁发一枚金牌'], ['红包', '发一个红包'], ['锦旗', '送一面锦旗'], ['金星', '奖励一颗金星']],
    ],
    log: ['闪避', '踢回', '湿透', '得意'], sound: '声音',
    savePlate: '生成图版', share: '分享', download: '下载', plateHint: '长按图片 · 保存到相册', site: 'fm.elixr.games',
    caution: '不能替代老师。请勿在家具附近尝试狗熊。',
  },
} as const;

export const T = STRINGS[LANG];
