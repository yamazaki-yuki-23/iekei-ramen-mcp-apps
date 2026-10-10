import type { Shop } from "../lib/types";

/*
 * この端末のブラウザにだけ残すもの（#166）。サインイン無しで、消えても困らない使い方にする。
 * 読めない・書けない環境（プライベートウィンドウなど）でも画面は動く。
 */

const WANTS = "iekei-swipe-wants";
const MET = "iekei-swipe-met";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 残せなくても、この画面の間は使える。
  }
}

/** 距離は選んだときの基準地点に依るので残さない（開き直した場所で測り直す）。 */
const withoutDistance = ({ distanceKm: _distance, ...shop }: Shop): Shop => shop;
export const loadWants = (): Shop[] => read<Shop[]>(WANTS, []).map(withoutDistance);
export const saveWants = (wants: Shop[]) => write(WANTS, wants.map(withoutDistance));

/** 端末の暦の日付（toISOString は UTC なので、日本では朝 9 時に日付が変わってしまう）。 */
export function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** 今日出会った知らない家系の数（日付が変わったら 0 から）。 */
export function loadMet(): number {
  const saved = read<{ day?: string; n?: number }>(MET, {});
  return saved.day === localDay(new Date()) ? (saved.n ?? 0) : 0;
}
/**
 * 今日の数を増やす（減らす）。毎回保存してある日付を読み直すので、開いたまま 0 時を越えても
 * 前の日の数に足さない。
 */
export function addMet(delta: number): number {
  const n = Math.max(0, loadMet() + delta);
  write(MET, { day: localDay(new Date()), n });
  return n;
}
