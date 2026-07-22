# AI SDR — Diagnosis & Redesign (2026-07-22)

Deep dive into why the Robin Line SMS funnel spams leads, never books anyone, and
drops real buying signals. Evidence is from the live CRM (`fliudmtgvnnqpnxpadwx`)
and the deployed edge functions.

**Current state: `SALES_SENDS_PAUSED=true`.** No automated SMS is going out.

---

## 1. The numbers

| Metric | Value |
|---|---|
| Contacts | 505 |
| Outbound messages | 1,481 |
| Inbound messages | 99, from **33 contacts** (6.5% of contacts ever replied) |
| Outbound : inbound | **15 : 1** |
| Demos booked | 23 — **all via Calendly, zero by the AI** |
| Demos done | 2 |
| Won | 1 |
| Pending queued tasks | **2,101** (884 nurture SMS, 670 call tasks, 492 nurture emails) |

Each lead is enrolled in **26 touches** (per the CRM's own note: *"Auto-enrolled in
the follow-up drip (26 touches incl. 11 call steps)"*).

---

## 2. Root causes (code-level)

### 2.1 The agent is blind to the conversation — `_shared/salesAgent.ts:87`

```ts
async function loadHistory(contactId: number, limit = 20) {
  ...
  .order("created_at", { ascending: true })   // OLDEST first
  .limit(limit);                              // then take 20
}
```

This loads the **oldest 20 messages**, not the newest. Because every lead receives
a 26-touch drip (SMS *and* emails are both written to `agent_messages`), the 20-message
window is consumed entirely by outbound blasts before the lead ever replies. The
model therefore answers each inbound with almost no view of the live conversation.

Secondary effect: the window starts with 5+ consecutive `assistant` messages (the
drip), so the transcript reads to the model as a brand broadcasting, not a dialogue.

**Fix:** take the newest N (`ascending: false`, then reverse), separate the marketing
drip from conversational turns, and start the window at the first inbound message.

### 2.2 Proof — contact 629 (Nieveze, "Believe In Clean"), 2026-07-22

Real thread, 16 minutes, verbatim:

| # | Who | Message |
|---|---|---|
| 6 | lead | Yes |
| 7 | AI | hey! thanks for grabbing our templates. do you run the cleaning business yourself? |
| 8 | lead | Yes |
| 9 | AI | quick question - what's your name and what's your cleaning company called? |
| 10 | lead | **Nieveze believe in clean** |
| 11 | AI | are you the owner over at **Nieveze**? *(parsed her first name as the company)* |
| 12 | lead | Yes |
| 13 | AI | what's your name and what's the company called? *(re-ask #1)* |
| 14 | lead | Nieveze |
| 15 | AI | is Nieveze your first name? |
| 16 | lead | Believe In Clean |
| 17 | AI | **i'm Robin, just wanted to reach out personally** *(re-introduces itself 17 messages in)* |
| 18 | lead | Yes |
| 19 | AI | what's your name and what's the business called? *(re-ask #2)* |
| 20 | lead | Yes |
| 21 | AI | what's your name and what's the business called? *(re-ask #3)* |
| 22 | lead | **I just said it** |
| 23 | AI | quick one - what's your name and what's the business called? *(re-ask #4)* |

Every reply opens with a fresh greeting. The contact record **already had
`first_name = Nieveze`** from the lead form, and the system prompt passes it as
`Known so far:`. The agent still asked four times.

### 2.3 Buying signals ignored

- **Contact 602** — lead: *"Do you have a link?"* → AI: *"yeah we can do that - but first, can i ask what kind of cleaning business you run?"* The lead asked to book. The AI refused and kept qualifying.
- **Contact 560** — lead: *"What time"* → AI: *"what's your name and what's the business called?"*
- **Contact 425 (Diego)** — lead: *"For 5+ years working for a company and I want to start my own company and get commercial contracts."* AI asked one question, then the thread died. No link, no booking, no alert.

### 2.4 Nobody is ever handed a booking path

`book_appointment` (Google Calendar + Meet, `_shared/googleCalendar.ts`) is deployed
and functional, but **has produced zero bookings**. All 23 demos read
*"📅 Demo booked via Calendly"*. Not one drip message contains a link.

Worse, the drip *promises* times it cannot honor. `NURTURE.nudge_timeab` —
*"i've got tomorrow at 9am or 4:30pm open for your 15 min setup call"* — was sent
verbatim to **73 different people** with no calendar behind it.

Every Calendly booking also logs *"no phone on file, SMS reminders skipped"* — booked
demos get no reminders at all. On 2026-07-22 a lead emailed *"I joined and no one was
on the call."*

### 2.5 Re-enrollment restarts the drip on people we promised to stop texting

- **Contact 425 (Diego)** enrolled **4×** (Jun 27, Jul 10, Jul 11, Jul 20). On Jul 11 he received *"closing your file so I stop texting"* — and four minutes later a fresh opener restarted the whole sequence. Again on Jul 20.
- **Contact 408** enrolled ~5× under name variants (`jack`, `jacks'`, `Test`, `TEST`), receiving five parallel copies of every step.
- **25 contacts** currently have duplicate copies of the same nurture step queued (23 doubled, 2 quadrupled).

`hasRecentSmsCadence` (365-day window, `_shared/contactIdentity.ts`) exists to prevent
this. Some enrollment door bypasses it — find and close it.

### 2.6 Opt-outs do not tear down the queue — **legal exposure**

| Contact | Said | Suppressed | Tasks still queued |
|---|---|---|---|
| 621 | STOP | yes | **21** |
| 612 | Stop | yes | **18** |
| 563 | stop | yes | **18** |
| 552 | Wrong number | yes | **15** |
| 606 | "Sorry we are good." | **no** | **20** |

The dispatcher checks `sms_suppressions` at send time for SMS, so texts are blocked —
but the rows stay live, `nurture_email` has no equivalent guard, and the FCC's
April 2025 update is explicit that an opt-out must apply *everywhere*, not just on one
channel. TCPA damages are **$500–$1,500 per message**, and filings are up ~27% in 2026.

STOP must **cancel** the queue, not merely gate it.

### 2.7 Owner alerts are being ingested as lead replies

Contact 633's inbound messages are iMessage tapbacks on Robin Line's own owner-alert
texts: *"Disliked '🔔 New Robinline lead / Name: Samuel Egbeyan / …'"*. The AI replied
to them as if they were the lead. That one contact contains alerts for **two different
leads** (Samuel and Melissa), and the agent addressed both names in the same thread.

The owner-alert number must be excluded from inbound lead processing.

### 2.8 Auto-responders treated as human replies

Contact 561's out-of-office (*"I'm sorry I missed your call… we'll assist you as soon
as we return"*) was answered with *"what's making it feel like bad timing?"*.

---

## 3. Research — what actually works

**Cadence.** 4–6 touches over 3–4 weeks; 2–3 days apart early, 7–14 days later.
Under 4 leaves replies on the table; over 6 damages sender reputation. 58% of replies
come from the first message. Current `NURTURE` is **10 texts in 10 days, three in the
first 8 hours** — roughly 3× the recommended density in a tenth of the recommended window.

**Speed.** Replying within 5 minutes makes qualification 21× more likely. Current
median AI response is ~4 seconds — this is the one thing already working. Keep it.

**Voice.** Text like a person: one point per message, one question, reference what they
just said, under ~320 characters. The existing STYLE block already says this; the agent
can't follow it without conversation memory.

**Segmentation.** Hot / warm / cold: hot gets fast scheduling + reminders, warm gets
light follow-up, cold goes to a long slow nurture. Today every lead gets the identical
26-touch blast regardless of what they said.

**Autonomy.** The fully-autonomous AI SDR underperformed in 2026. The winning pattern
is human-in-the-loop: AI does research, monitoring, drafting, and scheduling logistics;
humans own judgment and the actual conversation once it's real. Standard guardrail:
escalate any reply containing a question, or over ~80 words, to a human within 30 minutes.

**Compliance.** TCPA one-to-one consent (in force since Jan 2025) means consent cannot
be shared across brands; opt-out must be honored on every channel within 10 business days.

---

## 4. Target design — form fill → booked on Dominic's calendar

### Stage 1 — Instant first touch (automated, unchanged)
Lead submits the form → single SMS within seconds, plus the magnet email. Keep the
speed. One message, names the rep, one easy question, `reply stop to opt out` on the
first text only.

### Stage 2 — Conversation (AI, with memory and real tools)
The moment they reply, the drip is cancelled (already works) and the agent takes over
with:
- **the newest 30 conversational turns**, drip messages excluded (fixes §2.1)
- everything already known — name, company, magnet, ad/campaign, prior calls
- a hard rule: **never ask for anything the record or thread already contains**
- **`get_availability`** — real free/busy from Dominic's calendar, returns 3 concrete slots
- **`book_appointment`** — existing tool: real event, Meet link, invites lead + Dominic
- **`send_booking_link`** — used *immediately* whenever a lead asks for a link
- intent shortcuts: "link" / "what time" / "yes" → offer slots or link, never re-qualify

### Stage 3 — Booking
Preferred: agent proposes 3 real open slots from free/busy, lead picks, agent books it
and texts the Meet link. Requires the `calendar.events` + `calendar.readonly` scope on
`gmail_tokens` for `CLOSER_SALES_ID` (schema has no `scope` column — verify by calling
free/busy live before relying on it).

Fallback if the scope is missing or free/busy fails: send the Calendly link
immediately, then confirm from the Calendly webhook (already wired).

**Always capture the phone on booking** so reminders actually fire — every Calendly
booking today logs "no phone on file."

### Stage 4 — Confirmation & show-up
Existing `demoReminders.ts` stack (confirmation, 24h/12h/3h/1h, no-show check).
Add the email counterpart — currently SMS-only.

### Stage 5 — Human in the loop
- **Alert Dominic on every reply**, with the message text and a link to the thread.
- **Escalate immediately** — question the agent can't answer, pricing negotiation, >80 words, angry, or enterprise.
- **Owner takeover pause**: when Dominic texts the lead from OpenPhone, automation stops for that contact (`contacts.ai_paused_until`; already built on `main`, not deployed).

### Stage 6 — If they don't reply
Not the current 10-in-10. **5 touches over 3 weeks**: day 0, 2, 5, 12, 21, then stop —
permanently. A closed-out file never reopens.

---

## 5. Build order

**P0 — stop the harm (do before un-pausing sends)**
1. Fix `loadHistory` to newest-N, exclude drip messages from the agent transcript.
2. STOP/opt-out **cancels** all queued tasks across every channel; add suppression check to `handleEmailTask`.
3. Close the re-enrollment door; dedupe the 25 contacts with doubled queues.
4. Exclude the owner-alert number from inbound lead processing.
5. Re-space `NURTURE` to 5 touches / 21 days; delete `nudge_timeab` (it promises times we don't have).
6. Purge/re-space the 2,101-task backlog before resuming — otherwise it floods on un-pause.

**P1 — make it book**
7. `get_availability` tool over Google free/busy; verify the calendar scope live.
8. Prompt rules: never re-ask known facts; a link request is answered with a link.
9. Capture phone at booking; add confirmation/reminder emails.

**P2 — human in the loop**
10. Reply alerts to Dominic's phone with thread context.
11. Escalation rules (question / >80 words / pricing / angry).
12. Deploy the `ai_paused_until` takeover pause already on `main`.

---

## 6. Verification

- Replay contact 629's thread against the fixed agent — it must never re-ask the name.
- Send a test form fill → confirm one SMS, no duplicates.
- Text "link" → expect a booking link in the first reply.
- Text a time preference → expect real slots from free/busy, then a real calendar event.
- Text STOP → confirm zero pending tasks remain for that contact, on every channel.
- `npx vitest run --config vitest.functions.config.ts` (206 tests green as of this writing).
