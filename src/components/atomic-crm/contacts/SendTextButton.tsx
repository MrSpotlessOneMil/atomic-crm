import { MessageSquare, Send, Sparkles } from "lucide-react";
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
import { toE164 } from "../misc/phone";
import { ensureContactForCompany } from "../companies/ensureContact";
import { DictationButton } from "../misc/DictationButton";
import { buildOutcomeCopy } from "./callOutcomeCopy";
import { fetchLatestTranscript } from "./fetchLatestTranscript";

// One-tap "Text" — sends an SMS through the rep's Quo number, with AI drafting
// from a quick caption. Works on any lead (company or contact).
export const SendTextButton = ({
  to: toProp,
  name,
  contactId,
  companyId,
  className,
  outcome,
  open: openProp,
  onOpenChange,
  hideTrigger,
  onSent,
}: {
  to?: string | null;
  name?: string;
  contactId?: Identifier;
  companyId?: Identifier;
  className?: string;
  /** Call outcome from the Log Call dialog — seeds a premade message. */
  outcome?: string;
  /** Controlled-open mode (used to auto-pop the composer after logging a call). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger button (when opened programmatically). */
  hideTrigger?: boolean;
  /** Fired after a text is successfully sent (used to chain into email). */
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
  const [to, setTo] = useState(toE164(toProp));
  const [caption, setCaption] = useState("");
  const [content, setContent] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setTo(toE164(toProp));
  }, [toProp]);

  const firstName = (identity?.fullName ?? "").split(" ")[0] || "me";

  // When the composer opens with a selected call outcome, drop in the matching
  // premade message so the rep has something ready to send (still fully editable
  // — they can tweak it, delete it and write their own, or refine with AI).
  const leadFirst = (name ?? "").split(" ")[0];
  useEffect(() => {
    if (!open || !outcome) return;
    const copy = buildOutcomeCopy(outcome, leadFirst, firstName);
    if (copy) {
      setContent((prev) => (prev.trim() ? prev : copy.sms));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outcome]);

  const draft = async () => {
    setDrafting(true);
    try {
      // Pull the most recent call transcript for this lead so the follow-up can
      // reference what was actually said. OpenPhone transcribes a minute or two
      // after the call, so it may not be ready yet — fall back gracefully.
      const transcript = await fetchLatestTranscript(dataProvider, to);
      const outcomeHint = outcome
        ? buildOutcomeCopy(outcome, leadFirst, firstName)?.aiHint
        : undefined;
      const RULES = `Rules:
- CRITICAL: Output ONLY a finished, ready-to-send message. NEVER ask a question back, never request clarification, never explain yourself or add commentary. If anything is unclear, infer the most reasonable intent and still write a complete, sendable message.
- Sound human and easy. Plain language, no hype, no salesy phrasing.
- Only include an emoji if it clearly fits — don't add them by default.
- Keep it to ONE text, under 320 characters. No subject line, no placeholders like [Name], no signature unless it reads naturally.
- Do NOT pitch or mention Robin Line, a demo, or our product UNLESS clearly warranted by the conversation.
- For reference only: ${firstName} works at Robin Line, an AI system that answers calls/texts and books jobs for cleaning companies.

Return ONLY the message text.`;
      const prompt = transcript
        ? `You're helping ${firstName} write a single follow-up text to ${
            name ?? "a lead"
          } right after a phone call. Here is the transcript of that call:
"""
${transcript.slice(0, 4000)}
"""
Write ONE warm, natural follow-up text that references what was actually discussed and moves things forward.${
            caption.trim() ? ` Also factor in what ${firstName} adds: "${caption.trim()}".` : ""
          }

${RULES}`
        : `You're helping ${firstName} write a single text message to ${
            name ?? "someone"
          }. Write exactly the message ${firstName} is asking for, in a warm, natural, conversational tone — like a real person texting. Base it on this instruction: "${
            caption.trim() || "a friendly follow-up after the call"
          }".${outcomeHint ? ` Context from the call just now: ${outcomeHint}` : ""}

${RULES}`;
      const reply = (await dataProvider.osirisAssistantChat([
        { role: "user", content: prompt },
      ])) as string;
      setContent((reply ?? "").trim());
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
    setSending(true);
    try {
      let cid = contactId;
      if (!cid && companyId) {
        cid = await ensureContactForCompany({
          companyId,
          companyName: name ?? "Lead",
          phone: to,
          salesId: identity?.id,
        });
      }
      await dataProvider.sendQuoSms({
        to: toE164(to),
        content,
        contact_id: cid,
      });
      notify("Text sent", { type: "success" });
      setContent("");
      setCaption("");
      setOpen(false);
      onSent?.();
    } catch (e) {
      notify((e as Error).message ?? "Could not send text", { type: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className={className}>
            <MessageSquare className="w-4 h-4 mr-2" />
            Text
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Text {name ?? "lead"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+13105551234"
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
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Optional steer — e.g. 'keep it short, push for Thursday'"
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

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Your message… (or let AI draft it above)"
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button onClick={send} disabled={sending || !to || !content}>
            <Send className="w-4 h-4 mr-2" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
