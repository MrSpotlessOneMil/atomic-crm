// @vitest-environment node
import { describe, it, expect } from "vitest";
import { AREA_CODE_TZ, tzForPhone } from "./areaTz";

describe("tzForPhone parsing", () => {
  it("parses E.164 numbers (+1XXXYYYZZZZ)", () => {
    expect(tzForPhone("+13105550000")).toBe("America/Los_Angeles");
  });

  it("parses bare digits with the leading country code (1XXXYYYZZZZ)", () => {
    expect(tzForPhone("14246771112")).toBe("America/Los_Angeles");
  });

  it("parses bare 10-digit numbers (XXXYYYZZZZ)", () => {
    expect(tzForPhone("4246771112")).toBe("America/Los_Angeles");
  });

  it("parses formatted numbers", () => {
    expect(tzForPhone("(424) 677-1112")).toBe("America/Los_Angeles");
    expect(tzForPhone("+1 (212) 555-0100")).toBe("America/New_York");
    expect(tzForPhone("1-312-555-0100")).toBe("America/Chicago");
    expect(tzForPhone("602.555.0100")).toBe("America/Phoenix");
  });

  it("returns null for unknown / unassigned area codes", () => {
    expect(tzForPhone("+19995550000")).toBeNull();
    expect(tzForPhone("8005550000")).toBeNull(); // toll-free, not geographic
  });

  it("returns null for non-NANP numbers", () => {
    expect(tzForPhone("+442071234567")).toBeNull(); // UK
    expect(tzForPhone("+33123456789")).toBeNull(); // France
  });

  it("returns null for empty, missing, or malformed input", () => {
    expect(tzForPhone(null)).toBeNull();
    expect(tzForPhone(undefined)).toBeNull();
    expect(tzForPhone("")).toBeNull();
    expect(tzForPhone("not a phone")).toBeNull();
    expect(tzForPhone("555-0100")).toBeNull(); // too short
    expect(tzForPhone("+11005550000")).toBeNull(); // area codes never start with 0/1
  });
});

describe("AREA_CODE_TZ spot checks", () => {
  const cases: Array<[string, string]> = [
    // US Eastern
    ["212", "America/New_York"],
    ["646", "America/New_York"],
    ["305", "America/New_York"], // Miami
    ["404", "America/New_York"], // Atlanta
    // US Central
    ["312", "America/Chicago"],
    ["773", "America/Chicago"],
    ["615", "America/Chicago"], // Nashville
    ["850", "America/Chicago"], // FL panhandle (split state -> majority zone)
    // US Mountain
    ["303", "America/Denver"],
    ["915", "America/Denver"], // El Paso, not Central like the rest of Texas
    // Arizona (no DST)
    ["480", "America/Phoenix"],
    ["602", "America/Phoenix"],
    ["928", "America/Phoenix"],
    // US Pacific
    ["213", "America/Los_Angeles"],
    ["310", "America/Los_Angeles"],
    ["424", "America/Los_Angeles"],
    ["206", "America/Los_Angeles"], // Seattle
    // Alaska / Hawaii / territories
    ["907", "America/Anchorage"],
    ["808", "Pacific/Honolulu"],
    ["787", "America/Puerto_Rico"],
    ["671", "Pacific/Guam"],
    // Canada
    ["416", "America/Toronto"],
    ["514", "America/Toronto"], // Montreal (Eastern, canonicalized to Toronto)
    ["204", "America/Winnipeg"],
    ["306", "America/Regina"], // Saskatchewan skips DST, like Arizona
    ["403", "America/Edmonton"],
    ["604", "America/Vancouver"],
    ["902", "America/Halifax"],
    ["709", "America/St_Johns"],
  ];

  it.each(cases)("maps %s to %s", (code, tz) => {
    expect(AREA_CODE_TZ[code]).toBe(tz);
    expect(tzForPhone(`+1${code}5550000`)).toBe(tz);
  });

  it("only maps three-digit NANP codes", () => {
    for (const code of Object.keys(AREA_CODE_TZ)) {
      expect(code).toMatch(/^[2-9]\d\d$/);
    }
  });
});
