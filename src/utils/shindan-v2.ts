/*
 * 家系タイプ診断の 2 版「家系の楽しみ方」（#410）。問い・タイプ・判定・食べ方の言葉・流儀・シェア文。
 * 文言はオーナーとマーケティング担当で決めたもの（#410 の表）。言い換えない。
 * 1 版（shindan.ts）と同じく、結果は「あなたの食べ方」の話だけ。「あなたに合う店」とは言わない。
 * 回答は送らず、残さない。豆知識は一般論で、店によって違うものは「店によって」と書く。
 */
import type { Answer, Question, ShindanType } from "./shindan.ts";

/** 答えは 3 つ。0 が「楽しみ尽くす」、1 が「ほどほど」、2 が「そのまま」。問い 1〜3 でタイプ、4〜6 は流儀。 */
export const QUESTIONS: Question[] = [
  {
    title: "海苔はどうする？",
    options: ["スープに浸してライスを巻く", "途中で食べる", "最初に食べる・よけておく"],
  },
  { title: "トッピングは？", options: ["あれこれ足す", "一つだけ足す", "足さない"] },
  {
    title: "卓上の酢・胡椒・しょうがは？",
    options: ["いろいろ試す", "一つだけ使う", "使わない"],
    note: "卓上の調味料は店によって違います",
  },
  { title: "最初のひと口は？", options: ["スープ", "麺", "具"] },
  { title: "家系はだれと行く？", options: ["ひとり", "だれかと", "その日による"] },
  { title: "ほうれん草は？", options: ["増す", "そのまま", "よけがち"] },
];

export type TypeKey =
  | "sansoryu"
  | "chakudon"
  | "yokubari"
  | "soup"
  | "norimaki"
  | "choitashi"
  | "zenbunose"
  | "takujo";

export const TYPES: Record<TypeKey, ShindanType<TypeKey>> = {
  sansoryu: {
    key: "sansoryu",
    name: "家系三刀流",
    catch: "巻く、足す、変える。食べ終わる頃には、別のラーメンになっている",
    aruaru: [
      "食べ終わった丼を見て、何味だったか一瞬考える",
      "巻く・足す・変えるは、家系の三大アレンジ。三つとも毎回やるのは、27 通りの答えの中で 1 通りだけ",
      "次に来たら、まだ試していない調味料から始める",
    ],
    partner: "chakudon",
    partnerWhy: "同じ一杯から、こんなに違う楽しみ方が出てくる二人",
    combos: 1,
  },
  chakudon: {
    key: "chakudon",
    name: "着丼そのまま主義",
    catch: "店が決めた一杯を、そのまま受け取る。それがいちばんの敬意",
    aruaru: [
      "卓上の調味料の置き場所を、まだ知らない",
      "何も足さずに食べると、その店のスープと麺の組み合わせがいちばんよく分かる",
      "隣の人がしょうがを山盛り入れるのを、静かに見守っている",
    ],
    partner: "sansoryu",
    partnerWhy: "同じ一杯から、こんなに違う楽しみ方が出てくる二人",
    combos: 1,
  },
  yokubari: {
    key: "yokubari",
    name: "欲張りフルスイング",
    catch: "具も味変も遠慮しない。一杯で二度、三度おいしい",
    aruaru: [
      "券売機の前で、トッピングの段だけ滞在時間が長い",
      "具を足すと食感が増え、卓上で味を変えると後半の味が変わる。両方やると、一杯の中で何度も景色が変わる",
      "食べ終わる前から、「次はあれも足そう」と考えている",
    ],
    partner: "soup",
    partnerWhy: "『それ何入れたの？』『何も』で会話が始まる二人",
    combos: 2,
  },
  soup: {
    key: "soup",
    name: "スープと向き合う人",
    catch: "足さない分、スープの違いがいちばん分かる",
    aruaru: [
      "最初のひと口のあと、なぜか一度うなずく",
      "家系のスープは豚骨と醤油の組み合わせ。何も足さないと、店ごとの違いがはっきり分かる",
      "レンゲを置くタイミングが、いつも遅い",
    ],
    partner: "yokubari",
    partnerWhy: "『それ何入れたの？』『何も』で会話が始まる二人",
    combos: 3,
  },
  norimaki: {
    key: "norimaki",
    name: "海苔巻きライス職人",
    catch: "ラーメン屋に来て、主役はライス",
    aruaru: [
      "海苔増しを頼むのは、ラーメンのためではない",
      "スープに浸した海苔でライスを巻くのは、家系の定番の食べ方の一つ。海苔がスープを吸って、ライスに味が移る",
      "海苔を何枚残しておくか、食べ始める前から決めている",
    ],
    partner: "zenbunose",
    partnerWhy: "海苔増しの話で、5 分は盛り上がれる",
    combos: 4,
  },
  choitashi: {
    key: "choitashi",
    name: "ちょい足しの達人",
    catch: "一つ足すだけで、いつもの一杯が変わる。その加減を知っている",
    aruaru: [
      "「一つだけ」と決めて、券売機の前で 30 秒悩む",
      "一つだけ足すと、何が変わったかがよく分かる。次に来たとき、別の一つを試せる",
      "お気に入りのちょい足しが、店ごとに一つずつある",
    ],
    partner: "takujo",
    partnerWhy: "一つを選ぶ人と、全部試す人。おすすめを聞くならこの二人",
    combos: 4,
  },
  zenbunose: {
    key: "zenbunose",
    name: "全部のせの民",
    catch: "丼のふちまで具。麺に会えるのは、少しあと",
    aruaru: [
      "写真を撮るとき、丼を少しだけ回して具の向きを整える",
      "家系の具は、チャーシュー・ほうれん草・海苔が定番。店によっては、うずらや味玉も選べる",
      "最後のチャーシューは、最後まで取っておく",
    ],
    partner: "norimaki",
    partnerWhy: "海苔増しの話で、5 分は盛り上がれる",
    combos: 6,
  },
  takujo: {
    key: "takujo",
    name: "卓上ラボの研究員",
    catch: "半分過ぎたら、実験の時間。成功率は五分五分",
    aruaru: [
      "おろししょうがを入れすぎて、一瞬だけ別の料理になる",
      "卓上の調味料は店によって違う。酢を少し入れると後味が軽くなり、しょうがを入れるとすっきりする",
      "初めての店では、まず卓上に何があるかを見る",
    ],
    partner: "choitashi",
    partnerWhy: "一つを選ぶ人と、全部試す人。おすすめを聞くならこの二人",
    combos: 6,
  },
};

