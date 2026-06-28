import { Check, Copy, Link as LinkIcon } from "lucide-react";
import { useGetIdentity } from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const ShareProfileWidget = () => {
  const { identity } = useGetIdentity();
  const [copied, setCopied] = useState(false);

  if (!identity?.id) return null;

  // App is hash-routed, so public links must include the hash.
  const url = `${window.location.origin}/#/u/${identity.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore — old browsers without Clipboard API.
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Share your page
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Post this link on social to bring in leads. Anyone who books through
          it gets routed to you.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs px-2 py-1.5 bg-muted rounded truncate">
            {url}
          </code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? (
              <Check className="w-3 h-3" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
