/*
 * 家系タイプ診断の版（#410）。1 版（shindan.ts、#167）は消さずに残し、2 版（shindan-v2.ts）を足した。
 * 画面で使う版は CURRENT_EDITION の 1 か所で決める。混ぜるとき（開くたびにどちらか、など）は
 * pickEdition だけを変える。シェアの URL /shindan/<key>/ は版をまたいで key が重ならないので、
 * どの版の結果も同じ形で開ける。
 */
import * as v1 from "./shindan.ts";
import * as v2 from "./shindan-v2.ts";
import type { Answer, Question, ShindanType } from "./shindan.ts";

export type AnyTypeKey = v1.TypeKey | v2.TypeKey;
export type AnyType = ShindanType<AnyTypeKey>;

export interface Edition {
  id: 1 | 2;
  questions: Question[];
  types: Record<string, AnyType>;
  typeFor(answers: Answer[]): AnyType;
  /** 答えから作る言葉（1 版は注文の言葉、2 版は食べ方の言葉）。 */
  spell(answers: Answer[]): string;
  styleWords(answers: Answer[]): string[];
  shareText(type: AnyType, spell: string): string;
  /** 卓上の調味料の豆知識（1 版だけ）。 */
  tableTip?(answers: Answer[]): string;
  /** 版によって変わる画面の言葉。 */
  words: {
    /** 「27 通りの注文のうち」の「注文」に当たる語。 */
    combos: string;
    /** 定番のカードの一言。 */
    common: string;
    /** カードの「あなたの注文」。 */
    spell: string;
    /** 結果の下の但し書き。 */
    note: string;
  };
}

export const EDITIONS = {
  1: {
    id: 1,
    questions: v1.QUESTIONS,
    types: v1.TYPES,
    typeFor: v1.typeFor,
    spell: v1.orderSpell,
    styleWords: v1.styleWords,
    shareText: (type, spell) => v1.shareText(type as ShindanType, spell),
    tableTip: v1.tableTip,
    words: {
      combos: "27 通りの注文のうち",
      common: "いちばん多くの組み合わせが行き着く注文",
      spell: "あなたの注文",
      note: "結果はあなたの好みの話です。店の味とは結び付けていません。注文の言い方や豆知識は一般的なもので、店によって違うことがあります。",
    },
  },
  2: {
    id: 2,
    questions: v2.QUESTIONS,
    types: v2.TYPES,
    typeFor: v2.typeFor,
    spell: v2.spell,
    styleWords: v2.styleWords,
    shareText: (type, spell) => v2.shareText(type as ShindanType<v2.TypeKey>, spell),
    words: {
      combos: "27 通りの答えのうち",
      common: "いちばん多くの組み合わせが行き着く食べ方",
      spell: "あなたの食べ方",
      note: "結果はあなたの食べ方の話です。店の味とは結び付けていません。豆知識は一般的なもので、店によって違うことがあります。",
    },
  },
} satisfies Record<1 | 2, Edition>;

/** 画面で使う版。**切り替えはここ 1 か所**（#410）。 */
export const CURRENT_EDITION: keyof typeof EDITIONS = 2;

/** 診断を始めるときの版。混ぜるときは、ここで版を選ぶ（例: 開くたびにどちらか）。 */
export const pickEdition = (): Edition => EDITIONS[CURRENT_EDITION];

/** どの版のタイプも、key から引ける（シェアの URL・静的ページ・友達のカード）。 */
export const ALL_TYPES: Record<AnyTypeKey, AnyType> = { ...v1.TYPES, ...v2.TYPES };

export const isAnyTypeKey = (key: string): key is AnyTypeKey => Object.hasOwn(ALL_TYPES, key);

/** そのタイプの版（カードの言葉を版に合わせる）。 */
export const editionOf = (key: AnyTypeKey): Edition =>
  v2.isTypeKey(key) ? EDITIONS[2] : EDITIONS[1];
