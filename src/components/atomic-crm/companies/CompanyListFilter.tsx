import { Building, MapPin, Sparkles, Truck, Users } from "lucide-react";
import { FilterLiveForm, useGetIdentity, useTranslate } from "ra-core";
import { ToggleFilterButton } from "@/components/admin/toggle-filter-button";
import { SearchInput } from "@/components/admin/search-input";

import { FilterCategory } from "../filters/FilterCategory";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { getTranslatedCompanySizeLabel } from "./getTranslatedCompanySizeLabel";
import { sizes } from "./sizes";

// Territories the lead bank is organized by.
const regions = [
  "Bay Area",
  "Los Angeles",
  "New York",
  "Chicago",
  "Dallas",
  "Miami",
  "Charlotte",
  "Denver",
  "Phoenix",
  "Oklahoma City",
  "San Antonio",
];

export const CompanyListFilter = () => {
  const { identity } = useGetIdentity();
  const { companySectors } = useConfigurationContext();
  const translate = useTranslate();
  const translatedSizes = sizes.map((size) => ({
    ...size,
    name: getTranslatedCompanySizeLabel(size, translate),
  }));
  return (
    <div className="w-52 min-w-52 flex flex-col gap-8">
      <FilterLiveForm>
        <SearchInput source="q" />
      </FilterLiveForm>

      <FilterCategory icon={<MapPin className="h-4 w-4" />} label="Region">
        {regions.map((region) => (
          <ToggleFilterButton
            className="w-full justify-between"
            label={region}
            key={region}
            value={{ "territory@eq": region }}
          />
        ))}
      </FilterCategory>

      <FilterCategory icon={<Sparkles className="h-4 w-4" />} label="Focus">
        <ToggleFilterButton
          className="w-full justify-between"
          label="Cleaning (active)"
          value={{ "vertical@eq": "cleaning" }}
        />
        <ToggleFilterButton
          className="w-full justify-between"
          label="Expansion bank"
          value={{ "vertical@eq": "expansion" }}
        />
      </FilterCategory>

      <FilterCategory
        icon={<Building className="h-4 w-4" />}
        label="resources.companies.fields.size"
      >
        {translatedSizes.map((size) => (
          <ToggleFilterButton
            className="w-full justify-between"
            label={size.name}
            key={size.name}
            value={{ size: size.id }}
          />
        ))}
      </FilterCategory>

      <FilterCategory
        icon={<Truck className="h-4 w-4" />}
        label="resources.companies.fields.sector"
      >
        {companySectors.map((sector) => (
          <ToggleFilterButton
            className="w-full justify-between"
            label={sector.label}
            key={sector.value}
            value={{ sector: sector.value }}
          />
        ))}
      </FilterCategory>

      <FilterCategory
        icon={<Users className="h-4 w-4" />}
        label="resources.companies.fields.sales_id"
      >
        <ToggleFilterButton
          className="w-full justify-between"
          label={translate("crm.common.me")}
          value={{ sales_id: identity?.id }}
        />
      </FilterCategory>
    </div>
  );
};
