alter table public.integration_accounts drop constraint if exists integration_accounts_provider_check;

alter table public.integration_accounts add constraint integration_accounts_provider_check
check (provider = any (array[
  'google_business', 'meta', 'facebook', 'facebook_ads', 'whatsapp', 'tiktok', 'brevo', 'robuust'
]));

create unique index if not exists integration_accounts_facebook_ads_business_unique
  on public.integration_accounts(workspace_id, business_id, provider)
  where provider = 'facebook_ads' and business_id is not null;
