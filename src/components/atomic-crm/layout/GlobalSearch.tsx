import { useQuery } from "@tanstack/react-query";
import { Building2, Search, User, Target } from "lucide-react";
import { useDataProvider } from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import type { Company, Contact, Deal } from "../types";

type ContactSummary = Contact & { company_name?: string };

export const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dataProvider = useDataProvider();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const enabled = open && query.trim().length >= 2;

  const { data: contacts } = useQuery({
    queryKey: ["global-search", "contacts", query],
    enabled,
    queryFn: async (): Promise<ContactSummary[]> => {
      const res = await dataProvider.getList<ContactSummary>("contacts", {
        pagination: { page: 1, perPage: 5 },
        sort: { field: "last_seen", order: "DESC" },
        filter: { q: query },
      });
      return res.data;
    },
  });

  const { data: companies } = useQuery({
    queryKey: ["global-search", "companies", query],
    enabled,
    queryFn: async (): Promise<Company[]> => {
      const res = await dataProvider.getList<Company>("companies", {
        pagination: { page: 1, perPage: 5 },
        sort: { field: "name", order: "ASC" },
        filter: { q: query },
      });
      return res.data;
    },
  });

  const { data: deals } = useQuery({
    queryKey: ["global-search", "deals", query],
    enabled,
    queryFn: async (): Promise<Deal[]> => {
      const res = await dataProvider.getList<Deal>("deals", {
        pagination: { page: 1, perPage: 5 },
        sort: { field: "updated_at", order: "DESC" },
        filter: { q: query },
      });
      return res.data;
    },
  });

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  const showHint = useMemo(
    () => query.trim().length > 0 && query.trim().length < 2,
    [query],
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search className="w-5 h-5" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search contacts, deals, companies… (cmd+k)"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {showHint ? (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Keep typing…
            </p>
          ) : null}
          <CommandEmpty>No matches.</CommandEmpty>

          {(contacts ?? []).length > 0 ? (
            <CommandGroup heading="Contacts">
              {(contacts ?? []).map((c) => (
                <CommandItem
                  key={`c-${c.id}`}
                  value={`contact-${c.id}-${c.first_name}-${c.last_name}`}
                  onSelect={() => go(`/contacts/${c.id}/show`)}
                >
                  <User className="w-3 h-3 mr-2" />
                  {(c.first_name ?? "") + " " + (c.last_name ?? "")}
                  {c.company_name ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      · {c.company_name}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {(deals ?? []).length > 0 ? (
            <CommandGroup heading="Deals">
              {(deals ?? []).map((d) => (
                <CommandItem
                  key={`d-${d.id}`}
                  value={`deal-${d.id}-${d.name}`}
                  onSelect={() => go(`/deals/${d.id}/show`)}
                >
                  <Target className="w-3 h-3 mr-2" />
                  {d.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    · {d.stage}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {(companies ?? []).length > 0 ? (
            <CommandGroup heading="Companies">
              {(companies ?? []).map((co) => (
                <CommandItem
                  key={`co-${co.id}`}
                  value={`company-${co.id}-${co.name}`}
                  onSelect={() => go(`/companies/${co.id}/show`)}
                >
                  <Building2 className="w-3 h-3 mr-2" />
                  {co.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
};
