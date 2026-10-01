import { PartKind } from "@spriteflow/segment";
import { describe, expect, it } from "vitest";
import type { Locale } from "../src/i18n/index";
import { translate } from "../src/i18n/index";

// 2026-10-01 walkthrough P0: DeepSeek returned upper-arm-*/shin-* kinds and the
// kind-badge key was missing from the dictionaries - translate() crashed on
// undefined.replace() and unmounted the whole PartsReview tree. Lock both the
// key coverage (via fallback semantics: a missing key returns the key itself)
// and the no-throw guarantee.
describe("part kind badge i18n (walkthrough P0 regression)", () => {
  const locales: Locale[] = ["zh", "en"];
  const folded = [...new Set(Object.values(PartKind).map((k) => k.split("-")[0]))];

  it("every folded PartKind segment resolves to a real entry in both locales", () => {
    for (const locale of locales) {
      for (const seg of folded) {
        const key = `part.kind.${seg}` as Parameters<typeof translate>[1];
        expect(translate(locale, key), `${locale} missing ${key}`).not.toBe(`part.kind.${seg}`);
      }
    }
  });

  it("translate never throws on a missing key (falls back to the key string)", () => {
    for (const locale of locales) {
      expect(translate(locale, "part.kind.definitely-missing" as never)).toBe(
        "part.kind.definitely-missing",
      );
    }
  });
});
