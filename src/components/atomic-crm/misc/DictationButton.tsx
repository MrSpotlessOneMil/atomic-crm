import { Mic } from "lucide-react";
import { useNotify } from "ra-core";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Minimal typing for the Web Speech API — it isn't in the default TS DOM lib.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// Tap to dictate: streams speech-to-text from the browser and hands each
// finalized chunk to `onText` (which typically appends it to a caption box).
// Renders nothing on browsers without the Web Speech API (e.g. Firefox), so
// callers can drop it in unconditionally.
export const DictationButton = ({
  onText,
  className,
}: {
  onText: (text: string) => void;
  className?: string;
}) => {
  const notify = useNotify();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = !!getRecognitionCtor();

  // Always call the freshest onText without re-subscribing the recognizer.
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
    };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      finalText = finalText.trim();
      if (finalText) onTextRef.current(finalText);
    };
    rec.onerror = (e: any) => {
      setListening(false);
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        notify("Microphone blocked — allow mic access in your browser.", {
          type: "warning",
        });
      } else if (e?.error === "no-speech") {
        // Silent timeout — nothing to report.
      } else if (e?.error) {
        notify("Voice input hit a snag — try again.", { type: "warning" });
      }
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <Button
      type="button"
      size="icon"
      variant={listening ? "default" : "outline"}
      className={cn(
        "h-8 w-8 shrink-0",
        listening && "bg-red-600 text-white hover:bg-red-700 animate-pulse",
        className,
      )}
      onClick={toggle}
      aria-label={listening ? "Stop dictation" : "Dictate"}
      title={listening ? "Tap to stop" : "Tap and speak"}
    >
      <Mic className="w-4 h-4" />
    </Button>
  );
};