export const isTypeKey = (key: string): key is TypeKey => Object.hasOwn(TYPES, key);

/** 問い 1〜3（海苔・トッピング・卓上）の 27 通りを、上から順に当てはめる（#410 の判定）。 */
export function typeFor(answers: Answer[]): ShindanType<TypeKey> {
  const [nori, topping, table] = answers;
  const three = [nori, topping, table];
  if (three.every((a) => a === 0)) return TYPES.sansoryu;
  if (three.every((a) => a === 2)) return TYPES.chakudon;
  if (nori === 0 && topping !== 0 && table !== 0) return TYPES.norimaki;
  if (topping === 0 && table !== 0) return TYPES.zenbunose;
  if (table === 0 && topping !== 0) return TYPES.takujo;
  if (topping === 0 && table === 0) return TYPES.yokubari;
  if (three.filter((a) => a === 2).length >= 2) return TYPES.soup;
  return TYPES.choitashi;
}

const WORDS = [
  ["海苔巻き", "途中で海苔", "海苔は先に"],
  ["全部のせ", "ちょい足し", "足さない"],
  ["味変", "一つだけ", "そのまま"],
];

/** 食べ方の言葉（1 版の注文の言葉に当たる）。「海苔巻き・全部のせ・味変」。 */
export const spell = (answers: Answer[]) =>
  answers
    .slice(0, 3)
    .map((a, i) => WORDS[i][a])
    .join("・");

const STYLES = [
  ["スープから派", "麺から派", "具から派"],
  ["ひとり派", "だれかと派", "気分派"],
  ["ほうれん草増し派", "ほうれん草そのまま派", "ほうれん草よけがち派"],
];

/** 流儀（最初のひと口・だれと・ほうれん草）。タイプは決めず、結果に添える。 */
export const styleWords = (answers: Answer[]) => answers.slice(3, 6).map((a, i) => STYLES[i][a]);

export function shareText(type: ShindanType<TypeKey>, words: string): string {
  return `私の家系の食べ方は『${words}』、${type.name}でした。あなたは？`;
}
