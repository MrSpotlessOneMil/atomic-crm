import { useMutation } from "@tanstack/react-query";
import {
  Briefcase,
  Check,
  CircleX,
  Copy,
  Mail,
  Pencil,
  Phone,
  Save,
} from "lucide-react";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useGetOne,
  useLocaleState,
  useLocales,
  useNotify,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useEffect, useState } from "react";
import { useFormState } from "react-hook-form";
import { RecordField } from "@/components/admin/record-field";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toE164 } from "../misc/phone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import ImageEditorField from "../misc/ImageEditorField";
import type { CrmDataProvider } from "../providers/types";
import type { Sale, SalesFormData } from "../types";

export const ProfilePage = () => {
  const [isEditMode, setEditMode] = useState(false);
  const { identity, refetch: refetchIdentity } = useGetIdentity();
  const { data, refetch: refetchUser } = useGetOne("sales", {
    id: identity?.id,
  });
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(identity.id, data);
    },
    onSuccess: () => {
      refetchIdentity();
      refetchUser();
      setEditMode(false);
      notify("crm.profile.updated", {
        messageArgs: {
          _: "Your profile has been updated",
        },
      });
    },
    onError: (_) => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: {
          _: "An error occurred. Please try again",
        },
      });
    },
  });

  if (!identity) return null;

  const handleOnSubmit = async (values: any) => {
    mutate(values);
  };

  return (
    <div className="max-w-lg mx-auto mt-8 space-y-6">
      <SetupCard
        current={data as Sale | undefined}
        onSave={(fields) => mutate({ ...(data as SalesFormData), ...fields })}
      />
      <QuoNumberCard
        current={data?.quo_phone}
        onSave={(quo_phone) => mutate({ ...(data as SalesFormData), quo_phone })}
      />
      <GmailConnectCard
        connected={!!(data as { gmail_connected?: boolean })?.gmail_connected}
        email={data?.email}
      />
      <Form onSubmit={handleOnSubmit} record={data}>
        <ProfileForm isEditMode={isEditMode} setEditMode={setEditMode} />
      </Form>
    </div>
  );
};

// Self-serve role / platform / territory — every rep can set their own lane.
const SetupCard = ({
  current,
  onSave,
}: {
  current?: Sale;
  onSave: (fields: {
    sdr_role: "sdr" | "ae";
    platform: string;
    territory: string;
  }) => void;
}) => {
  const [role, setRole] = useState<"sdr" | "ae">(current?.sdr_role ?? "sdr");
  const [platform, setPlatform] = useState(current?.platform ?? "");
  const [territory, setTerritory] = useState(current?.territory ?? "");
  useEffect(() => {
    setRole(current?.sdr_role ?? "sdr");
    setPlatform(current?.platform ?? "");
    setTerritory(current?.territory ?? "");
  }, [current?.sdr_role, current?.platform, current?.territory]);

  const dirty =
    role !== (current?.sdr_role ?? "sdr") ||
    platform !== (current?.platform ?? "") ||
    territory !== (current?.territory ?? "");

  const selectCls =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Your role & lane</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Role</label>
            <select
              className={selectCls}
              value={role}
              onChange={(e) => setRole(e.target.value as "sdr" | "ae")}
            >
              <option value="sdr">SDR</option>
              <option value="ae">Account Executive / Closer</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Platform</label>
            <select
              className={selectCls}
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="">—</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="linkedin">LinkedIn</option>
              <option value="multiple">Multiple / Cold call only</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Territory</label>
            <Input
              value={territory}
              onChange={(e) => setTerritory(e.target.value)}
              placeholder="e.g. Dallas"
            />
          </div>
        </div>
        <Button
          type="button"
          disabled={!dirty}
          onClick={() => onSave({ sdr_role: role, platform, territory })}
        >
          <Save className="w-4 h-4 mr-1" />
          Save
        </Button>
      </CardContent>
    </Card>
  );
};

const GMAIL_REDIRECT =
  "https://fliudmtgvnnqpnxpadwx.supabase.co/functions/v1/gmail_oauth_callback";

// Connect the rep's Google Workspace email so they can send from the CRM.
const GmailConnectCard = ({
  connected,
  email,
}: {
  connected: boolean;
  email?: string;
}) => {
  const connect = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", GMAIL_REDIRECT);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      // calendar.events (write) lets the AI agent CREATE demo events + invites;
      // calendar.readonly stays for free/busy + the gcal poller.
      "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    );
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    window.location.href = url.toString();
  };
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Send emails as your Gmail</h2>
        </div>
        {connected ? (
          <p className="text-sm text-green-600">
            ✓ Gmail connected{email ? ` (${email})` : ""}. You can email leads
            from here. (Click below to reconnect if needed.)
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect your Google Workspace email once. Then email leads from the
            CRM as yourself — every email logged automatically.
          </p>
        )}
        <Button type="button" onClick={connect} variant={connected ? "outline" : "default"}>
          <Mail className="w-4 h-4 mr-2" />
          {connected ? "Reconnect Gmail" : "Connect Gmail"}
        </Button>
      </CardContent>
    </Card>
  );
};

