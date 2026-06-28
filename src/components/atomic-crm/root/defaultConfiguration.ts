import type { ConfigurationContextValue } from "./ConfigurationContext";

export const defaultDarkModeLogo = "./logos/logo_atomic_crm_dark.svg";
export const defaultLightModeLogo = "./logos/logo_atomic_crm_light.svg";

export const defaultCurrency = "USD";

export const defaultTitle = "Robin Line";

export const defaultCompanySectors = [
  { value: "communication-services", label: "Communication Services" },
  { value: "consumer-discretionary", label: "Consumer Discretionary" },
  { value: "consumer-staples", label: "Consumer Staples" },
  { value: "energy", label: "Energy" },
  { value: "financials", label: "Financials" },
  { value: "health-care", label: "Health Care" },
  { value: "industrials", label: "Industrials" },
  { value: "information-technology", label: "Information Technology" },
  { value: "materials", label: "Materials" },
  { value: "real-estate", label: "Real Estate" },
  { value: "utilities", label: "Utilities" },
];

// Robin Line SDR → AE funnel. SDRs own the top (Lead → Demo Booked);
// AEs take it from Demo Done through Closed. "won"/"lost" values are kept
// because the payout + leaderboard logic keys on stage = 'won'.
export const defaultDealStages = [
  { value: "lead", label: "Lead / Prospect" },
  { value: "contacted", label: "Contacted / Outreach Sent" },
  { value: "demo-booked", label: "Demo Booked" },
  { value: "demo-done", label: "Demo Done" },
  { value: "proposal-sent", label: "Proposal Sent" },
  { value: "in-negociation", label: "In Negotiation" },
  { value: "won", label: "Closed Won" },
  { value: "lost", label: "Closed Lost" },
];

// Closed-out stages drop off the active board.
export const defaultDealPipelineStatuses = ["won", "lost"];

// Repurposed as Lead Source — where the prospect came from.
export const defaultDealCategories = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "cold-call", label: "Cold Call" },
  { value: "inbound", label: "Inbound" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" },
];

export const defaultNoteStatuses = [
  { value: "cold", label: "Cold", color: "#7dbde8" },
  { value: "warm", label: "Warm", color: "#e8cb7d" },
  { value: "hot", label: "Hot", color: "#e88b7d" },
  { value: "in-contract", label: "In Contract", color: "#a4e87d" },
];

// SDR-facing activity types — what reps actually log each day.
export const defaultTaskTypes = [
  { value: "none", label: "None" },
  { value: "dm", label: "DM / Social outreach" },
  { value: "call", label: "Cold call" },
  { value: "follow-up", label: "Follow-up" },
  { value: "confirmation", label: "Confirmation" },
  { value: "demo", label: "Demo" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
];

export const defaultPayouts = {
  defaultRate: 0.1,
};

export const defaultConfiguration: ConfigurationContextValue = {
  companySectors: defaultCompanySectors,
  currency: defaultCurrency,
  dealCategories: defaultDealCategories,
  dealPipelineStatuses: defaultDealPipelineStatuses,
  dealStages: defaultDealStages,
  noteStatuses: defaultNoteStatuses,
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
  payouts: defaultPayouts,
};
