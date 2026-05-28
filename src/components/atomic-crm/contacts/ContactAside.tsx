import { useGetList, useRecordContext, useTranslate } from "ra-core";
import { EditButton } from "@/components/admin/edit-button";
import { DeleteButton } from "@/components/admin";
import { ReferenceManyField } from "@/components/admin/reference-many-field";
import { ShowButton } from "@/components/admin/show-button";

import { OsirisAssistantWidget } from "../assistant/OsirisAssistantWidget";
import { AddTask } from "../tasks/AddTask";
import { TasksIterator } from "../tasks/TasksIterator";
import { TagsListEdit } from "./TagsListEdit";
import { ContactStatusSelector } from "./ContactInputs";
import { ContactPersonalInfo } from "./ContactPersonalInfo";
import { ContactBackgroundInfo } from "./ContactBackgroundInfo";
import { AsideSection } from "../misc/AsideSection";
import type { Contact, ContactNote } from "../types";
import { ContactMergeButton } from "./ContactMergeButton";
import { ExportVCardButton } from "./ExportVCardButton";

export const ContactAside = ({ link = "edit" }: { link?: "edit" | "show" }) => {
  const record = useRecordContext<Contact>();
  const translate = useTranslate();

  if (!record) return null;

  return (
    <div className="hidden sm:block w-92 min-w-92 text-sm">
      <div className="mb-4 -ml-1">
        {link === "edit" ? (
          <EditButton label="resources.contacts.action.edit" />
        ) : (
          <ShowButton label="resources.contacts.action.show" />
        )}
      </div>

      <AsideSection title={translate("resources.notes.fields.status")}>
        <ContactStatusSelector />
      </AsideSection>

      <AsideSection
        title={translate("resources.contacts.field_categories.personal_info")}
      >
        <ContactPersonalInfo />
      </AsideSection>

      <AsideSection
        title={translate("resources.contacts.field_categories.background_info")}
      >
        <ContactBackgroundInfo />
      </AsideSection>

      <AsideSection
        title={translate("resources.tags.name", { smart_count: 2 })}
      >
        <TagsListEdit />
      </AsideSection>

      <AsideSection
        title={translate("resources.tasks.name", { smart_count: 2 })}
      >
        <ReferenceManyField
          target="contact_id"
          reference="tasks"
          sort={{ field: "due_date", order: "ASC" }}
          perPage={1000}
        >
          <TasksIterator />
        </ReferenceManyField>
        <AddTask />
      </AsideSection>

      <AsideSection title="OSIRIS assistant">
        <ContactAssistant record={record} />
      </AsideSection>

      {/* see ContactAssistant below */}
      {link !== "edit" && (
        <>
          <div className="mt-6 pt-6 border-t hidden sm:flex flex-col gap-2 items-start">
            <ExportVCardButton />
            <ContactMergeButton />
          </div>
          <div className="mt-6 pt-6 border-t hidden sm:flex flex-col gap-2 items-start">
            <DeleteButton
              className="h-6 cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40"
              size="sm"
            />
          </div>
        </>
      )}
    </div>
  );
};

const ContactAssistant = ({ record }: { record: Contact }) => {
  // Pull the most recent notes so the assistant has real context to work from.
  const { data: notes } = useGetList<ContactNote>("contact_notes", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "date", order: "DESC" },
    filter: { contact_id: record.id },
  });

  const facts = [
    record.title ? `Title: ${record.title}` : null,
    record.company_name ? `Company: ${record.company_name}` : null,
    record.status ? `Status: ${record.status}` : null,
    record.background ? `Background: ${record.background}` : null,
    ...((notes ?? []).slice(0, 8).map((n) => {
      const when = n.date
        ? new Date(n.date).toISOString().slice(0, 10)
        : "unknown date";
      return `Note (${when}): ${(n.text ?? "").slice(0, 400)}`;
    }) as string[]),
  ].filter((s): s is string => !!s);

  return (
    <OsirisAssistantWidget
      context={{
        kind: "contact",
        label:
          `${record.first_name ?? ""} ${record.last_name ?? ""}`.trim() ||
          `Contact #${record.id}`,
        facts,
      }}
    />
  );
};
