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
      setMessages([
        ...next,
        { role: "assistant", content: "" }, // placeholder we'll stream into
      ]);
      setInput("");

      const outgoing = buildOutgoing(next);
      if (typeof dataProvider.osirisAssistantStream === "function") {
        return await dataProvider.osirisAssistantStream(outgoing, (delta) => {
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content: last.content + delta,
              };
            }
            return copy;
          });
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
            });
          });
        });
      }

      const reply = await dataProvider.osirisAssistantChat(outgoing);
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && last.content === "") {
          copy[copy.length - 1] = { ...last, content: reply };
        } else {
          copy.push({ role: "assistant", content: reply });
        }
        return copy;
      });
      return reply;
    },
    onSuccess: () => {
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
      // Pop the placeholder assistant message AND the user's message so the
      // input doesn't end up with a dangling unanswered turn.
      setMessages((prev) => {
        const trimmed = prev.slice();
        if (
          trimmed.length &&
          trimmed[trimmed.length - 1].role === "assistant" &&
          trimmed[trimmed.length - 1].content === ""
        ) {
          trimmed.pop();
        }
        if (trimmed.length && trimmed[trimmed.length - 1].role === "user") {
          trimmed.pop();
        }
        return trimmed;
      });
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
              {context.facts.slice(0, 4).map((f) => (
                <li key={f}>· {f.length > 80 ? `${f.slice(0, 80)}…` : f}</li>
              ))}
              {context.facts.length > 4 ? (
                <li>
                  · …plus {context.facts.length - 4} more (passed to the model)
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {context && messages.length === 0 ? (
          <div className="flex flex-wrap gap-1">
            {(context.kind === "contact"
              ? [
                  "Summarize this contact",
                  "Suggest the next step",
                  "Draft a follow-up email",
                ]
              : context.kind === "deal"
                ? [
                    "What's the highest-leverage next move?",
                    "Draft a follow-up to push this forward",
                    "Help me handle their objection",
                  ]
                : ["Summarize this company"]
            ).map((q) => (
              <Button
                key={q}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={() => ask(q)}
              >
                {q}
              </Button>
            ))}
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
