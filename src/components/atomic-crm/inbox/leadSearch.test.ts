import { describe, it, expect } from "vitest";
import { buildLeads, filterLeads } from "./leadSearch";
import type { Company, Contact } from "../types";

const contact = (over: Partial<Contact>): Contact =>
  ({
    id: 1,
    first_name: "",
    last_name: "",
    phone_jsonb: [],
    email_jsonb: [],
    last_seen: "2026-07-01",
    ...over,
  }) as unknown as Contact;

const company = (over: Partial<Company>): Company =>
  ({ id: 1, name: "", phone_number: "", ...over }) as unknown as Company;

describe("buildLeads", () => {
  it("turns a contact into a searchable lead linking to the contact record", () => {
    const leads = buildLeads(
      [
        contact({
          id: 408,
          first_name: "jack",
          last_name: "g",
          phone_jsonb: [{ number: "+14157204580", type: "Work" }],
          email_jsonb: [{ email: "jack@robinline.com", type: "Work" }],
        }),
      ],
      [],
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: "contact-408",
      name: "jack g",
      phone_number: "+14157204580",
      crmPath: "/contacts/408/show",
      contactId: 408,
    });
  });

  it("dedupes several contacts on ONE number down to the first (most-recent) row", () => {
    const dup = (id: number, name: string) =>
      contact({
        id,
        first_name: name,
        phone_jsonb: [{ number: "+14157204580", type: "Work" }],
      });
    // Caller passes contacts sorted last_seen DESC → first wins.
    const leads = buildLeads(
      [dup(408, "real"), dup(51, "test"), dup(139, "test2")],
      [],
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].contactId).toBe(408);
  });

  it("skips contacts with no phone (the inbox is for texting)", () => {
    const leads = buildLeads(
      [contact({ id: 5, first_name: "emailonly", phone_jsonb: [] })],
      [],
    );
    expect(leads).toHaveLength(0);
  });

  it("includes a company only when no contact already covers its number", () => {
    const leads = buildLeads(
      [
        contact({
          id: 1,
          first_name: "has",
          phone_jsonb: [{ number: "+14157204580", type: "Work" }],
        }),
      ],
      [
        company({
          id: 9,
          name: "Same Number Co",
          phone_number: "(415) 720-4580",
        }),
        company({ id: 10, name: "Other Co", phone_number: "+13105550000" }),
      ],
    );
    // The company sharing the contact's number is skipped; the other is kept.
    expect(leads.map((l) => l.id).sort()).toEqual(["company-10", "contact-1"]);
  });
});

describe("filterLeads", () => {
  const leads = buildLeads(
    [
      contact({
        id: 408,
        first_name: "Jack",
        last_name: "Grenager",
        phone_jsonb: [{ number: "+14157204580", type: "Work" }],
        email_jsonb: [{ email: "jack@robinline.com", type: "Work" }],
      }),
      contact({
        id: 12,
        first_name: "Maria",
        last_name: "Lopez",
        phone_jsonb: [{ number: "+13105551234", type: "Work" }],
      }),
    ],
    [],
  );

  it("matches by name, case-insensitive", () => {
    expect(filterLeads(leads, "jack").map((l) => l.contactId)).toEqual([408]);
    expect(filterLeads(leads, "GRENAGER").map((l) => l.contactId)).toEqual([
      408,
    ]);
  });

  it("matches by phone in ANY format", () => {
    for (const q of [
      "4157204580",
      "+14157204580",
      "(415) 720-4580",
      "415-720-4580",
      "415.720.4580",
    ]) {
      expect(filterLeads(leads, q).map((l) => l.contactId)).toEqual([408]);
    }
  });

  it("matches by a partial phone fragment", () => {
    expect(filterLeads(leads, "7204580").map((l) => l.contactId)).toEqual([
      408,
    ]);
  });

  it("matches by email", () => {
    expect(
      filterLeads(leads, "jack@robinline").map((l) => l.contactId),
    ).toEqual([408]);
  });

  it("returns nothing for an empty query", () => {
    expect(filterLeads(leads, "   ")).toEqual([]);
  });

  it("does not phone-match on a 1-2 digit query (would match every number)", () => {
    // "31" appears in Maria's number but a 2-digit query must not phone-match.
    expect(filterLeads(leads, "31")).toEqual([]);
  });
});
