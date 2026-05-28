import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Send } from "lucide-react";
import { useDataProvider, useNotify } from "ra-core";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { CrmDataProvider } from "../providers/types";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type AssistantContext = {
  kind: "contact" | "deal" | "company";
  label: string;
  /**
   * Lines of context shown to the user under the header AND injected into the
   * assistant prompt. Keep it short — facts only, no commentary.
   */
  facts: string[];
};

export const OsirisAssistantWidget = ({
  context,
}: {
  context?: AssistantContext;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const buildOutgoing = (next: ChatMessage[]): ChatMessage[] => {
    if (!context) return next;
    // Prepend a synthetic framing turn describing the current record. The
    // edge function caps each message at 4000 chars and clips to the last 20.
    const contextBlock = [
      `Current ${context.kind}: ${context.label}`,
      ...context.facts.map((f) => `- ${f}`),
    ].join("\n");
    return [
      {
        role: "user",
        content: `Context for this conversation (read-only):\n${contextBlock}`,
      },
      { role: "assistant", content: "Got it. How can I help?" },
      ...next,
    ];
  };

  const { mutate: ask, isPending } = useMutation({
    mutationFn: async (prompt: string) => {
      const next: ChatMessage[] = [
        ...messages,
        { role: "user", content: prompt },
      ];
      setMessages(next);
      setInput("");
      const reply = await dataProvider.osirisAssistantChat(buildOutgoing(next));
      return reply;
    },
    onSuccess: (reply) => {
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    },
    onError: (err: Error) => {
      notify(err.message || "Assistant failed", {
        type: "error",
        messageArgs: { _: err.message || "Assistant failed" },
      });
      setMessages((prev) => prev.slice(0, -1));
    },
  });

  const submit = () => {
    const prompt = input.trim();
    if (!prompt || isPending) return;
    ask(prompt);
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            OSIRIS assistant
          </h2>
        </div>

        {context ? (
          <div className="text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
            <p className="font-medium text-foreground">
              {context.kind === "contact"
                ? "Contact:"
                : context.kind === "deal"
                  ? "Deal:"
                  : "Company:"}{" "}
              {context.label}
            </p>
            <ul className="mt-1 space-y-0.5">
              {context.facts.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="max-h-72 overflow-y-auto space-y-3 text-sm pr-1"
        >
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {context
                ? `Ask for a follow-up script, an objection-handling line, or the next move for ${context.label}.`
                : `Ask for a follow-up script, how to handle "I already have a cleaner", or the next move on a stuck deal.`}
            </p>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-6 rounded-md bg-primary text-primary-foreground px-3 py-2 whitespace-pre-wrap"
                    : "mr-6 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap"
                }
              >
                {m.content}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask OSIRIS…"
            disabled={isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <Button size="sm" onClick={submit} disabled={!input.trim() || isPending}>
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
