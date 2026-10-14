/*
 * 家系タイプ診断（#167）の、画面に依らない決まり。問い・タイプ・注文の言葉・流儀。
 * タイプ名と文言はオーナーとマーケティング担当で決めたもの（#167「オーナーと決めた内容」）。言い換えない。
 *
 * **結果は「あなたの好み」の話だけ。** 「あなたに合う店」とは言わない（店の味の傾向は 6 割以上が
 * 不明で、店と結び付けられない）。相方は人どうしの話。豆知識は一般論として書く。
 * 回答は送らず、残さない（この端末の画面の中だけで結果を出す）。
 */

export interface Question {
  title: string;
  /** 答えは 3 つ。0 が「強め」、1 が「ふつう」、2 が「控えめ」。 */
  options: [string, string, string];
}

export const QUESTIONS: Question[] = [
  { title: "麺の硬さは？", options: ["硬め", "普通", "柔らかめ"] },
  { title: "味の濃さは？", options: ["濃いめ", "普通", "薄め"] },
  { title: "油の量は？", options: ["多め", "普通", "少なめ"] },
  { title: "ライスはどうする？", options: ["おかわりまで", "1 杯たのむ", "たのまない"] },
  { title: "卓上のにんにく・豆板醤は？", options: ["たっぷり入れる", "少し入れる", "入れない"] },
  { title: "スープは最後まで飲む？", options: ["飲み干す", "半分くらい", "麺だけ"] },
];

export type Answer = 0 | 1 | 2;

export type TypeKey =
  | "sankan"
  | "futsuu"
  | "fullthrottle"
  | "itten"
  | "katame"
  | "sajikagen"
  | "yasashi"
  | "garyu";

export interface ShindanType {
  key: TypeKey;
  name: string;
  /** 一言。 */
  catch: string;
  /** あるある 3 行（1 行目で笑い、2 行目で「なるほど」、3 行目で「分かる」）。 */
  aruaru: [string, string, string];
  partner: TypeKey;
  partnerWhy: string;
  /** 麺・味・油の 27 通りのうち、このタイプになる組み合わせの数（人数の割合ではない）。 */
  combos: number;
}

export const TYPES: Record<TypeKey, ShindanType> = {
  sankan: {
    key: "sankan",
    name: "カタコイオオメ三冠王",
    catch: "三つとも強め。迷いなき王道",
    aruaru: [
      "「お好みは？」の「お」のあたりで、もう言い終わっている",
      "「多め」で増えるのは鶏の油、鶏油（チーユ）。三冠王は鶏の旨みも全部持っていく",
      "食べ終わってから、水を 3 杯飲む",
    ],
    partner: "futsuu",
    partnerWhy: "隣で『全部ふつう』を頼まれると、なぜか負けた気がする",
    combos: 1,
  },
  futsuu: {
    key: "futsuu",
    name: "ふつうを極めし者",
    catch: "全部ふつう。それは店の基準を味わう選択",
    aruaru: [
      "「ふつう」は、店が決めた基準の味。だから初めての店では必ずこれ",
      "「全部ふつうで」が 0.5 秒で出る",
      "友達の「カタコイオオメ」を、温かい目で見守っている",
    ],
    partner: "sankan",
    partnerWhy: "二人で並ぶと、その店の幅がよく分かる",
    combos: 1,
  },
  fullthrottle: {
    key: "fullthrottle",
    name: "濃厚フルスロットル",
    catch: "濃さも油も全開。麺だけは自分のペースで",
    aruaru: [
      "「濃いめ多め」と言うとき、声の大きさも多めになる",
      "「濃いめ」で増えるのは醤油のタレ、かえし。ライスが進むのはそのせい",
      "空の丼を見て小さくうなずいてから、席を立つ",
    ],
    partner: "yasashi",
    partnerWhy: "『それで足りる？』『それで大丈夫？』と言い合える二人",
    combos: 2,
  },
  itten: {
    key: "itten",
    name: "一点豪華主義",
    catch: "攻めるのは一つだけ。そこに全部を賭ける",
    aruaru: [
      "全部強めにすると、どこが良かったのか分からなくなる。それを知っている",
      "濃いめか多めか毎回少し悩んで、結局いつもと同じ方",
      "「どっち派？」と聞かれると、急に饒舌になる",
    ],
    partner: "katame",
    partnerWhy: "一点を攻める者どうし、話が早い",
    combos: 2,
  },
  katame: {
    key: "katame",
    name: "カタメ一択",
    catch: "麺の硬さだけは、譲れない",
    aruaru: [
      "「硬め」は茹で時間を短くする注文。スープを吸う前の歯ごたえを狙っている",
      "「硬め」を言い忘れた日は、食べ終わるまで少し悔しい",
      "最初のひと口は、必ず麺から",
    ],
    partner: "sajikagen",
    partnerWhy: "攻める人と引く人。注文の話が一番盛り上がる組み合わせ",
    combos: 3,
  },
  sajikagen: {
    key: "sajikagen",
    name: "さじ加減の職人",
    catch: "一つだけ控えめ。そこにこだわりが詰まっている",
    aruaru: [
      "「少なめで」と言ったあと、少しだけ通ぶった顔になる",
      "一つだけ引くと、残りの二つの味がはっきり分かる",
      "次に来たときの注文を、帰り道でもう考えている",
    ],
    partner: "garyu",
    partnerWhy: "調整する人と、組み立てる人。注文の話が終わらない",
    combos: 3,
  },
  yasashi: {
    key: "yasashi",
    name: "明日の自分にやさしい人",
    catch: "家系は好き。でも明日の自分も大事",
    aruaru: [
      "「柔らかめで」を、少し小声で言いがち",
      "薄め・少なめはスープを最後まで飲みやすい。飲み干せたときの達成感は、このタイプが一番大きい",
      "店を出たあと、まだ体が軽いことに少し驚く",
    ],
    partner: "fullthrottle",
    partnerWhy: "『それで足りる？』『それで大丈夫？』と言い合える二人",
    combos: 7,
  },
  garyu: {
    key: "garyu",
    name: "我流の調合師",
    catch: "硬めで薄め。自分だけの正解を知っている",
    aruaru: [
      "店員さんに一瞬「え？」という顔をされたことがある",
      "人に注文を笑われても、まったく気にしない",
      "お好みの組み合わせは 27 通り。その中から、自分の一杯を組み立てている",
    ],
    partner: "futsuu",
    partnerWhy: "基準を知る人と、崩す人。並ぶと家系の奥行きが分かる",
    combos: 8,
  },
};

