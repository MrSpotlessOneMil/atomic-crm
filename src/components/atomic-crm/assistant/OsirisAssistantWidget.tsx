import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Send } from "lucide-react";
import { useDataProvider, useNotify } from "ra-core";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { CrmDataProvider } from "../providers/types";

type ChatMessage = { role: "user" | "assistant"; content: string };

export const OsirisAssistantWidget = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { mutate: ask, isPending } = useMutation({
    mutationFn: async (prompt: string) => {
      const next: ChatMessage[] = [...messages, { role: "user", content: prompt }];
      setMessages(next);
      setInput("");
      const reply = await dataProvider.osirisAssistantChat(next);
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
      // Roll back the optimistic user message so the input matches state.
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

        <div
          ref={scrollRef}
          className="max-h-72 overflow-y-auto space-y-3 text-sm pr-1"
        >
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Ask for a follow-up script, how to handle "I already have a
              cleaner", or the next move on a stuck deal.
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
