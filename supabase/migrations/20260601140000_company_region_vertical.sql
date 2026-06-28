-- Robin Line: region (territory) + vertical on companies, so leads can be
-- worked by region and off-vertical companies routed to the Expansion bank.
alter table public.companies
  add column if not exists territory text,
  add column if not exists vertical text not null default 'cleaning';

-- companies_summary lists columns explicitly, so the new fields must be added
-- here for the list / filters to see them.
create or replace view public.companies_summary with (security_invoker = on) as
select
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    count(distinct d.id) as nb_deals,
    count(distinct co.id) as nb_contacts,
    c.territory,
    c.vertical
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;