export const isTypeKey = (key: string): key is TypeKey => Object.hasOwn(TYPES, key);

/** 麺・味・油の 3 問だけでタイプを決める（27 通り → 8 タイプ）。上から順に当てはめる。 */
export function typeFor(answers: Answer[]): ShindanType {
  const [noodle, taste, oil] = answers;
  const three = [noodle, taste, oil];
  const soft = three.filter((a) => a === 2).length;
  if (three.every((a) => a === 0)) return TYPES.sankan;
  if (three.every((a) => a === 1)) return TYPES.futsuu;
  if (taste === 0 && oil === 0) return TYPES.fullthrottle;
  if (noodle === 1 && taste + oil === 1) return TYPES.itten;
  if (noodle === 0 && soft === 0) return TYPES.katame;
  if (soft === 1 && three.every((a) => a !== 0)) return TYPES.sajikagen;
  if (soft >= 2) return TYPES.yasashi;
  return TYPES.garyu;
}

/**
 * 珍しさを言葉で出す（27 通りのうち 1 通りなら「激レア」、2〜3 通りなら「レア」、それより多ければ「定番」）。
 * 星は店の評価に読まれるので使わない。組み合わせの数で、人数の割合ではない。
 */
export const rarity = (type: ShindanType) =>
  type.combos === 1 ? "激レア" : type.combos <= 3 ? "レア" : "定番";

const WORDS = [
  ["カタメ", "ふつう", "ヤワメ"],
  ["コイメ", "ふつう", "ウスメ"],
  ["オオメ", "ふつう", "スクナメ"],
];

/** 注文の言葉（「カタメ・コイメ・オオメ」）。全部普通なら「全部ふつう」。 */
export function orderSpell(answers: Answer[]): string {
  const three = answers.slice(0, 3);
  if (three.every((a) => a === 1)) return "全部ふつう";
  return three.map((a, i) => WORDS[i][a]).join("・");
}

const STYLES = [
  ["ライスおかわり派", "ライス 1 杯派", "ラーメン一本派"],
  ["たっぷり派", "ちょい足し派", "そのまま派"],
  ["スープ完飲派", "スープ半分派", "麺だけ派"],
];

/** 流儀（ライス・卓上・スープ）。タイプは決めず、結果に添える。 */
export const styleWords = (answers: Answer[]) => answers.slice(3, 6).map((a, i) => STYLES[i][a]);

/** 卓上の調味料の使い方（一般論。店ごとの違いはデータに無い）。 */
export function tableTip(answers: Answer[]): string {
  switch (answers[4]) {
    case 0:
      return "最初の数口はそのままで、半分を過ぎたらにんにく・豆板醤を足して味を変えるのが定番の楽しみ方です。";
    case 1:
      return "にんにくや豆板醤は少しずつ。入れすぎるとスープの味が戻らないので、足りなければ足す順で。";
    default:
      return "卓上の調味料を使わなくても大丈夫。気が向いたら、おろしにんにくを少しだけ試す手もあります。";
  }
}

const SITE = "https://iekeiramen.com/shindan/";

/** シェアする URL。入るのはタイプだけ（回答は入れない）。開くと 1 問目から始まり、最後に 2 人のカードが並ぶ。 */
export const shareUrl = (key: TypeKey) => `${SITE}${key}/`;

export function shareText(type: ShindanType, spell: string): string {
  return `私の家系の注文は『${spell}』、${type.name}でした。あなたは？`;
}
