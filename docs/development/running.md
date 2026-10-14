# 動作確認

## セットアップ

```bash
npm install
npm run build        # UI をビルドして HTML をコードに埋め込み、型チェック
```

`data/shops.json` はリポジトリにコミットされるので、通常の開発でデータを
作り直す必要はありません。作り直す手順は「データを更新する」を見てください。

## ローカルで動かす

```bash
npm run dev
```

`http://localhost:3031/mcp` で MCP サーバーが起動します。
UI つきで確認する場合は MCP Apps SDK の basic-host を使う。`npm run e2e:setup` が
リポジトリで固定した版を `e2e-host/` に取り、Bun 無しで動く形にビルドする
（basic-host 本来の `npm run start` は Bun が要る）。

```bash
npm run e2e:setup
SERVERS='["http://localhost:3031/mcp"]' npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts   # → http://localhost:8080
```

Cloudflare のローカルランタイム（workerd）で確認する場合:

```bash
npm run dev:worker
```

## README の画像

README の会話の中の画像（`docs/*.png`・`docs/demo.gif`）は `npm run capture` で撮り直す
（[e2e/capture.spec.ts](../../e2e/capture.spec.ts)・[e2e/capture-demo.spec.ts](../../e2e/capture-demo.spec.ts)）。
Web 版の `docs/web-top.png`・`docs/match.png` は本番を幅 390px・2 倍で撮ったもの（#186）。画面を変えたら撮り直す。

Cloudflare 側の確認は `npm run dev:worker`。バンドルサイズは gzip で 3 MiB が無料枠の上限、
現状約 464 KiB（#170 の dry-run）。
