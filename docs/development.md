# 開発ガイド

共通の作業ルールは [AGENTS.md](../AGENTS.md)。このガイドはその参照先として、設計・データ・検証の詳細を保持する。コマンドはリポジトリルートで実行する。

**読み方:** 作業の前に、この目次と、触る話題のファイルを読む。全部を読む必要はない。どの話題か迷ったら、[気をつけること](development/pitfalls.md) と [アーキテクチャ](development/architecture.md) から読む。

| 話題                           | ファイル                                       | 何が書いてあるか                                                                                                                  |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| アーキテクチャ                 | [architecture.md](development/architecture.md) | 全体像の図・ファイル構成・tool 一覧・ホストとの境界・UI へのデータ受け渡し・ビルドチェーン                                        |
| 置き場と名前の決まり           | [structure.md](development/structure.md)       | ファイルをどこに置き、どう名付けるか。lint とテストで強制している                                                                 |
| 機能ごとの設計                 | [features.md](development/features.md)         | 家系マッチ・家系タイプ診断・家系カメラ・迷ったら・まわる店・訪問スタンプ・焦点と読み上げ・待つ間の見せ方・UI の選択をモデルに返す |
| Web の静的ページと外向けの案内 | [web-pages.md](development/web-pages.md)       | 静的ページ・検索エンジン向けのページ・規約・ChatGPT への申請・チャットへの接続案内                                                |
| 計測                           | [measurement.md](development/measurement.md)   | 使われているかを数える（Workers Analytics Engine）                                                                                |
| 店舗データ                     | [data.md](development/data.md)                 | 店舗データの作り方・更新・家系判定の段階                                                                                          |
| 気をつけること                 | [pitfalls.md](development/pitfalls.md)         | これまでに踏んだ問題と、その避け方                                                                                                |
| テスト                         | [testing.md](development/testing.md)           | テストの置き場・コマンド・静的解析                                                                                                |
| 動作確認                       | [running.md](development/running.md)           | セットアップとローカルで動かす方法                                                                                                |
| デプロイ                       | [deploy.md](development/deploy.md)             | デプロイ・外部サービス・記録の置き場                                                                                              |
| 開発の進め方                   | [workflow.md](development/workflow.md)         | Claude Code・Codex・issue の回し方、デザイン、コード規約                                                                          |
