import { useGetList } from "ra-core";

import { OsirisAssistantWidget } from "../assistant/OsirisAssistantWidget";
import type { Contact, ContactNote } from "../types";
import { CallQueueWidget } from "./CallQueueWidget";
import { DashboardActivityLog } from "./DashboardActivityLog";
import { DashboardStepper } from "./DashboardStepper";
import { DealsChart } from "./DealsChart";
import { EarningsWidget } from "./EarningsWidget";
import { HotContacts } from "./HotContacts";
import { PersonalActivityFeed } from "./PersonalActivityFeed";
import { ShareProfileWidget } from "./ShareProfileWidget";
import { DailyTasks } from "./DailyTasks";
import { FollowUpsWidget } from "./FollowUpsWidget";
import { TasksList } from "./TasksList";
import { UnassignedLeadsWidget } from "./UnassignedLeadsWidget";
import { Welcome } from "./Welcome";

export const Dashboard = () => {
  const {
    data: dataContact,
    total: totalContact,
    isPending: isPendingContact,
  } = useGetList<Contact>("contacts", {
    pagination: { page: 1, perPage: 1 },
  });

  const { total: totalContactNotes, isPending: isPendingContactNotes } =
    useGetList<ContactNote>("contact_notes", {
      pagination: { page: 1, perPage: 1 },
    });

  const { total: totalDeal, isPending: isPendingDeal } = useGetList<Contact>(
    "deals",
    {
      pagination: { page: 1, perPage: 1 },
    },
  );

  const isPending = isPendingContact || isPendingContactNotes || isPendingDeal;

  if (isPending) {
    return null;
  }

  const body = !totalContact ? (
    <DashboardStepper step={1} />
  ) : !totalContactNotes ? (
    <DashboardStepper step={2} contactId={dataContact?.[0]?.id} />
  ) : (
    <DashboardGrid totalDeal={totalDeal} />
  );

  return (
    <div className="flex flex-col gap-6 mt-1">
      <DailyTasks />
      <CallQueueWidget />
      <FollowUpsWidget />
      {body}
    </div>
  );
};

const DashboardGrid = ({ totalDeal }: { totalDeal?: number }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
      <div className="md:col-span-3">
        <div className="flex flex-col gap-4">
          {import.meta.env.VITE_IS_DEMO === "true" ? <Welcome /> : null}
          <HotContacts />
        </div>
      </div>
      <div className="md:col-span-6">
        <div className="flex flex-col gap-6">
          {totalDeal ? <DealsChart /> : null}
          <PersonalActivityFeed />
          <DashboardActivityLog />
        </div>
      </div>

      <div className="md:col-span-3">
        <div className="flex flex-col gap-4">
          <UnassignedLeadsWidget />
          <ShareProfileWidget />
          <EarningsWidget />
          <OsirisAssistantWidget />
          <TasksList />
        </div>
      </div>
    </div>
  );
};
