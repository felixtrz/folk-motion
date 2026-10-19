/** Field-guide copy for each motion. Deadpan on purpose; the measurements are real. */
export type Specimen = {
  id: string;
  plate: string;
  zh: string;
  pinyin: string;
  binomial: string;
  common: string;
  classification: string;
  origin: string;
  originZh: string;
  subject: string;
  function: string;
};

export const SPECIMENS: readonly Specimen[] = [
  {
    id: 'flash-step', plate: 'I', zh: '闪身步', pinyin: 'shǎn shēn bù', binomial: 'Gressus fulgurans',
    common: 'The Flash Step', classification: 'Evasive lateral displacement',
    origin: 'Flower-Drum Lantern, Anhui', originZh: '花鼓灯', subject: 'Zhao Tiechun',
    function: 'Evading something no one else can see.',
  },
  {
    id: 'ball-kick', plate: 'II', zh: '浪子踢球', pinyin: 'làng zǐ tī qiú', binomial: 'Calx prodigi',
    common: 'The Prodigal Kicks the Ball', classification: 'Rear heel-flick with crossing step',
    origin: 'Flower-Drum Lantern, Anhui', originZh: '花鼓灯', subject: 'Zhao Tiechun',
    function: 'Kicking a ball that is not there.',
  },
  {
    id: 'bear-shake', plate: 'III', zh: '狗熊哆嗦毛', pinyin: 'gǒu xióng duō suo máo', binomial: 'Ursus tremulans',
    common: 'The Bear Shakes Its Fur', classification: 'Whole-body lateral oscillation',
    origin: 'Drum Yangge, Shandong', originZh: '鼓子秧歌', subject: 'Ming Wenjun',
    function: 'Drying off without a towel.',
  },
  {
    id: 'head-shake', plate: 'IV', zh: '摇头晃脑', pinyin: 'yáo tóu huàng nǎo', binomial: 'Caput oscillans',
    common: 'Shaking the Head', classification: 'Cranial rotation over a horse stance',
    origin: 'Drum Yangge, Shandong', originZh: '鼓子秧歌', subject: 'Ming Wenjun',
    function: 'Broadcasting complete satisfaction with oneself.',
  },
];
