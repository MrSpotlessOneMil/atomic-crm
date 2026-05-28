import {
  CalendarCheck,
  DollarSign,
  Import,
  MessageSquare,
  Settings,
  Trophy,
  User,
  Users,
} from "lucide-react";
import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { ImportPage } from "../misc/ImportPage";
import { NotificationsBell } from "../notifications/NotificationsBell";
import { GlobalSearch } from "./GlobalSearch";

const Header = () => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();
  const location = useLocation();
  const translate = useTranslate();

  let currentPath: string | boolean = "/";
  if (matchPath("/", location.pathname)) {
    currentPath = "/";
  } else if (matchPath("/contacts/*", location.pathname)) {
    currentPath = "/contacts";
  } else if (matchPath("/companies/*", location.pathname)) {
    currentPath = "/companies";
  } else if (matchPath("/deals/*", location.pathname)) {
    currentPath = "/deals";
  } else if (matchPath("/payouts/*", location.pathname)) {
    currentPath = "/payouts";
  } else if (matchPath("/leaderboard/*", location.pathname)) {
    currentPath = "/leaderboard";
  } else if (matchPath("/community/*", location.pathname)) {
    currentPath = "/community";
  } else {
    currentPath = false;
  }

  return (
    <>
      <nav className="grow">
        <header className="bg-secondary">
          <div className="px-4">
            <div className="flex justify-between items-center flex-1">
              <Link
                to="/"
                className="flex items-center gap-2 text-secondary-foreground no-underline"
              >
                <img
                  className="[.light_&]:hidden h-6"
                  src={darkModeLogo}
                  alt={title}
                />
                <img
                  className="[.dark_&]:hidden h-6"
                  src={lightModeLogo}
                  alt={title}
                />
                <h1 className="text-xl font-semibold">{title}</h1>
              </Link>
              <div>
                <nav className="flex">
                  <NavigationTab
                    label={translate("ra.page.dashboard")}
                    to="/"
                    isActive={currentPath === "/"}
                  />
                  <NavigationTab
                    label={translate("resources.contacts.name", {
                      smart_count: 2,
                    })}
                    to="/contacts"
                    isActive={currentPath === "/contacts"}
                  />
                  <NavigationTab
                    label={translate("resources.companies.name", {
                      smart_count: 2,
                    })}
                    to="/companies"
                    isActive={currentPath === "/companies"}
                  />
                  <NavigationTab
                    label={translate("resources.deals.name", {
                      smart_count: 2,
                    })}
                    to="/deals"
                    isActive={currentPath === "/deals"}
                  />
                  <NavigationTab
                    label={translate("crm.nav.payouts", { _: "Payouts" })}
                    to="/payouts"
                    isActive={currentPath === "/payouts"}
                  />
                  <NavigationTab
                    label={translate("crm.nav.leaderboard", {
                      _: "Leaderboard",
                    })}
                    to="/leaderboard"
                    isActive={currentPath === "/leaderboard"}
                  />
                  <NavigationTab
                    label={translate("crm.nav.community", { _: "Community" })}
                    to="/community"
                    isActive={currentPath === "/community"}
                  />
                </nav>
              </div>
              <div className="flex items-center">
                <GlobalSearch />
                <NotificationsBell />
                <ThemeModeToggle />
                <RefreshButton />
                <UserMenu>
                  <ProfileMenu />
                  <PayoutsMenu />
                  <LeaderboardMenu />
                  <CommunityMenu />
                  <BookingsMenu />
                  <CanAccess resource="sales" action="list">
                    <UsersMenu />
                  </CanAccess>
                  <CanAccess resource="configuration" action="edit">
                    <SettingsMenu />
                  </CanAccess>
                  <ImportFromJsonMenuItem />
                </UserMenu>
              </div>
            </div>
          </div>
        </header>
      </nav>
    </>
  );
};

const NavigationTab = ({
  label,
  to,
  isActive,
}: {
  label: string;
  to: string;
  isActive: boolean;
}) => (
  <Link
    to={to}
    className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
      isActive
        ? "text-secondary-foreground border-secondary-foreground"
        : "text-secondary-foreground/70 border-transparent hover:text-secondary-foreground/80"
    }`}
  >
    {label}
  </Link>
);

const UsersMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<UsersMenu> must be used inside <UserMenu?");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/sales" className="flex items-center gap-2">
        <Users />
        {translate("resources.sales.name", { smart_count: 2 })}
      </Link>
    </DropdownMenuItem>
  );
};

const ProfileMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ProfileMenu> must be used inside <UserMenu?");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/profile" className="flex items-center gap-2">
        <User />
        {translate("crm.profile.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const SettingsMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<SettingsMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/settings" className="flex items-center gap-2">
        <Settings />
        {translate("crm.settings.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const PayoutsMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<PayoutsMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/payouts" className="flex items-center gap-2">
        <DollarSign />
        {translate("crm.nav.payouts", { _: "Payouts" })}
      </Link>
    </DropdownMenuItem>
  );
};

const LeaderboardMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<LeaderboardMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/leaderboard" className="flex items-center gap-2">
        <Trophy />
        {translate("crm.nav.leaderboard", { _: "Leaderboard" })}
      </Link>
    </DropdownMenuItem>
  );
};

const CommunityMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<CommunityMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/community" className="flex items-center gap-2">
        <MessageSquare />
        {translate("crm.nav.community", { _: "Community" })}
      </Link>
    </DropdownMenuItem>
  );
};

const BookingsMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<BookingsMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/bookings" className="flex items-center gap-2">
        <CalendarCheck />
        {translate("crm.nav.bookings", { _: "Bookings" })}
      </Link>
    </DropdownMenuItem>
  );
};

const ImportFromJsonMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ImportFromJsonMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ImportPage.path} className="flex items-center gap-2">
        <Import />
        {translate("crm.header.import_data")}
      </Link>
    </DropdownMenuItem>
  );
};
export default Header;
