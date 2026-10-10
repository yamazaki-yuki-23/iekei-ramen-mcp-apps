import { useEffect, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { shareLinks } from "../lib/share";
import {
  QUESTIONS,
  type Answer,
  isTypeKey,
  orderSpell,
  rarity,
  type ShindanType,
  shareText,
  shareUrl,
  styleWords,
  tableTip,
  TYPES,
  typeFor,
} from "../lib/shindan";
import { isMuted, setMuted, sound, unlock } from "../swipe/sound";
import { Card } from "./Card";
import styles from "./shindan.module.css";

const focusHeading = (el: HTMLHeadingElement | null) => el?.focus();

/** シェアされた URL（/shindan/<タイプ>/）から来たら、その友達のタイプ。URL に入るのはタイプだけ。 */
function friendFromUrl(): ShindanType | null {
  const key = /^\/shindan\/([a-z]+)\/?$/.exec(window.location.pathname)?.[1];
  return key && isTypeKey(key) ? TYPES[key] : null;
}

/**
 * 家系タイプ診断（#167）。6 問を 1 タップずつ答え、最後に結果のカードが出てくる。
 * タイプは麺・味・油の 3 問で決まり、ライス・卓上・スープは流儀として添える。
 * 回答は送らず、残さない。シェアされた URL から来ても 1 問目から始まり、最後に 2 人のカードが並ぶ。
 */
export function ShindanApp() {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [friend] = useState(friendFromUrl);
  // 開いた直後だけは焦点を動かさない。答えた・戻った・やり直した後は、出た問いの見出しへ移す。
  const [moved, setMoved] = useState(false);
  const go = (next: Answer[]) => {
    // 音は最初の操作から鳴らせる（ブラウザは操作の前の音を止める）。
    unlock();
    // 答えたら、家系マッチの払う音をさらに小さく。
    if (next.length > answers.length) void sound.swipe("want", 0.25);
    setMoved(true);
    setAnswers(next);
  };
  const step = answers.length;
  return (
    <div className={styles.page}>
      <main className={styles.app}>
        <div className={styles.head}>
          <a className={styles.brand} href="/">
            <BrandMark size={36} />
            家系ラーメンを探す
          </a>
          <MuteButton />
        </div>
        <h1 className={styles.title}>家系タイプ診断</h1>
        {step === 0 && friend && (
          <p className={styles.lead}>
            友達は「{friend.name}」でした。あなたも 6 問に答えると、2 人のカードが並びます。
          </p>
        )}
        {step < QUESTIONS.length ? (
          <Question
            step={step}
            focus={moved}
            onAnswer={(a) => go([...answers, a])}
            onBack={() => go(answers.slice(0, -1))}
          />
        ) : (
          <Result answers={answers} friend={friend} onRetry={() => go([])} />
        )}
      </main>
    </div>
  );
}

function Question({
  step,
  focus,
  onAnswer,
  onBack,
}: {
  step: number;
  focus: boolean;
  onAnswer(a: Answer): void;
  onBack(): void;
}) {
  const q = QUESTIONS[step];
  return (
    <>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="進み具合"
        aria-valuemin={0}
        aria-valuemax={QUESTIONS.length}
        aria-valuenow={step}
      >
        {QUESTIONS.map((item, i) => (
          <span key={item.title} data-done={i < step || undefined} />
        ))}
      </div>
      {/* 問いごとに作り直し、横から滑って入れる。 */}
      <section key={step} className={styles.question} aria-labelledby="q-title">
        <p className={styles.count}>
          {step + 1} / {QUESTIONS.length}
        </p>
        <h2 id="q-title" tabIndex={-1} ref={focus ? focusHeading : undefined}>
          {q.title}
        </h2>
        <div className={styles.options}>
          {q.options.map((label, i) => (
            <button
              key={label}
              type="button"
              className={styles.option}
              onClick={() => onAnswer(i as Answer)}
            >
              {label}
            </button>
          ))}
        </div>
        {step > 0 && (
          <button type="button" className={styles.back} onClick={onBack}>
            ひとつ戻る
          </button>
        )}
      </section>
    </>
  );
}

/** 2 人の関係の一言。相方どうしなら相方の理由、同じタイプならそう言う。 */
function pairLine(me: ShindanType, friend: ShindanType): string | null {
  if (me.key === friend.key) return "同じタイプ。注文を言う前から、話が通じる二人。";
  if (me.partner === friend.key) return `相方どうし。${me.partnerWhy}`;
  if (friend.partner === me.key) return `相方どうし。${friend.partnerWhy}`;
  return null;
}

function Compare({ me, friend }: { me: ShindanType; friend: ShindanType }) {
  const line = pairLine(me, friend);
  return (
    <section className={styles.compare} aria-labelledby="c-title">
      <h2 id="c-title">友達と比べる</h2>
      <div className={styles.pair}>
        <div>
          <p className={styles.who}>友達</p>
          <Card type={friend} small />
        </div>
        <div>
          <p className={styles.who}>あなた</p>
          <Card type={me} small />
        </div>
      </div>
      {line && <p className={styles.pairLine}>{line}</p>}
    </section>
  );
}

function Result({
  answers,
  friend,
  onRetry,
}: {
  answers: Answer[];
  friend: ShindanType | null;
  onRetry(): void;
}) {
  const type = typeFor(answers);
  const spell = orderSpell(answers);
  const url = shareUrl(type.key);
  const text = shareText(type, spell);
  const { threads, x } = shareLinks(text, url);
  const partner = TYPES[type.partner];
  const level = rarity(type);
  // 結果の音。全員: 食券が出るときに家系マッチの発券の「ゴトッ」。激レア: 取り出し口が光るのと同時に
  // 家系マッチのレア札と同じ低い和音。レア: 銀の光が横切るのに合わせて短く柔らかい音。
  // 時刻は shindan.module.css のカードの出る遅れ・銀の光の遅れに合わせる。高い音は出さない（1.4kHz のローパス）。
  useEffect(() => {
    const timers: number[] = [];
    const at = (ms: number, play: () => void) => timers.push(window.setTimeout(play, ms));
    if (level === "激レア") at(0, () => sound.rare());
    at(level === "激レア" ? 650 : level === "レア" ? 250 : 0, () => sound.issue());
    if (level === "レア") at(1000, () => sound.shimmer());
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [level]);
  return (
    <section className={styles.result} aria-labelledby="r-title">
      {/* 券売機の取り出し口から、結果のカードが出てくる。 */}
      <div className={styles.slot} data-rarity={level} aria-hidden="true" />
      <div className={styles.ticketWrap}>
        <Card type={type} spell={spell} headingId="r-title" />
      </div>
      {friend && <Compare me={type} friend={friend} />}
      <div className={styles.block}>
        <h3>このタイプのあるある</h3>
        <ul className={styles.aruaru}>
          {type.aruaru.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
      <div className={styles.block}>
        <h3>相方</h3>
        <p>
          <strong>{partner.name}</strong>
          <br />
          {type.partnerWhy}
        </p>
      </div>
      <div className={styles.block}>
        <h3>流儀</h3>
        <ul className={styles.chips}>
          {styleWords(answers).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
      <div className={styles.block}>
        <h3>卓上の調味料</h3>
        <p>{tableTip(answers)}</p>
      </div>
      <p className={styles.note}>
        結果はあなたの好みの話です。店の味とは結び付けていません。注文の言い方や豆知識は一般的なもので、店によって違うことがあります。
      </p>
      <a className={styles.primary} href="/match/">
        このタイプで近くの家系を探す
      </a>
      <div className={styles.row}>
        <a className={styles.btn} href={x} target="_blank" rel="noopener noreferrer">
          X でシェア
        </a>
        <a className={styles.btn} href={threads} target="_blank" rel="noopener noreferrer">
          Threads でシェア
        </a>
      </div>
      <button type="button" className={styles.back} onClick={onRetry}>
        もう一度診断する
      </button>
    </section>
  );
}

/** 音を消す（家系マッチと同じ設定。この端末に残る）。 */
function MuteButton() {
  const [muted, setMutedState] = useState(isMuted);
  return (
    <button
      type="button"
      className={styles.mute}
      aria-pressed={muted}
      aria-label={muted ? "音を出す" : "音を消す"}
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l6 6M22 9l-6 6" />
        ) : (
          <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
        )}
      </svg>
    </button>
  );
}
