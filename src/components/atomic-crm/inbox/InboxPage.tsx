import {
  BellRing,
  Loader2,
  PhoneCall,
  Send,
  Sparkles,
  SquarePen,
  UserPlus,
} from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useLocaleState,
  useNotify,
} from "ra-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CrmDataProvider } from "../providers/types";
import { getSupabaseClient } from "../providers/supabase/supabase";
import type { Company, Contact } from "../types";
import { toE164 } from "../misc/phone";
import { formatRelativeDate } from "../misc/RelativeDate";
import { ensureContactForCompany } from "../companies/ensureContact";
import { markInboxViewed } from "./useInboxUnread";

const REMINDER_CHOICES: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
];

type Convo = {
  id: string;
  phone: string;
  name: string | null;
  lastActivityAt: string | null;
};

// A textable lead in the inbox: a CRM contact, a CRM company, or an OpenPhone
// number not yet in the CRM (a "quo-" id). `phone_number` is what the
// Conversation loads/sends on; `crmPath` links to the record; contactId /
// companyId let reminders attach to the right row. `_blob` / `_digits` are the
// lowercased name+phone+email haystack the search filters against.
type Lead = {
  id: string;
  name: string;
  phone_number: string;
  crmPath?: string;
  contactId?: number;
  companyId?: number;
  _blob?: string;
  _digits?: string;
};

// A row shown in the inbox list: a lead plus the conversation's last-activity
// time so we can sort newest-first like Quo.
type Row = { lead: Lead; lastActivityAt: string | null };

const onlyDigits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

type Message = {
  id: string;
  text: string;
  direction: "incoming" | "outgoing";
  createdAt: string;
  status?: string;
};

type Call = {
  id: string;
  direction: "incoming" | "outgoing";
  status?: string;
  createdAt: string;
  duration: number | null;
  recordingUrl: string | null;
  transcript: string;
};

type TimelineItem =
  | { kind: "msg"; createdAt: string; msg: Message }
  | { kind: "call"; createdAt: string; call: Call };

