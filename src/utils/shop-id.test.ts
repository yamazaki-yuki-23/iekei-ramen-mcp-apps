import { describe, expect, it } from "vitest";
import { shopIdFromSlug, shopSlug } from "./shop-id";

describe("店の ID と URL の形", () => {
  it("行き来できる", () => {
    for (const id of ["node/1774529495", "way/2", "relation/3", "verified/0123456789abcdef0123"])
      expect(shopIdFromSlug(shopSlug(id))).toBe(id);
  });

  it("掲載の店の ID の形でなければ受け取らない", () => {
    for (const slug of ["node-", "node-1a", "manual-xyz", "35.46", "search-iekei-ramen", ""])
      expect(shopIdFromSlug(slug), slug).toBeUndefined();
  });
});