// Always-visible card to set the rep's Quo texting number — no edit-mode toggle.
const QuoNumberCard = ({
  current,
  onSave,
}: {
  current?: string | null;
  onSave: (quoPhone: string) => void;
}) => {
  const [value, setValue] = useState(current ?? "");
  useEffect(() => setValue(current ?? ""), [current]);
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center gap-2">
          <Phone className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Your texting number (Quo)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          The number your texts to leads send from. Use one of your Quo numbers
          in +1 format, e.g. +14246771112.
        </p>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="+14246771112"
          />
          <Button
            type="button"
            onClick={() => onSave(toE164(value))}
            disabled={!value.trim() || toE164(value) === (current ?? "")}
          >
            <Save className="w-4 h-4 mr-1" />
            Save
          </Button>
        </div>
        {current ? (
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-mono">{current}</span>
          </p>
        ) : (
          <p className="text-xs text-orange-500">
            Not set yet — texting won't work until you save a number here.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

const ProfileForm = ({
  isEditMode,
  setEditMode,
}: {
  isEditMode: boolean;
  setEditMode: (value: boolean) => void;
}) => {
  const notify = useNotify();
  const translate = useTranslate();
  const record = useRecordContext<Sale>();
  const { identity, refetch } = useGetIdentity();
  const { isDirty } = useFormState();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate: updatePassword } = useMutation({
    mutationKey: ["updatePassword"],
    mutationFn: async () => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.updatePassword(identity.id);
    },
    onSuccess: () => {
      notify("crm.profile.password_reset_sent", {
        messageArgs: {
          _: "A reset password email has been sent to your email address",
        },
      });
    },
    onError: (e) => {
      notify(`${e}`, {
        type: "error",
      });
    },
  });

  const { mutate: mutateSale } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(record.id, data);
    },
    onSuccess: () => {
      refetch();
      notify("crm.profile.updated", {
        messageArgs: {
          _: "Your profile has been updated",
        },
      });
    },
    onError: () => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: {
          _: "An error occurred. Please try again.",
        },
      });
    },
  });
  if (!identity) return null;

  const handleClickOpenPasswordChange = () => {
    updatePassword();
  };

  const handleAvatarUpdate = async (values: any) => {
    mutateSale(values);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <div className="mb-4 flex flex-row justify-between">
            <h2 className="text-xl font-semibold text-muted-foreground">
              {translate("crm.profile.title")}
            </h2>
          </div>

          <div className="space-y-4 mb-4">
            <ImageEditorField
              source="avatar"
              type="avatar"
              onSave={handleAvatarUpdate}
              linkPosition="right"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextRender source="first_name" isEditMode={isEditMode} />
              <TextRender source="last_name" isEditMode={isEditMode} />
            </div>
            <TextRender source="email" isEditMode={isEditMode} />
            <LanguageSelector />
          </div>

          <div className="flex flex-row justify-end gap-2">
            {!isEditMode && (
              <>
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleClickOpenPasswordChange}
                >
                  {translate("crm.profile.password.change")}
                </Button>
              </>
            )}

            <Button
              type="button"
              variant={isEditMode ? "ghost" : "outline"}
              onClick={() => setEditMode(!isEditMode)}
              className="flex items-center"
            >
              {isEditMode ? <CircleX /> : <Pencil />}
              {isEditMode
                ? translate("ra.action.cancel")
                : translate("ra.action.edit")}
            </Button>

            {isEditMode && (
              <Button type="submit" disabled={!isDirty} variant="outline">
                <Save />
                {translate("ra.action.save")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {import.meta.env.VITE_INBOUND_EMAIL && (
        <Card>
          <CardContent>
            <div className="space-y-4 justify-between">
              <h2 className="text-xl font-semibold text-muted-foreground">
                {translate("crm.profile.inbound.title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {translate("crm.profile.inbound.description", {
                  _: "You can start sending emails to your server's inbound email address, e.g. by adding it to the Cc: field. Atomic CRM will process the emails and add notes to the corresponding contacts.",
                  field: "Cc:",
                })}
              </p>
              <CopyPaste value={import.meta.env.VITE_INBOUND_EMAIL} />
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <div className="space-y-4 justify-between">
            <h2 className="text-xl font-semibold text-muted-foreground">
              {translate("crm.profile.mcp.title", {
                _: "MCP Server",
              })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translate("crm.profile.mcp.description", {
                _: "Use this URL to connect your AI assistant to your CRM data via the Model Context Protocol (MCP).",
              })}
            </p>
            <CopyPaste
              value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const LanguageSelector = () => {
  const translate = useTranslate();
  const locales = useLocales();
  const [locale, setLocale] = useLocaleState();

  if (locales.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate("crm.language")}
      </p>
      <Select value={locale} onValueChange={setLocale}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map((language) => (
            <SelectItem key={language.locale} value={language.locale}>
              {language.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const TextRender = ({
  source,
  isEditMode,
  className,
}: {
  source: string;
  isEditMode: boolean;
  className?: string;
}) => {
  const label = `resources.sales.fields.${source}`;
  if (isEditMode) {
    return (
      <TextInput
        source={source}
        label={label}
        helperText={false}
        className={className}
      />
    );
  }
  return (
    <div className={className}>
      <RecordField source={source} label={label} />
    </div>
  );
};

const CopyPaste = ({ value }: { value: string }) => {
  const translate = useTranslate();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    setCopied(true);
    navigator.clipboard.writeText(value);
    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            onClick={handleCopy}
            variant="ghost"
            className="normal-case justify-between w-full"
          >
            <span className="overflow-hidden text-ellipsis">{value}</span>
            {copied ? (
              <Check className="h-4 w-4 ml-2" />
            ) : (
              <Copy className="h-4 w-4 ml-2" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {copied
              ? translate("crm.common.copied")
              : translate("crm.common.copy")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

ProfilePage.path = "/profile";
