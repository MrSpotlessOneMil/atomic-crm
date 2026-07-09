// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  attributionSummary,
  mergeAttribution,
  parseOffer,
  sanitizeAttribution,
} from "./attribution";

describe("sanitizeAttribution", () => {
  it("keeps only whitelisted keys and string-coerces values", () => {
    const out = sanitizeAttribution({
      ad_id: 12345,
      ad_name: "  Robot Voice Demo v2  ",
      utm_source: "facebook",
      evil_key: "drop me",
      __proto__: "nope",
    });
    expect(out).toEqual({
      ad_id: "12345",
      ad_name: "Robot Voice Demo v2",
      utm_source: "facebook",
    });
  });

  it("caps value length and drops empties/nullish", () => {
    const out = sanitizeAttribution({
      referrer: "x".repeat(1000),
      keyword: "   ",
      offer: null,
      gclid: undefined,
    });
    expect(out.referrer).toHaveLength(300);
    expect(out.keyword).toBeUndefined();
    expect(out.offer).toBeUndefined();
  });

  it("returns {} for non-objects", () => {
    expect(sanitizeAttribution(null)).toEqual({});
    expect(sanitizeAttribution("utm_source=x")).toEqual({});
    expect(sanitizeAttribution([{ utm_source: "x" }])).toEqual({});
  });
});

describe("mergeAttribution", () => {
  it("keeps existing keys (first touch wins) and fills gaps", () => {
    const merged = mergeAttribution(
      { ad_name: "Original Ad", platform: "facebook" },
      { ad_name: "Newer Ad", offer: "20% off" },
    );
    expect(merged.ad_name).toBe("Original Ad");
    expect(merged.platform).toBe("facebook");
    expect(merged.offer).toBe("20% off");
  });

  it("sanitizes the existing value too", () => {
    const merged = mergeAttribution({ junk: "x", utm_source: "ig" }, { fbclid: "abc" });
    expect(merged).toEqual({ utm_source: "ig", fbclid: "abc" });
  });
});

describe("parseOffer", () => {
  it("finds percent-off offers in any provided name", () => {
    expect(parseOffer("RL - Owners - 20% Off - vid3")).toBe("20% off");
    expect(parseOffer(null, "Spring 15 % OFF adset")).toBe("15% off");
  });

  it("finds N-day free trials", () => {
    expect(parseOffer("14-Day Free Trial Form")).toBe("14-day free trial");
    expect(parseOffer("robin 30 day trial campaign")).toBe("30-day free trial");
  });

  it("finds first-month-free", () => {
    expect(parseOffer("First Month Free - broad")).toBe("first month free");
  });

  it("returns null when nothing matches", () => {
    expect(parseOffer("Robinline Campaign 1", "video 2")).toBeNull();
    expect(parseOffer()).toBeNull();
  });
});

describe("attributionSummary", () => {
  it("builds a compact human line", () => {
    expect(
      attributionSummary({
        platform: "facebook",
        ad_name: "Robot Voice Demo v2",
        campaign_name: "Robinline Campaign 1",
        offer: "20% off",
      }),
    ).toBe('facebook ad "Robot Voice Demo v2" (campaign Robinline Campaign 1, 20% off)');
  });

  it("returns null when nothing is known", () => {
    expect(attributionSummary({})).toBeNull();
    expect(attributionSummary(null)).toBeNull();
  });
});
