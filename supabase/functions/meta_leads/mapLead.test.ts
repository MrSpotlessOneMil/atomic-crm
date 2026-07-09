// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fieldValue, leadToInboundPayload, type GraphLead } from "./mapLead";

const LEAD: GraphLead = {
  id: "987",
  created_time: "2026-07-08T18:00:00+0000",
  ad_id: "ad1",
  ad_name: "Robot Voice Demo v2 - 20% Off",
  adset_id: "as1",
  adset_name: "Owners 25-55",
  campaign_id: "c1",
  campaign_name: "Robinline Campaign 1",
  form_id: "f1",
  platform: "ig",
  field_data: [
    { name: "full_name", values: ["Naty Rodriguez"] },
    { name: "email", values: ["naty@example.com"] },
    { name: "phone_number", values: ["+13105550000"] },
    { name: "company_name", values: ["Naty's Cleaning"] },
  ],
};

describe("fieldValue", () => {
  it("matches exact and fuzzy field names, first value wins", () => {
    expect(fieldValue(LEAD, "email")).toBe("naty@example.com");
    expect(fieldValue(LEAD, "phone_number", "phone")).toBe("+13105550000");
    expect(fieldValue(LEAD, "company")).toBe("Naty's Cleaning");
    expect(fieldValue(LEAD, "missing_field")).toBe("");
  });
});

describe("leadToInboundPayload", () => {
  it("maps a full Instagram lead with ad-level attribution and parsed offer", () => {
    const p = leadToInboundPayload(LEAD, "987")!;
    expect(p.first_name).toBe("Naty");
    expect(p.last_name).toBe("Rodriguez");
    expect(p.email).toBe("naty@example.com");
    expect(p.phone).toBe("+13105550000");
    expect(p.business_name).toBe("Naty's Cleaning");
    expect(p.platform).toBe("instagram");
    expect(p.lead_magnet).toContain("Robot Voice Demo v2");
    expect(p.attribution).toMatchObject({
      leadgen_id: "987",
      platform: "instagram",
      ad_id: "ad1",
      ad_name: "Robot Voice Demo v2 - 20% Off",
      adset_name: "Owners 25-55",
      campaign_name: "Robinline Campaign 1",
      form_id: "f1",
      offer: "20% off",
      first_touch_at: "2026-07-08T18:00:00+0000",
    });
  });

  it("defaults platform to facebook and tolerates missing names", () => {
    const p = leadToInboundPayload(
      { id: "1", platform: "fb", field_data: [{ name: "email", values: ["a@b.co"] }] },
      "1",
    )!;
    expect(p.platform).toBe("facebook");
    expect(p.first_name).toBe("there");
    expect(p.lead_magnet).toBeUndefined();
    expect(p.attribution.offer).toBeUndefined();
  });

  it("returns null when the lead has neither phone nor email", () => {
    expect(
      leadToInboundPayload({ id: "1", field_data: [{ name: "full_name", values: ["X Y"] }] }, "1"),
    ).toBeNull();
  });
});
