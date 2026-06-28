// Normalize any US phone input to E.164 (what Quo/OpenPhone requires).
// Handles every common format a rep might type or paste:
//   "661 903 9259", "(405) 885-9850", "+1 424 677 1112",
//   "1-424-677-1112", "424.677.1112", "+14246771112", raw "4246771112".
export const toE164 = (raw?: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  // Already has a country code: keep the leading + and digits only.
  if (trimmed.startsWith("+")) return "+" + trimmed.replace(/\D/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Unusual length — return digits with a + so at least it's well-formed.
  return digits ? `+${digits}` : "";
};
