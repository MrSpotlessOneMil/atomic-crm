import { Sparkles, UserPlus } from "lucide-react";
import { useDataProvider, useNotify } from "ra-core";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseClient } from "../providers/supabase/supabase";
import type { CrmDataProvider } from "../providers/types";

type Fields = {
  company_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  title: string;
  notes: string;
};

const EMPTY: Fields = {
  company_name: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  title: "",
  notes: "",
};

export const AiAddContactPage = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [fields, setFields] = useState<Fields | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [creating, setCreating] = useState(false);

  const set = (k: keyof Fields, v: string) =>
    setFields((f) => ({ ...(f ?? EMPTY), [k]: v }));

  const extract = async () => {
    if (!text.trim()) return;
    setExtracting(true);
    try {
      const result = (await dataProvider.aiExtractContact(text)) as Partial<Fields>;
      setFields({ ...EMPTY, ...result });
    } catch (e) {
      notify((e as Error).message ?? "AI extraction failed", { type: "error" });
    } finally {
      setExtracting(false);
    }
  };

  const create = async () => {
    if (!fields) return;
    if (!fields.first_name && !fields.company_name) {
      notify("Need at least a name or a company", { type: "warning" });
      return;
    }
    setCreating(true);
    try {
      const sb = getSupabaseClient();
      // Find or create the company.
      let companyId: number | undefined;
      if (fields.company_name.trim()) {
        const { data: existing } = await sb
          .from("companies")
          .select("id")
          .ilike("name", fields.company_name.trim())
          .limit(1);
        companyId = existing?.[0]?.id;
        if (!companyId) {
          const { data: c, error } = await sb
            .from("companies")
            .insert({ name: fields.company_name.trim(), vertical: "cleaning" })
            .select("id")
            .single();
          if (error) throw error;
          companyId = c.id;
        }
      }
      const { data: contact, error: cErr } = await sb
        .from("contacts")
        .insert({
          first_name: fields.first_name || fields.company_name,
          last_name: fields.last_name,
          title: fields.title,
          company_id: companyId ?? null,
          status: "warm",
          email_jsonb: fields.email
            ? [{ email: fields.email, type: "Work" }]
            : [],
          phone_jsonb: fields.phone
            ? [{ number: fields.phone, type: "Work" }]
            : [],
        })
        .select("id")
        .single();
      if (cErr) throw cErr;
      if (fields.notes.trim()) {
        await sb.from("contact_notes").insert({
          contact_id: contact.id,
          text: fields.notes.trim(),
          date: new Date().toISOString(),
          status: "warm",
        });
      }
      notify("Contact created", { type: "success" });
      navigate(`/contacts/${contact.id}/show`);
    } catch (e) {
      notify((e as Error).message ?? "Could not create the contact", {
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Add a contact with AI
        </h1>
        <p className="text-muted-foreground text-sm">
          Paste anything — a profile, a website blurb, a message thread, a
          business listing — and AI pulls out the contact for you.
        </p>
      </div>

      <Card>
        <CardContent className="py-5 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the lead's info here…"
            rows={6}
          />
          <Button onClick={extract} disabled={extracting || !text.trim()}>
            <Sparkles className="w-4 h-4 mr-2" />
            {extracting ? "Reading…" : "Extract with AI"}
          </Button>
        </CardContent>
      </Card>

      {fields ? (
        <Card>
          <CardContent className="py-5 space-y-3">
            <p className="text-sm font-medium">Review & edit, then create</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Company" v={fields.company_name} onChange={(v) => set("company_name", v)} />
              <Field label="Title" v={fields.title} onChange={(v) => set("title", v)} />
              <Field label="First name" v={fields.first_name} onChange={(v) => set("first_name", v)} />
              <Field label="Last name" v={fields.last_name} onChange={(v) => set("last_name", v)} />
              <Field label="Email" v={fields.email} onChange={(v) => set("email", v)} />
              <Field label="Phone" v={fields.phone} onChange={(v) => set("phone", v)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea
                value={fields.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
              />
            </div>
            <Button onClick={create} disabled={creating}>
              <UserPlus className="w-4 h-4 mr-2" />
              {creating ? "Creating…" : "Create contact"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

AiAddContactPage.path = "/ai-add-contact";

const Field = ({
  label,
  v,
  onChange,
}: {
  label: string;
  v: string;
  onChange: (v: string) => void;
}) => (
  <div className="space-y-1">
    <label className="text-xs text-muted-foreground">{label}</label>
    <Input value={v} onChange={(e) => onChange(e.target.value)} />
  </div>
);
