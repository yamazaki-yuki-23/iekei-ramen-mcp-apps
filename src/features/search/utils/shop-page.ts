import { shopSlug } from "../../../utils/shop-id";

/**
 * 店のページ（`/shop/<slug>/`、#400）。掲載の店には全部ある（`scripts/build/seo-pages.ts`）。
 *
 * Web は同じサイトの中なので、そのままの道。会話の中は外のページなので本番の URL にする
 * （地図の絵の置き場と同じ分け方。`map-layers.ts`）。
 */
export const shopPageUrl = (id: string): string =>
  `${import.meta.env.MODE === "web" ? "" : "https://iekeiramen.com"}/shop/${shopSlug(id)}/`;
