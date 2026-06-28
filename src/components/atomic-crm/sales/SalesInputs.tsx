import { email, required, useGetIdentity, useRecordContext } from "ra-core";
import { BooleanInput } from "@/components/admin/boolean-input";
import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";

import type { Sale } from "../types";

export function SalesInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Sale>();
  return (
    <div className="space-y-4 w-full">
      <TextInput source="first_name" validate={required()} helperText={false} />
      <TextInput source="last_name" validate={required()} helperText={false} />
      <TextInput
        source="email"
        validate={[required(), email()]}
        helperText={false}
      />
      <SelectInput
        source="sdr_role"
        label="Role"
        defaultValue="sdr"
        choices={[
          { id: "sdr", name: "SDR" },
          { id: "ae", name: "Account Executive" },
        ]}
        helperText="Upgrade an SDR to Account Executive"
      />
      <SelectInput
        source="platform"
        label="Platform"
        choices={[
          { id: "instagram", name: "Instagram" },
          { id: "tiktok", name: "TikTok" },
          { id: "facebook", name: "Facebook" },
          { id: "linkedin", name: "LinkedIn" },
          { id: "multiple", name: "Multiple / Cold call only" },
          { id: "none", name: "None" },
        ]}
        helperText={false}
      />
      <TextInput source="territory" label="Territory" helperText={false} />
      <TextInput
        source="quo_phone"
        label="Quo phone number"
        helperText="E.164 format, e.g. +13105551234 — used to send texts"
      />
      <BooleanInput
        source="administrator"
        readOnly={record?.id === identity?.id}
        helperText={false}
      />
      <BooleanInput
        source="disabled"
        readOnly={record?.id === identity?.id}
        helperText={false}
      />
    </div>
  );
}
