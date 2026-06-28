import Papa from "papaparse";
import { Upload } from "lucide-react";
import { useNotify } from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSupabaseClient } from "../providers/supabase/supabase";

type CompanyRow = {
  name: string;
  phone_number: string;
  website: string;
  address: string;
  description: string;
  territory: string;
  vertical: string;
};

// Parse the Google Maps "Instant Data Scraper" CSV format into company rows.
function parseGoogleCsv(text: string, territory: string): CompanyRow[] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const out: CompanyRow[] = [];
  const seen = new Set<string>();
  const phoneRe = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/;
  for (const raw of parsed.data) {
    const vals = (raw as string[]).map((v) => (v || "").trim());
    const mapsu = vals.find((v) => v.includes("google.com/maps/place/")) || "";
    if (!mapsu) continue; // skips header + empty rows
    const slugM = mapsu.match(/\/place\/([^/]+)\//);
    let nm = slugM ? decodeURIComponent(slugM[1]).replace(/\+/g, " ").trim() : "";
    nm = nm.replace(/\s+/g, " ").replace(/&amp;/g, "&");
    if (!nm || seen.has(nm.toLowerCase())) continue;
    seen.add(nm.toLowerCase());
    const website =
      vals.find(
        (v) =>
          v.startsWith("http") &&
          !v.includes("google.") &&
          !v.includes("googleusercontent"),
      ) || "";
    const nonurl = vals.filter((v) => !v.startsWith("http"));
    let phone = "";
    for (const v of nonurl) {
      const m = v.match(phoneRe);
      if (m) {
        phone = m[1];
        break;
      }
    }
    const rating = nonurl.find((v) => /^[0-5](\.\d)?$/.test(v)) || "";
    let reviews = "";
    for (const v of nonurl) {
      if (/^-?\d+(\.0)?$/.test(v)) {
        const iv = Math.abs(parseInt(v, 10));
        if (iv > 5) {
          reviews = String(iv);
          break;
        }
      }
    }
    const category =
      nonurl.find(
        (v) =>
          /(cleaning|janitorial|maid|window|service|care)/i.test(v) &&
          !v.toLowerCase().includes("google") &&
          v.length < 45 &&
          v.toLowerCase() !== nm.toLowerCase(),
      ) || "";
    const address =
      nonurl.find(
        (v) =>
          /^\d+\s+\S/.test(v) &&
          v.length < 90 &&
          !v.toLowerCase().includes("google"),
      ) || "";
    const vertical = /window/i.test(category) ? "expansion" : "cleaning";
    const desc = `Google: ${rating || "?"} (${reviews || "?"} reviews) - ${
      category || "Cleaning"
    } - ${mapsu.split("?")[0]}`;
    out.push({
      name: nm.slice(0, 120),
      phone_number: phone,
      website: website.slice(0, 300),
      address,
      description: desc.slice(0, 500),
      territory,
      vertical,
    });
  }
  return out;
}

export const ImportLeadsPage = () => {
  const notify = useNotify();
  const [territory, setTerritory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CompanyRow[] | null>(null);
  const [importing, setImporting] = useState(false);

  const onFile = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    if (!f || !territory.trim()) return;
    const text = await f.text();
    setPreview(parseGoogleCsv(text, territory.trim()));
  };

  const reparse = async (terr: string) => {
    setTerritory(terr);
    if (file && terr.trim()) {
      const text = await file.text();
      setPreview(parseGoogleCsv(text, terr.trim()));
    }
  };

  const doImport = async () => {
    if (!preview?.length) return;
    setImporting(true);
    try {
      // Bulk insert in chunks of 500.
      let inserted = 0;
      for (let i = 0; i < preview.length; i += 500) {
        const chunk = preview.slice(i, i + 500);
        const { error } = await getSupabaseClient()
          .from("companies")
          .insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
      }
      notify(`Imported ${inserted} companies to ${territory}`, {
        type: "success",
      });
      setPreview(null);
      setFile(null);
    } catch (e) {
      notify((e as Error).message ?? "Import failed", { type: "error" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Import leads</h1>
        <p className="text-muted-foreground text-sm">
          Upload a Google Maps scrape CSV (Instant Data Scraper format) and tag
          it with a location. Each row becomes a company in that territory.
        </p>
      </div>

      <Card>
        <CardContent className="py-5 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Location / territory</label>
            <Input
              value={territory}
              onChange={(e) => reparse(e.target.value)}
              placeholder="e.g. Austin"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">CSV file</label>
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {preview ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {preview.length} companies found → {territory}
              </p>
              <ul className="mt-2 space-y-0.5 text-muted-foreground max-h-40 overflow-auto">
                {preview.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    • {c.name} {c.phone_number ? `· ${c.phone_number}` : ""}
                  </li>
                ))}
                {preview.length > 8 ? <li>…and {preview.length - 8} more</li> : null}
              </ul>
            </div>
          ) : null}

          <Button
            onClick={doImport}
            disabled={!preview?.length || importing || !territory.trim()}
          >
            <Upload className="w-4 h-4 mr-2" />
            {importing
              ? "Importing…"
              : preview?.length
                ? `Import ${preview.length} companies`
                : "Import"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

ImportLeadsPage.path = "/import-leads";
