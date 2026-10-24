/*
 * zod は最初の検査で `Function("")` が使えるかを試し、速い経路を選ぶ。Web は CSP で eval を許さないので、
 * 試すたびに違反が報告される（#268。動きは遅い経路に戻るだけ）。試すこと自体をやめる。
 *
 * zod は設定を `globalThis.__zod_globalConfig` から読み（無ければ作る）、検査の形は読み込み時に作る。
 * なので zod を読み込む前、入口の**最初**にここを読み込む。zod 自体は import しない（utils/ の決まり）。
 */
// zod が決めた名前なので、こちらで変えられない。
const KEY = "__zod_globalConfig";
const scope = globalThis as unknown as Record<string, { jitless?: boolean } | undefined>;
scope[KEY] = { ...scope[KEY], jitless: true };
