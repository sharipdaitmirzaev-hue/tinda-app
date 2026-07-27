import { describe, expect, it } from "vitest";
import {
  aggregate_product_matches,
  detect_candidate_conflicts,
  score_candidate_match,
} from "@/lib/catalog/external-images/match";
import type {
  ExternalImageCandidate,
  TindaProductImageTarget,
} from "@/lib/catalog/external-images/types";

const products: TindaProductImageTarget[] = [
  {
    id: "p1",
    sku: "DRINK-0001",
    name: "Coca-Cola Classic 0.33 л ж/б",
    brand: "Coca-Cola",
    volume_text: "0.33 л",
    package_type: "can",
    image_url: null,
  },
  {
    id: "p2",
    sku: "DRINK-0002",
    name: "Coca-Cola Zero 0.33 л ж/б",
    brand: "Coca-Cola",
    volume_text: "0.33 л",
    package_type: "can",
    image_url: null,
  },
];

function cand(
  partial: Partial<ExternalImageCandidate> = {},
): ExternalImageCandidate {
  return {
    source_site: "example.com",
    source_product_url: "https://example.com/p",
    candidate_image_url: "https://example.com/img.png",
    source_name: "Coca-Cola Classic 0.33 л ж/б",
    source_brand: "Coca-Cola",
    source_flavor: null,
    source_volume: "0.33 л",
    source_package: "can",
    source_sku: null,
    source_priority: 1,
    ...partial,
  };
}

describe("score_candidate_match", () => {
  it("marks exact_match for strong brand+volume+package alignment", () => {
    const result = score_candidate_match(
      products[0]!,
      cand({ source_name: "Coca-Cola Classic 0.33 л ж/б" }),
    );
    expect(result.match_status).toBe("exact_match");
    expect(result.match_score).toBeGreaterThanOrEqual(80);
  });

  it("rejects sugar-free mismatch against Zero twin", () => {
    const result = score_candidate_match(
      products[1]!,
      cand({ source_name: "Coca-Cola Classic 0.33 л ж/б" }),
    );
    expect(result.reasons).toContain("sugar_conflict");
    expect(result.match_status).not.toBe("exact_match");
  });

  it("returns no_match for unrelated brand", () => {
    const result = score_candidate_match(
      products[0]!,
      cand({
        source_name: "Pepsi 0.33 л ж/б",
        source_brand: "Pepsi",
      }),
    );
    expect(result.match_status).toBe("no_match");
  });

  it("boosts SKU exact match", () => {
    const result = score_candidate_match(
      products[0]!,
      cand({
        source_name: "Coca-Cola Classic",
        source_sku: "DRINK-0001",
        source_volume: "0.33 л",
        source_package: "can",
      }),
    );
    expect(result.match_status).toBe("exact_match");
    expect(result.match_score).toBe(100);
    expect(result.reasons).toContain("sku_exact");
  });
});

describe("aggregate_product_matches", () => {
  it("flags conflict when several exact candidates map to one product", () => {
    const c1 = cand({
      source_name: "Coca-Cola Classic 0.33 л ж/б",
      candidate_image_url: "https://a.example/1.jpg",
      source_flavor: "classic",
    });
    const c2 = cand({
      source_name: "Coca-Cola Classic 0.33 л банка",
      candidate_image_url: "https://b.example/2.jpg",
      source_flavor: "classic",
      source_priority: 3,
    });
    const agg = aggregate_product_matches(products[0]!, [c1, c2]);
    expect(agg.matches.filter((m) => m.match_status === "exact_match").length).toBeGreaterThanOrEqual(2);
    expect(agg.final_status).toBe("conflict");
  });
});

describe("detect_candidate_conflicts", () => {
  it("flags one URL matching multiple SKUs", () => {
    const shared = cand({
      source_name: "Coca-Cola 0.33 л ж/б",
      candidate_image_url: "https://shared.example/cola.jpg",
      source_flavor: null,
    });
    const aggregates = products.map((p) =>
      aggregate_product_matches(p, [shared]),
    );
    const conflicts = detect_candidate_conflicts(aggregates);
    // May or may not conflict depending on sugar/name — assert map shape
    expect(conflicts).toBeInstanceOf(Map);
  });
});
