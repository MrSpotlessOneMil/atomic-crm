import type { CrmDataProvider } from "../providers/types";
import { toE164 } from "../misc/phone";

// Best-effort: pull the most recent OpenPhone call transcript for a phone
// number so follow-up drafts can reference what was actually said on the call.
// Returns "" when there's no phone, no calls, or the transcript isn't ready yet
// (OpenPhone transcribes a minute or two after the call) — callers fall back.
export async function fetchLatestTranscript(
  dataProvider: CrmDataProvider,
  phone?: string | null,
): Promise<string> {
  const to = toE164(phone ?? "");
  if (!to) return "";
  try {
    const calls = (await dataProvider.quoCalls(to)) as
      | { createdAt?: string; transcript?: string }[]
      | undefined;
    const withText = (calls ?? []).filter((c) => (c.transcript ?? "").trim());
    if (withText.length === 0) return "";
    // quoCalls returns oldest→newest; the last is the most recent.
    return (withText[withText.length - 1].transcript ?? "").trim();
  } catch {
    return "";
  }
}
