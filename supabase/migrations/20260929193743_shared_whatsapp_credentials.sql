-- Shared WhatsApp uses a workspace-scoped account (business_id NULL).
-- Version matches the applied production migration.
-- Credentials remain service-role only; existing RLS on accounts/messages
-- requires workspace-wide permissions when business_id is NULL.
alter table public.integration_credentials alter column business_id drop not null;
alter table public.integration_credentials
  add constraint integration_credentials_account_workspace_fk
  foreign key (account_id, workspace_id)
  references public.integration_accounts(id, workspace_id) on delete cascade;
create unique index integration_accounts_shared_whatsapp_unique
  on public.integration_accounts(workspace_id)
  where provider = 'whatsapp' and business_id is null;
create unique index integration_accounts_venue_whatsapp_unique
  on public.integration_accounts(workspace_id, business_id)
  where provider = 'whatsapp' and business_id is not null;
-- A webhook phone ID must resolve to exactly one inbox, across workspaces too.
create unique index integration_accounts_whatsapp_phone_unique
  on public.integration_accounts(external_account_id)
  where provider = 'whatsapp';
