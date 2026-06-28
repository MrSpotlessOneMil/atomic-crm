import { Bell, Phone, PhoneCall } from "lucide-react";
import {
  useGetIdentity,
  useNotify,
  useRecordContext,
  useRefresh,
} from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "../providers/supabase/supabase";
import type { Company } from "../types";
import { SendTextButton } from "../contacts/SendTextButton";
import { SendEmailButton } from "../contacts/SendEmailButton";
import { buildOutcomeCopy } from "../contacts/callOutcomeCopy";

// Quick-pick call outcomes → each sets the lead's status appropriately.
const OUTCOMES: { label: string; status: "cold" | "warm" | "hot" }[] = [
  { label: "No answer", status: "warm" },
  { label: "Left voicemail", status: "warm" },
  { label: "Gatekeeper", status: "warm" },
  { label: "Call back later", status: "warm" },
  { label: "Asked to email", status: "warm" },
  { label: "Interested", status: "hot" },
  { label: "Booked!", status: "hot" },
  { label: "Not interested", status: "cold" },
  { label: "Bad / wrong number", status: "cold" },
];

// Optional reminder choices. Defaults to "No reminder" — reps drive follow-up
// from the live conversation, not a nag list.
const FOLLOWUP_CHOICES: { label: string; days: number | null }[] = [
  { label: "No reminder", days: null },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In 1 week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

export const LogCallButton = ({ className }: { className?: string }) => {
  const record = useRecordContext<Company>();
  const notify = useNotify();
  const refresh = useRefresh();
  const { identity } = useGetIdentity();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [followupDays, setFollowupDays] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Auto reach-out after logging: pop the text composer, then email, seeded by
  // the call outcome. reachOutcome is captured so it survives the form reset.
  const [reachText, setReachText] = useState(false);
  const [reachEmail, setReachEmail] = useState(false);
  const [reachOutcome, setReachOutcome] = useState<string>("");
  // A real email for the lead, if any — the email step only fires when set.
  const [reachEmailTo, setReachEmailTo] = useState<string | null>(null);

  if (!record) return null;

  const reset = () => {
    setOutcome("");
    setNote("");
    setFollowupDays(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const sb = getSupabaseClient();
      const status = OUTCOMES.find((o) => o.label === outcome)?.status ?? "warm";

      const { data: existing } = await sb
        .from("contacts")
        .select("id, email_jsonb")
        .eq("company_id", record.id)
        .limit(1);
      let contactId = existing?.[0]?.id as number | undefined;
      // A real email on file (not a guessed one) — gates the auto email step.
      const realEmail =
        (existing?.[0]?.email_jsonb as { email?: string }[] | undefined)?.[0]
          ?.email ?? null;
      if (!contactId) {
        const { data: created, error: cErr } = await sb
          .from("contacts")
          .insert({
            first_name: record.name,
            last_name: "",
            company_id: record.id,
            status,
            phone_jsonb: record.phone_number
              ? [{ number: record.phone_number, type: "Work" }]
              : [],
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        contactId = created.id;
      } else {
        await sb.from("contacts").update({ status }).eq("id", contactId);
      }

      // Attribute the call to the rep who made it: stamp the note's author
      // (sales_id drives the "<name> added a note" line + avatar in the activity
      // log) and name them in the text so it reads "Dominic called".
      const callerName = identity?.fullName ?? "A rep";
      const outcomeLabel = outcome ? ` — ${outcome}` : "";
      const noteSuffix = note.trim() ? `: ${note.trim()}` : "";
      const text = `📞 ${callerName} called${outcomeLabel}${noteSuffix}`;
      const { error: nErr } = await sb.from("contact_notes").insert({
        contact_id: contactId,
        text,
        date: new Date().toISOString(),
        status,
        sales_id: identity?.id,
      });
      if (nErr) throw nErr;

      // Claim the lead for whoever worked it (if unclaimed) so the card shows
      // who's on it.
      if (!record.sales_id && identity?.id) {
        await sb
          .from("companies")
          .update({ sales_id: identity.id })
          .eq("id", record.id);
      }

      // Enroll the lead into a rolling SMS follow-up drip keyed to the outcome.
      // Fire-and-forget: the edge function decides whether this outcome
      // qualifies, de-dupes, and respects opt-outs / pause. Never blocks the
      // call from being logged.
      if (outcome && record.phone_number) {
        sb.functions
          .invoke("enroll_call_drip", {
            body: {
              contact_id: contactId,
              outcome,
              to: record.phone_number,
              rep_name: callerName,
            },
          })
          .catch((e) => console.error("enroll_call_drip failed", e));
      }

      // Optional follow-up reminder so the lead resurfaces on the dashboard.
      if (followupDays != null) {
        const due = new Date();
        due.setDate(due.getDate() + followupDays);
        due.setHours(9, 0, 0, 0);
        await sb.from("tasks").insert({
          contact_id: contactId,
          type: "Follow-up",
          text: `Follow up — ${outcome || "called"}${
            note.trim() ? `: ${note.trim()}` : ""
          }`,
          due_date: due.toISOString(),
          sales_id: identity?.id,
        });
      }

      notify(`Call logged${followupDays != null ? " · reminder set" : ""}`, {
        type: "success",
      });

      reset();
      setOpen(false);
      refresh();

      // Nudge the rep to follow up. Always pop the text composer (pre-filled
      // from the outcome); the email step is chained after the text sends, but
      // only when the lead has a real email on file (no guessed addresses).
      const copy = buildOutcomeCopy(outcome, "", callerName);
      if (copy?.reachOut) {
        setReachOutcome(outcome);
        setReachEmailTo(realEmail);
        if (record.phone_number) setReachText(true);
        else if (realEmail) setReachEmail(true);
      }
    } catch (e) {
      notify((e as Error).message ?? "Could not log the call", {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <PhoneCall className="w-4 h-4 mr-2" />
          Log Call
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a call — {record.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">What happened?</p>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setOutcome(o.label)}
                  className={cn(
                    "text-sm rounded-full border px-3 py-1.5 transition-colors",
                    outcome === o.label
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Primary action: reach out right now. AI drafts from a quick blurb
              and sends through the rep's own Quo number / Gmail. */}
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
            <p className="text-sm font-medium">Reach out now</p>
            <p className="text-xs text-muted-foreground">
              Drop a quick blurb, let AI write it, and send a text or email on
              the spot.
            </p>
            <div className="flex flex-wrap gap-2">
              {record.phone_number ? (
                <SendTextButton
                  to={record.phone_number}
                  name={record.name}
                  companyId={record.id}
                  outcome={outcome}
                />
              ) : null}
              <SendEmailButton
                name={record.name}
                website={record.website}
                companyId={record.id}
                outcome={outcome}
                phone={record.phone_number}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Notes (optional)</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything else — name, details, what they said…"
              rows={2}
            />
          </div>

          {/* Reminder is now optional + collapsed by default. */}
          <details className="rounded-md border bg-muted/20 p-3">
            <summary className="text-sm font-medium cursor-pointer flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Set a reminder (optional)
            </summary>
            <div className="flex flex-wrap gap-2 mt-3">
              {FOLLOWUP_CHOICES.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setFollowupDays(f.days)}
                  className={cn(
                    "text-sm rounded-full border px-3 py-1.5 transition-colors",
                    followupDays === f.days
                      ? "bg-amber-500 text-white border-amber-500"
                      : "hover:bg-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || (!outcome && !note.trim())}>
            <Phone className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Log Call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* Auto reach-out after a call is logged: text first, then email — each
          pre-filled from the chosen outcome, fully editable / AI-refinable. */}
      {record.phone_number ? (
        <SendTextButton
          to={record.phone_number}
          name={record.name}
          companyId={record.id}
          outcome={reachOutcome}
          hideTrigger
          open={reachText}
          onOpenChange={setReachText}
          onSent={() => {
            setReachText(false);
            // Only chain into email when we have a real address on file.
            if (reachEmailTo) setReachEmail(true);
          }}
        />
      ) : null}
      {reachEmailTo ? (
        <SendEmailButton
          to={reachEmailTo}
          name={record.name}
          website={record.website}
          companyId={record.id}
          outcome={reachOutcome}
          phone={record.phone_number}
          hideTrigger
          open={reachEmail}
          onOpenChange={setReachEmail}
        />
      ) : null}
    </>
  );
};
