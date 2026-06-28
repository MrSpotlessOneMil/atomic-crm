import { Mail, Send, Sparkles } from "lucide-react";
import {
  type Identifier,
  useDataProvider,
  useGetIdentity,
  useNotify,
} from "ra-core";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { CrmDataProvider } from "../providers/types";
import { ensureContactForCompany } from "../companies/ensureContact";
import { DictationButton } from "../misc/DictationButton";
import { buildOutcomeCopy } from "./callOutcomeCopy";
import { fetchLatestTranscript } from "./fetchLatestTranscript";

// Robustly split an AI draft into { subject, body }. The model sometimes adds a
// preamble, markdown "---", or a chatty first sentence — none of which should
// ever end up as the email subject line.
function parseDraft(
  raw: string,
  fallbackSubject: string,
): { subject: string; body: string } {
  const lines = raw.replace(/\r/g, "").split("\n");
  // Drop leading blank lines, markdown rules, and code fences.
  while (lines.length && /^(\s*|-{2,}|`{3,}.*)$/.test(lines[0])) lines.shift();

  // Prefer an explicit "Subject:" line near the top.
  const subjIdx = lines.findIndex((l) => /^\s*subject\s*:/i.test(l));
  if (subjIdx !== -1 && subjIdx < 6) {
    const subject = lines[subjIdx].replace(/^\s*subject\s*:/i, "").trim();
    const body = lines
      .slice(subjIdx + 1)
      .join("\n")
      .replace(/^\s+/, "")
      .trim();
    return { subject: subject || fallbackSubject, body };
  }

  // Otherwise the first non-empty line is the subject — but only if it actually
  // looks like one (short, single line). A long sentence is body, not a subject.
  const first = (lines[0] ?? "").trim();
  const rest = lines.slice(1).join("\n").replace(/^\s+/, "").trim();
  if (first && first.length <= 120) {
    return { subject: first, body: rest };
  }
  return {
    subject: fallbackSubject,
    body: [first, rest].filter(Boolean).join("\n\n"),
  };
}

// Pull the bare domain from a website so we can pre-fill "@domain.com".
function domainFromWebsite(website?: string | null): string {
  if (!website) return "";
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Compose & send an email as the rep's own Gmail, with AI drafting from a quick
// caption. Logged on the lead.
export const SendEmailButton = ({
  to: toProp,
  name,
  website,
  contactId,
  companyId,
  className,
  outcome,
  phone,
  open: openProp,
  onOpenChange,
  hideTrigger,
  onSent,
}: {
  to?: string | null;
  name?: string;
  website?: string | null;
  contactId?: Identifier;
  companyId?: Identifier;
  className?: string;
  /** Call outcome from the Log Call dialog — seeds a premade subject + body. */
  outcome?: string;
  /** Lead phone — used to pull the call transcript for AI drafting. */
  phone?: string | null;
  /** Controlled-open mode (used to auto-pop the composer after logging a call). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger button (when opened programmatically). */
  hideTrigger?: boolean;
  /** Fired after an email is successfully sent. */
  onSent?: () => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { identity } = useGetIdentity();
  const notify = useNotify();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (o: boolean) => {
    if (isControlled) onOpenChange?.(o);
    else setInternalOpen(o);
  };
  const domain = domainFromWebsite(website);
  const defaultTo = toProp || (domain ? `@${domain}` : "");
  const [to, setTo] = useState(defaultTo);
  const [caption, setCaption] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setTo(defaultTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toProp, website]);

  // Seed a premade subject + body from the call outcome when the composer opens.
  // Fully editable — the rep can rewrite it or refine with AI.
  const leadFirst = (name ?? "").split(" ")[0];
  const firstName = (identity?.fullName ?? "").split(" ")[0] || "me";
  useEffect(() => {
    if (!open || !outcome) return;
    const copy = buildOutcomeCopy(outcome, leadFirst, firstName);
    if (copy) {
      setSubject((prev) => (prev.trim() ? prev : copy.emailSubject));
      setBody((prev) => (prev.trim() ? prev : copy.emailBody));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outcome]);

  const draft = async () => {
    setDrafting(true);
    try {
      const transcript = await fetchLatestTranscript(dataProvider, phone);
      const outcomeHint = outcome
        ? buildOutcomeCopy(outcome, leadFirst, firstName)?.aiHint
        : undefined;
      const RULES = `Rules:
- CRITICAL: Output ONLY a finished, ready-to-send email. NEVER ask a question back, never request clarification, never explain yourself or add commentary. If anything is unclear, infer the most reasonable intent and still write a complete, sendable email.
- Sound human and genuine. Plain language, no hype, no hard sell, no buzzwords.
- Keep it concise and easy to read.
- Do NOT pitch or mention Robin Line, a demo, or our product UNLESS clearly warranted by the conversation.
- For reference only: ${firstName} works at Robin Line, an AI system that answers calls/texts and books jobs for cleaning companies.
- No placeholders like [Name]. Sign off as ${firstName}.

Output ONLY the email — no preamble, no explanation, no markdown, no separators like "---". The VERY FIRST line must be the subject line (a short phrase, no "Subject:" prefix), then a blank line, then the email body.`;
      const prompt = transcript
        ? `You're helping ${firstName} write a follow-up email to ${
            name ?? "a lead"
          } right after a phone call. Here is the transcript of that call:
"""
${transcript.slice(0, 5000)}
"""
Write a warm, natural follow-up email that references what was actually discussed and moves things forward.${
            caption.trim() ? ` Also factor in what ${firstName} adds: "${caption.trim()}".` : ""
          }

${RULES}`
        : `You're helping ${firstName} write a single email to ${
            name ?? "someone"
          }. Write exactly the email ${firstName} is asking for, in a warm, natural, conversational tone. Base it on this instruction: "${
            caption.trim() || "a friendly follow-up after the call"
          }".${outcomeHint ? ` Context from the call just now: ${outcomeHint}` : ""}

