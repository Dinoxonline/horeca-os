-- Allow the existing Predis connector to persist a verified brand.
-- Preserve every currently supported provider and all existing access policies.
begin;
set local lock_timeout = '5s';
alter table public.integration_accounts
  drop constraint integration_accounts_provider_check;
alter table public.integration_accounts
  add constraint integration_accounts_provider_check
  check (provider = any (array[
    'google_business', 'meta', 'facebook', 'facebook_ads', 'whatsapp',
    'tiktok', 'brevo', 'robuust', 'predis'
  ]));
commit;
