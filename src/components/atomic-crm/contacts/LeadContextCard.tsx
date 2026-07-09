import { BadgeCheck, Megaphone, PhoneCall } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { getSupabaseClient } from "../providers/supabase/supabase";

type Attribution = Record<string, string>;

type CallLog = {
  id: number;
  direction: string | null;
  duration: number | null;
  summary: string | null;
  transcript: { dialogue?: { content?: string; identifier?: string }[] } | null;
  recording_url: string | null;
  created_at: string;
};

type LeadContext = {
  contactId: number;
  leadSource: string | null;
  attribution: Attribution;
  hasEmail: boolean;
  hasPhone: boolean;
  firstSeen: string | null;
  calls: CallLog[];
};

// Friendly labels for the attribution keys worth showing a rep. Raw ids
// (ad_id, fbclid…) stay in the data but out of the card.
const SHOWN_ATTRIBUTION: { key: string; label: string }[] = [
  { key: "ad_name", label: "Ad" },
  { key: "video_title", label: "Video" },
  { key: "campaign_name", label: "Campaign" },
  { key: "adset_name", label: "Ad set" },
  { key: "offer", label: "Offer" },
  { key: "lead_magnet", label: "Lead magnet" },
  { key: "keyword", label: "Keyword" },
  { key: "utm_campaign", label: "UTM campaign" },
  { key: "utm_source", label: "UTM source" },
  { key: "landing_path", label: "Landing page" },
  { key: "referrer", label: "Referrer" },
];

const fmtDuration = (s: number | null) => {
  if (!s || s <= 0) return "";
  return ` · ${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
};

// Everything a salesman should know before the next touch: WHICH ad/video/
// offer/magnet brought the lead in, what we already know (never re-ask email/
// phone), and what was said on recent phone calls (persisted transcripts).
export const LeadContextCard = ({
  contactId,
  companyId,
}: {
  contactId?: number;
  companyId?: number;
}) => {
  const [ctx, setCtx] = useState<LeadContext | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    let id = contactId ?? null;
    if (!id && companyId) {
      const { data } = await sb
        .from("contacts_summary")
        .select("id")
        .eq("company_id", companyId)
        .order("last_seen", { ascending: false })
        .limit(1);
      id = (data?.[0]?.id as number | undefined) ?? null;
    }
    if (!id) {
      setCtx(null);
      return;
    }

    const { data: rows } = await sb
      .from("contacts_summary")
      .select("id, lead_source, attribution, email_jsonb, phone_jsonb, first_seen")
      .eq("id", id)
      .limit(1);
    const c: any = rows?.[0];
    if (!c) {
      setCtx(null);
      return;
    }

    const { data: calls } = await sb
      .from("call_logs")
      .select("id, direction, duration, summary, transcript, recording_url, created_at")
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(3);

    setCtx({
      contactId: id,
      leadSource: c.lead_source ?? null,
      attribution:
        c.attribution && typeof c.attribution === "object" ? (c.attribution as Attribution) : {},
      hasEmail: Array.isArray(c.email_jsonb) && c.email_jsonb.length > 0,
      hasPhone: Array.isArray(c.phone_jsonb) && c.phone_jsonb.length > 0,
      firstSeen: c.first_seen ?? null,
      calls: (calls ?? []) as CallLog[],
    });
  }, [contactId, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ctx) return null;
  const attrRows = SHOWN_ATTRIBUTION.filter((f) => ctx.attribution[f.key]);
  const platform = ctx.attribution.platform || ctx.leadSource;
  if (!attrRows.length && !platform && !ctx.calls.length) return null;

  return (
    <div className="text-sm space-y-3 rounded-md border p-3 bg-muted/20">
      <div className="flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-primary" />
        <span className="font-semibold">Lead context</span>
      </div>

      {platform ? (
        <div className="text-xs">
          <span className="text-muted-foreground">Came in via </span>
          <span className="font-medium">{platform}</span>
          {ctx.firstSeen ? (
            <span className="text-muted-foreground">
              {" "}
              on {new Date(ctx.firstSeen).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      ) : null}

      {attrRows.length ? (
        <dl className="space-y-1">
          {attrRows.map((f) => (
            <div key={f.key} className="flex gap-2 text-xs">
              <dt className="text-muted-foreground shrink-0 w-24">{f.label}</dt>
              <dd className="font-medium break-words min-w-0">{ctx.attribution[f.key]}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* What we already know — never ask the lead for these again. */}
      <div className="flex gap-2">
        {(
          [
            ["email", ctx.hasEmail],
            ["phone", ctx.hasPhone],
          ] as const
        ).map(([label, known]) => (
          <span
            key={label}
            className={cn(
              "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full",
              known
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {known ? <BadgeCheck className="w-3 h-3" /> : null}
            {known ? `${label} on file` : `no ${label}`}
          </span>
        ))}
      </div>

      {ctx.calls.length ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium">
            <PhoneCall className="w-3 h-3" />
            Recent calls
          </div>
          {ctx.calls.map((call) => (
            <div key={call.id} className="text-xs border-l-2 pl-2 space-y-1">
              <div className="text-muted-foreground">
                {call.direction ?? "call"}
                {fmtDuration(call.duration)} ·{" "}
                {new Date(call.created_at).toLocaleString()}
                {call.recording_url ? (
                  <>
                    {" · "}
                    <a
                      href={call.recording_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      recording
                    </a>
                  </>
                ) : null}
              </div>
              {call.summary ? <div>{call.summary}</div> : null}
              {call.transcript?.dialogue?.length ? (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    transcript ({call.transcript.dialogue.length} lines)
                  </summary>
                  <div className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                    {call.transcript.dialogue.map((line, i) => (
                      <div key={i}>
                        {line.identifier ? (
                          <span className="text-muted-foreground">{line.identifier}: </span>
                        ) : null}
                        {line.content ?? ""}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