${RULES}`;
      const reply = (await dataProvider.osirisAssistantChat([
        { role: "user", content: prompt },
      ])) as string;
      const fallbackSubject = `Following up, ${name ?? "there"}`;
      const { subject: subjLine, body: rest } = parseDraft(
        reply ?? "",
        fallbackSubject,
      );
      setSubject(subjLine);
      setBody(rest);
      notify(
        transcript
          ? "Drafted from your call transcript"
          : "Drafted (call transcript not ready yet)",
        { type: "info" },
      );
    } catch (e) {
      notify((e as Error).message ?? "AI is unavailable", { type: "error" });
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      notify(
        "That email looks incomplete — add the name before the @ (e.g. owner@…).",
        { type: "warning" },
      );
      return;
    }
    setSending(true);
    try {
      let cid = contactId;
      if (!cid && companyId) {
        cid = await ensureContactForCompany({
          companyId,
          companyName: name ?? "Lead",
          salesId: identity?.id,
        });
      }
      await dataProvider.sendGmail({
        to: to.trim(),
        subject,
        body,
        contact_id: cid,
      });
      notify("Email sent", { type: "success" });
      setSubject("");
      setBody("");
      setCaption("");
      setOpen(false);
      onSent?.();
    } catch (e) {
      notify((e as Error).message ?? "Could not send email", { type: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className={className}>
            <Mail className="w-4 h-4 mr-2" />
            Email
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email {name ?? "lead"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="owner@cleaningco.com"
          />

          {/* AI draft from a quick caption */}
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                Let AI write it from your call
              </p>
              <DictationButton
                onText={(t) =>
                  setCaption((c) => (c.trim() ? `${c.trim()} ${t}` : t))
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Pulls your call transcript and drafts a follow-up. Add a note below
              to steer it (optional).
            </p>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Optional steer — e.g. 'send pricing, mention Thursday'"
              rows={2}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={draft}
              disabled={drafting}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {drafting ? "Drafting…" : "Draft from call"}
            </Button>
          </div>

          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Your message… (or let AI draft it above)"
            rows={6}
          />
        </div>
        <DialogFooter>
          <Button onClick={send} disabled={sending || !to || !subject || !body}>
            <Send className="w-4 h-4 mr-2" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
