/**
 * E2E 設定。
 *
 * MCP サーバーと検証ホスト（MCP Apps SDK の basic-host）を両方立ち上げ、
 * 実ブラウザからホスト経由でアプリを操作する。
 * ホストの取得は `npm run e2e:setup` が行う。
 */
import { defineConfig, devices } from "@playwright/test";

const MCP_PORT = 3131;
/**
 * E2E が使う MCP サーバーの名乗り。
 *
 * 検証ホスト（8080）はプレビューと共用する。サンドボックスの origin が 8081 に
 * 焼き込まれていて basic-host は同時に 1 つしか動かせないため、E2E のたびに
 * 立て直すとユーザーが見ている画面が数分消えるので、1 つのホストに
 * プレビュー用（3031）と E2E 用（3131）を並べて登録し、名前で選び分ける。
 */
const E2E_SERVER_NAME = "Iekei Ramen Finder (E2E)";
/**
 * サインイン済みの画面を確かめるための、もう 1 本。
 *
 * 会員機能（行った店・制覇率）は匿名では出ないので、偽のサインイン済み利用者で
 * 動かす（`IEKEI_DEV_VISITOR`。main.ts にしか無い道で、本番には出ない）。
 * **同じサーバーで兼ねられない**——1 つのプロセスは匿名かサインイン済みの
 * どちらかで、両方の画面を同時には出せない。
 */
const MEMBER_PORT = 3132;
const MEMBER_SERVER_NAME = "Iekei Ramen Finder (E2E signed-in)";
/*
 * basic-host はサンドボックスの origin（http://localhost:8081）を dist に
 * 焼き込んでいるため、同時に 1 つしか動かせない。ホスト側のポートは
 * 変えられるが、変えてもサンドボックスが競合するので既定のままにしてある。
 */
const HOST_PORT = 8080;
/**
 * 地名の解決で Nominatim が返すはずの応答。**E2E から公開サーバーへ問い合わせない**
 * ——CI は 2 つのジョブを別々のマシンで同時に流すので、全体で 1 秒 1 回の規約を
 * 守れない。
 */
const GEOCODE_FIXTURE = "e2e/fixtures/nominatim.json";

export default defineConfig({
  testDir: "./e2e",
  // 撮影系は検証ではないので通常実行から外す。
  // capture 系は npm run capture、shoot は pw-shoot.config.ts から動かす。
  testIgnore: ["**/capture*.spec.ts", "**/shoot.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  /*
   * **テストを 1 件ずつ並べて流す。** 1 本ずつ流すと 109 件で 4 分かかっていた
   * （1 件あたり約 2.2 秒）。遅いのはテストではなく、CPU を 1 つしか使って
   * いないことだった。
   *
   * `fullyParallel` が要る。無いと並列はファイル単位になり、90 件ある
   * app.spec.ts が 1 つの worker に偏って、ほとんど縮まない。
   *
   * **記録を共有するテストは並列にしない。** サインイン済みの記録は 3132 の
   * プロセスにあり、テストの頭で消してから始めるので、同時に流すと互いの記録を
   * 消し合う。その describe だけ `mode: "default"` で順に流す
   * （e2e/visits.spec.ts）。
   *
   * CI は 4 vCPU なので 4。手元は Playwright の既定（コア数の半分）に任せる。
   */
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: process.env.CI ? 2 : 0,
  /*
   * CIでは全試行のHTMLとJSONを残す。retryで成功した初回失敗も追えるようにする。
   */
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${HOST_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  /*
   * 画面の大きさは既定（1280×720）のまま。以前は地図の押下が空振りするのを避けて
   * 縦を 1400 にしていたが、アプリ側で直した（#58）。見切れた状態での押下は
   * e2e/map-offscreen.spec.ts が意図して作って確かめる。
   */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // 先に UI をビルドしてからサーバーを起動する（server.ts は埋め込み済み HTML を読む）
      command: `npm run build:ui && npx tsx main.ts`,
      env: {
        PORT: String(MCP_PORT),
        // 手元ではプレビュー用のサーバーと並ぶので、名前で選び分ける。
        IEKEI_SERVER_NAME: E2E_SERVER_NAME,
        // 接続元からの位置推定は実行環境によって結果が変わるので E2E では止める。
        // 「位置情報が取れないホスト」の挙動を決定的に検証したいため。
        IEKEI_LOCATION_ENDPOINT: "",
        // 地名の解決は公開の Nominatim へ出さず、決まった応答で返す（main.ts）。
        IEKEI_GEOCODE_FIXTURE: GEOCODE_FIXTURE,
      },
      url: `http://localhost:${MCP_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /*
       * サインイン済みの側。UI のビルドは 1 本目がやるので、ここでは起動だけ。
       * 記録はプロセスの中だけに持つので、立て直せば空から始まる。
       */
      command: `npx tsx main.ts`,
      env: {
        PORT: String(MEMBER_PORT),
        IEKEI_SERVER_NAME: MEMBER_SERVER_NAME,
        IEKEI_DEV_VISITOR: "e2e-visitor",
        IEKEI_LOCATION_ENDPOINT: "",
        IEKEI_GEOCODE_FIXTURE: GEOCODE_FIXTURE,
      },
      url: `http://localhost:${MEMBER_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // basic-host の start は bun を要求するので、ビルド済みの serve.ts を tsx で直接起動する。
      command: `SERVERS='["http://localhost:${MCP_PORT}/mcp","http://localhost:${MEMBER_PORT}/mcp"]' npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts`,
      url: `http://localhost:${HOST_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // 境界テストだけが page.route 経由で利用する。8080の登録・再起動は不要。
      command: `npx tsx main.ts`,
      env: {
        PORT: "3133",
        IEKEI_SERVER_NAME: E2E_SERVER_NAME,
        IEKEI_SHOP_FIXTURE: "e2e/fixtures/shops-boundaries.json",
        IEKEI_LOCATION_ENDPOINT: "",
        IEKEI_GEOCODE_FIXTURE: GEOCODE_FIXTURE,
      },
      url: "http://localhost:3133/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
