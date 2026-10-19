/** Interface language: Chinese for Chinese-language browsers, English for everyone else.
 *  `?lang=zh` or `?lang=en` overrides the browser. */
export type Lang = 'zh' | 'en';

function detect(): Lang {
  const forced = new URLSearchParams(location.search).get('lang');
  if (forced === 'zh' || forced === 'en') return forced;
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
    caution: '不能替代老师。请勿在家具附近尝试狗熊。',
  },
} as const;

export const T = STRINGS[LANG];
