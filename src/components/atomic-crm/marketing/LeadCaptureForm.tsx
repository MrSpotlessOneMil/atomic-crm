import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

const FUNCTION_URL =
  import.meta.env.VITE_SUPABASE_URL +
  "/functions/v1/public_lead";
const PUBLISHABLE_KEY = import.meta.env.VITE_SB_PUBLISHABLE_KEY;

export const LeadCaptureForm = () => {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    service_interest: "residential",
    message: "",
    website: "", // honeypot
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind === "submitting") return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PUBLISHABLE_KEY ? { apikey: PUBLISHABLE_KEY } : {}),
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        let detail = "Submission failed";
        try {
          const j = await res.json();
          detail = j?.error ?? j?.message ?? detail;
        } catch {
          // ignore
        }
        setState({ kind: "error", message: detail });
        return;
      }
      setState({ kind: "ok" });
    } catch {
      setState({
        kind: "error",
        message: "Network error. Please try again.",
      });
    }
  };

  if (state.kind === "ok") {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
          <h3 className="text-xl font-semibold">Thanks — we got it.</h3>
          <p className="text-muted-foreground">
            One of our reps will reach out shortly with a quote.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-6">
        <form className="space-y-4" onSubmit={submit}>
          {/* Honeypot — hidden from humans, bots fill it. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            className="absolute left-[-9999px] top-[-9999px]"
            aria-hidden="true"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="lead-first">First name</Label>
              <Input
                id="lead-first"
                required
                value={form.first_name}
                onChange={(e) =>
                  setForm({ ...form, first_name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lead-last">Last name</Label>
              <Input
                id="lead-last"
                required
                value={form.last_name}
                onChange={(e) =>
                  setForm({ ...form, last_name: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="lead-email">Email</Label>
              <Input
                id="lead-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lead-phone">Phone (optional)</Label>
              <Input
                id="lead-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-service">Service</Label>
            <Select
              value={form.service_interest}
              onValueChange={(v) =>
                setForm({ ...form, service_interest: v })
              }
            >
              <SelectTrigger id="lead-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="residential">Residential cleaning</SelectItem>
                <SelectItem value="commercial">Commercial cleaning</SelectItem>
                <SelectItem value="recurring">Recurring contract</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-message">Tell us about the job</Label>
            <Textarea
              id="lead-message"
              rows={3}
              placeholder="Size of the place, frequency, anything else we should know."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </div>
          {state.kind === "error" ? (
            <p className="text-sm text-destructive">{state.message}</p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={state.kind === "submitting"}
          >
            {state.kind === "submitting" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Request a quote
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