export const InboxPage = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [locale = "en"] = useLocaleState();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  // null = still loading; [] = loaded but no threads / unavailable.
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const startNewMessage = () => searchRef.current?.focus();

  // Every textable lead comes from TWO tables: contacts (what the funnel
  // creates) and companies. The inbox is contact-first — a rep searching a
  // name/number/email needs to find the contact, not just a company that
  // happens to share the number.
  const { data: companies, refetch: refetchCompanies } = useGetList<Company>(
    "companies",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "name", order: "ASC" },
    },
  );
  const { data: contacts, refetch: refetchContacts } = useGetList<Contact>(
    "contacts",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "last_seen", order: "DESC" },
    },
  );

  useEffect(() => {
    let active = true;
    dataProvider
      .quoConversations()
      .then((c) => active && setConvos(c as Convo[]))
      .catch(() => active && setConvos([]));
    return () => {
      active = false;
    };
  }, [dataProvider]);

  // Opening (and leaving) the Inbox clears the "new replies" nav badge.
  useEffect(() => {
    markInboxViewed();
    return () => markInboxViewed();
  }, []);

  // Unified textable-lead list: contacts first (deduped by E.164 so several
  // rows on one number collapse to the most-recent one), then any company whose
  // number a contact didn't already cover. Each lead carries a search haystack.
  const allLeads = useMemo<Lead[]>(() => {
    const list: Lead[] = [];
    const seen = new Set<string>();
    for (const c of contacts ?? []) {
      const numbers = (c.phone_jsonb ?? [])
        .map((p) => p?.number)
        .filter((n): n is string => !!n);
      if (!numbers.length) continue; // the inbox is for texting; skip no-phone
      const e164 = toE164(numbers[0]);
      if (e164 && seen.has(e164)) continue;
      const name =
        `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || e164 || "Lead";
      const emails = (c.email_jsonb ?? [])
        .map((e) => e?.email)
        .filter((e): e is string => !!e);
      list.push({
        id: `contact-${c.id}`,
        name,
        phone_number: e164 || numbers[0],
        crmPath: `/contacts/${c.id}/show`,
        contactId: Number(c.id),
        _blob: [name, ...numbers, ...emails].join(" ").toLowerCase(),
        _digits: numbers.map(onlyDigits).join(" "),
      });
      if (e164) seen.add(e164);
    }
    for (const co of companies ?? []) {
      const e164 = toE164(co.phone_number);
      if (e164 && seen.has(e164)) continue;
      const name = co.name || e164 || "Lead";
      list.push({
        id: `company-${co.id}`,
        name,
        phone_number: co.phone_number || e164,
        crmPath: `/companies/${co.id}/show`,
        companyId: Number(co.id),
        _blob: `${name} ${co.phone_number ?? ""}`.toLowerCase(),
        _digits: onlyDigits(co.phone_number),
      });
      if (e164) seen.add(e164);
    }
    return list;
  }, [contacts, companies]);

  // Phone → lead lookup so a live OpenPhone conversation shows the lead's name.
  const byPhone = useMemo(() => {
    const m = new Map<string, Lead>();
    for (const l of allLeads) {
      const p = toE164(l.phone_number);
      if (p && !m.has(p)) m.set(p, l);
    }
    return m;
  }, [allLeads]);

  // Build the list to render. Searching matches ANY lead by name, phone (any
  // format), or email; otherwise we show real conversations, newest-first.
  const query = q.trim().toLowerCase();
  const qDigits = onlyDigits(query);
  let rows: Row[] = [];
  if (query) {
    rows = allLeads
      .filter(
        (l) =>
          (l._blob ?? "").includes(query) ||
          (qDigits.length >= 3 && (l._digits ?? "").includes(qDigits)),
      )
      .slice(0, 100)
      .map((l) => ({ lead: l, lastActivityAt: null }));
  } else if (convos && convos.length) {
    rows = convos.map((cv) => {
      const lead: Lead = byPhone.get(toE164(cv.phone)) ?? {
        id: `quo-${cv.phone}`,
        name: cv.name || cv.phone,
        phone_number: cv.phone,
      };
      return { lead, lastActivityAt: cv.lastActivityAt };
    });
  } else if (convos) {
    // No conversations yet (or Quo unavailable) — fall back to the lead list so
    // the rep can still start the first message.
    rows = allLeads
      .slice(0, 100)
      .map((l) => ({ lead: l, lastActivityAt: null }));
  }

  const loading = convos === null && !query;

  return (
    <div className="flex h-[calc(100vh-7rem)] border rounded-xl overflow-hidden mt-2 bg-background">
      {/* Left: conversations (newest first) */}
      <div className="w-72 sm:w-80 border-r flex flex-col shrink-0">
        <div className="px-4 pt-4 pb-1 flex items-center justify-between">
          <h1 className="text-sm font-bold uppercase tracking-wider">Inbox</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="New message"
            onClick={startNewMessage}
          >
            <SquarePen className="w-4 h-4" />
          </Button>
        </div>
        <div className="px-3 py-2">
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any lead to text…"
            className="h-9 rounded-lg"
          />
        </div>
        <div className="overflow-auto flex-1 px-2 pb-3">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {query ? "No leads match." : "No conversations yet."}
            </div>
          ) : (
            rows.map(({ lead: c, lastActivityAt }) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={cn(
                  "w-full text-left flex gap-3 items-center rounded-lg px-2.5 py-2.5 mb-0.5 relative hover:bg-muted/60 transition-colors",
                  selected?.id === c.id ? "bg-muted" : "",
                )}
              >
                {selected?.id === c.id ? (
                  <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-foreground rounded-full" />
                ) : null}
                <LeadAvatar name={c.name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">
                      {c.name}
                    </span>
                    {lastActivityAt ? (
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {formatRelativeDate(lastActivityAt, locale)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.phone_number || "no phone"}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Center: conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <Conversation
            key={selected.id}
            company={selected}
            onLeadCreated={(c) => {
              setSelected(c);
              refetchCompanies();
              refetchContacts();
            }}
          />
        ) : (
          <div className="m-auto text-center text-muted-foreground text-sm max-w-xs px-6">
            <SquarePen className="w-6 h-6 mx-auto mb-3 opacity-60" />
            <p className="font-medium text-foreground">
              Start texting any lead
            </p>
            <p className="mt-1">
              Pick a conversation on the left, or{" "}
              <button
                onClick={startNewMessage}
                className="underline text-foreground font-medium"
              >
                search a lead
              </button>{" "}
              to open a new thread.
            </p>
          </div>
        )}
      </div>

      {/* Right: contact details */}
      {selected ? <ContactPanel company={selected} /> : null}
    </div>
  );
};

// Initials avatar (grayscale, matches the rest of the CRM).
const initialsOf = (name?: string) =>
  (name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

const LeadAvatar = ({ name, size = 38 }: { name?: string; size?: number }) => (
  <span
    className="flex items-center justify-center rounded-full bg-muted border text-foreground font-semibold shrink-0"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
  >
    {initialsOf(name)}
  </span>
);

const ContactPanel = ({ company }: { company: Lead }) => {
  return (
    <aside className="w-72 border-l shrink-0 hidden lg:flex flex-col overflow-auto p-5">
      <div className="flex flex-col items-center text-center gap-2 pb-5 border-b">
        <LeadAvatar name={company.name} size={56} />
        <div className="font-bold leading-tight">{company.name}</div>
        {company.crmPath ? (
          <Link
            to={company.crmPath}
            className="text-xs font-semibold underline text-foreground"
          >
            View lead in CRM →
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Not in CRM yet</span>
        )}
      </div>
      <div className="mt-5">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Contact
        </h3>
        <div className="flex justify-between gap-2 py-2 border-b text-sm">
          <span className="text-muted-foreground">Name</span>
          <span className="truncate max-w-[60%] text-right">
            {company.name}
          </span>
        </div>
        <div className="flex justify-between gap-2 py-2 border-b text-sm">
          <span className="text-muted-foreground">Phone</span>
          <span className="text-right">{company.phone_number || "—"}</span>
        </div>
      </div>
    </aside>
  );
};

const Conversation = ({
  company,
  onLeadCreated,
}: {
  company: Lead;
  onLeadCreated?: (lead: Lead) => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { identity } = useGetIdentity();
  const notify = useNotify();
  const [messages, setMessages] = useState<Message[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [reminding, setReminding] = useState(false);

  // A synthetic row (an OpenPhone number not yet in the CRM) has a "quo-" id.
  const isUnknown = String(company.id).startsWith("quo-");

  const scheduleReminder = async (days: number) => {
    setReminding(true);
    try {
      // A contact lead already IS a contact — attach directly. A company lead
      // resolves (or creates) its contact. (Unknown "quo-" leads never show the
      // Remind button, so contactId/companyId is always present here.)
      const contactId =
        company.contactId ??
        (company.companyId
          ? await ensureContactForCompany({
              companyId: company.companyId,
              companyName: company.name ?? "Lead",
              phone: company.phone_number,
              salesId: identity?.id,
            })
          : null);
      if (contactId == null)
        throw new Error("No lead to attach a reminder to.");
      const due = new Date();
      due.setDate(due.getDate() + days);
      due.setHours(9, 0, 0, 0);
      await getSupabaseClient()
        .from("tasks")
        .insert({
          contact_id: contactId,
          type: "Follow-up",
          text: `Follow up with ${company.name ?? "lead"}`,
          due_date: due.toISOString(),
          sales_id: identity?.id,
        });
      notify("Reminder set", { type: "success" });
      setRemindOpen(false);
    } catch (e) {
      notify((e as Error).message ?? "Could not set reminder", {
        type: "error",
      });
    } finally {
      setReminding(false);
    }
  };
  const [addOpen, setAddOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [saving, setSaving] = useState(false);

  const saveLead = async () => {
    if (!leadName.trim()) return;
    setSaving(true);
    try {
      const { data: created } = await dataProvider.create<Company>(
        "companies",
        {
          data: {
            name: leadName.trim(),
            phone_number: company.phone_number,
            sales_id: identity?.id,
          },
        },
      );
      notify("Lead added", { type: "success" });
      setAddOpen(false);
      onLeadCreated?.({
        id: `company-${created.id}`,
        name: created.name,
        phone_number: created.phone_number,
        crmPath: `/companies/${created.id}/show`,
        companyId: Number(created.id),
      });
    } catch (e) {
      notify((e as Error).message ?? "Could not add lead", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [msgs, cls] = await Promise.all([
        dataProvider.quoMessages(company.phone_number),
        // Calls/transcripts may be unavailable (plan) — don't block messages.
        dataProvider.quoCalls(company.phone_number).catch(() => []),
      ]);
      setMessages(msgs as Message[]);
      setCalls(cls as Call[]);
    } catch (e) {
      setError((e as Error).message);
      setMessages([]);
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  const timeline: TimelineItem[] = [
    ...messages.map((m) => ({
      kind: "msg" as const,
      createdAt: m.createdAt,
      msg: m,
    })),
    ...calls.map((c) => ({
      kind: "call" as const,
      createdAt: c.createdAt,
      call: c,
    })),
  ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await dataProvider.sendQuoSms({
        to: company.phone_number,
        content: text.trim(),
      });
      setText("");
      await load();
    } catch (e) {
      notify((e as Error).message ?? "Could not send", { type: "error" });
    } finally {
      setSending(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const convo =
        messages
          .map(
            (m) => `${m.direction === "incoming" ? "Them" : "Me"}: ${m.text}`,
          )
          .join("\n") || "(no messages yet)";
      // Fold in every call transcript we have so the draft is grounded in what
      // was actually said on the phone, not just the texts.
      const transcripts = calls
        .filter((c) => (c.transcript ?? "").trim())
        .map(
          (c) =>
            `${c.direction === "incoming" ? "Inbound" : "Outbound"} call transcript:\n${c.transcript}`,
        )
        .join("\n\n");
      const prompt = `I'm an SDR following up with ${company.name}, a cleaning-company lead.${
        transcripts ? `\n\n${transcripts}` : ""
      }\n\nText conversation so far:\n${convo}\n\nUsing EVERYTHING above (call transcripts + texts), draft the single best next text to send to move toward booking a demo — natural, warm, one short message. Never ask me a question or add commentary. Output ONLY the message text.`;
      const reply = await dataProvider.osirisAssistantChat([
        { role: "user", content: prompt },
      ]);
      setText(typeof reply === "string" ? reply.trim() : "");
    } catch (e) {
      notify((e as Error).message ?? "AI is unavailable", { type: "error" });
    } finally {
      setSuggesting(false);
    }
  };

  // Auto-fill the composer with the AI's best next message as soon as the
  // conversation (texts + call transcripts) has loaded — the rep then tweaks it
  // or regenerates with "Suggest reply".
  const [autoDrafted, setAutoDrafted] = useState(false);
  useEffect(() => {
    if (loading || autoDrafted) return;
    if (timeline.length === 0) return;
    if (text.trim()) return;
    setAutoDrafted(true);
    suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, autoDrafted, timeline.length]);

  return (
    <>
      <div className="px-4 py-3 border-b flex items-center gap-3">
        <LeadAvatar name={company.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate leading-tight">{company.name}</div>
          <div className="text-xs text-muted-foreground">
            {company.phone_number}
          </div>
        </div>
        {isUnknown ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setLeadName(
                company.name === company.phone_number ? "" : company.name,
              );
              setAddOpen(true);
            }}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add as lead
          </Button>
        ) : null}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {company.phone_number}
            </div>
            <Input
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
              placeholder="Company / lead name"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button onClick={saveLead} disabled={saving || !leadName.trim()}>
              {saving ? "Adding…" : "Add lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-auto px-5 py-5 flex flex-col gap-1.5 bg-background">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            {error}
          </div>
        ) : timeline.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No messages or calls yet. Start the conversation below.
          </div>
        ) : (
          timeline.map((item) =>
            item.kind === "msg" ? (
              <div
                key={item.msg.id}
                className={cn(
                  "flex w-full",
                  item.msg.direction === "outgoing"
                    ? "justify-end"
                    : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words",
                    item.msg.direction === "outgoing"
                      ? "bg-gradient-to-b from-[#1f9dff] to-[#0a7aff] text-white rounded-br-md"
                      : "bg-muted text-foreground rounded-bl-md",
                  )}
                >
                  {item.msg.text}
                </div>
              </div>
            ) : (
              <CallCard key={item.call.id} call={item.call} />
            ),
          )
        )}
      </div>

      <div className="border-t p-3">
        {remindOpen && !isUnknown ? (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Remind me in:
            </span>
            {REMINDER_CHOICES.map((r) => (
              <button
                key={r.label}
                type="button"
                disabled={reminding}
                onClick={() => scheduleReminder(r.days)}
                className="text-xs rounded-full border px-2.5 py-1 hover:bg-foreground hover:text-background hover:border-foreground transition-colors disabled:opacity-50"
              >
                {r.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="rounded-2xl border bg-background px-3 py-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message…"
            rows={1}
            className="border-0 shadow-none focus-visible:ring-0 resize-none min-h-[24px] p-0 px-0"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={suggest}
              disabled={suggesting}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {suggesting ? "Thinking…" : "Suggest reply"}
            </Button>
            {!isUnknown ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRemindOpen((o) => !o)}
                title="Set a follow-up reminder"
              >
                <BellRing className="w-4 h-4 mr-2" />
                Remind
              </Button>
            ) : null}
            <Button
              size="sm"
              className="ml-auto"
              onClick={send}
              disabled={sending || !text.trim()}
            >
              <Send className="w-4 h-4 mr-2" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

const CallCard = ({ call }: { call: Call }) => {
  const [showTranscript, setShowTranscript] = useState(false);
  const out = call.direction === "outgoing";
  const when = call.createdAt ? new Date(call.createdAt).toLocaleString() : "";
  return (
    <div className="self-center max-w-[80%] rounded-xl border bg-muted/40 p-3 text-sm my-1">
      <div className="flex items-center gap-2 font-medium justify-center">
        <PhoneCall className="w-4 h-4 text-muted-foreground" />
        {out ? "Outgoing" : "Incoming"} call
        {call.duration != null ? ` · ${call.duration}s` : ""}
        {call.status ? ` · ${call.status}` : ""}
      </div>
      {when ? (
        <div className="text-xs text-muted-foreground">{when}</div>
      ) : null}
      {call.recordingUrl ? (
        <audio controls src={call.recordingUrl} className="w-full mt-2 h-9" />
      ) : null}
      {call.transcript ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowTranscript((s) => !s)}
            className="text-xs text-primary hover:underline"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript ? (
            <p className="mt-1 text-muted-foreground whitespace-pre-wrap">
              {call.transcript}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

InboxPage.path = "/inbox";
