-- 訪問スタンプ。
--
-- user_id は Google の sub をそのまま入れない。**専用の鍵でハッシュした値**を入れる
-- （記録と Google アカウントを直結させないため）。鍵は回せない——回すと全員の
-- user_id が変わり、記録が迷子になる。
--
-- 押す/外すが 1 行の読み書きで済むよう、主キーを (user_id, shop_id) にしてある。
-- 制覇率はこの人の行を全部取って、Worker 内の店舗データと突き合わせて数える。
CREATE TABLE IF NOT EXISTS visits (
  user_id    TEXT NOT NULL,
  shop_id    TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  PRIMARY KEY (user_id, shop_id)
);
