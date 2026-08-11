alter table public.integration_accounts
  drop constraint if exists integration_accounts_provider_check;

alter table public.integration_accounts
  add constraint integration_accounts_provider_check
  check (provider = any (array[
    'google_business'::text,
    'meta'::text,
    'facebook'::text,
    'tiktok'::text,
    'brevo'::text,
    'robuust'::text
  ]));

