-- An advertising account can fund campaigns for multiple venues. Keep a
-- separate integration row and encrypted credential for each venue; do not
-- share page identities, tokens, content ownership, or permissions.
-- All other providers retain their existing workspace-wide uniqueness.
set local lock_timeout = '5s';

create unique index integration_accounts_nonshared_external_unique
  on public.integration_accounts(workspace_id, provider, external_account_id)
  where provider <> 'facebook_ads' or business_id is null;

alter table public.integration_accounts
  drop constraint integration_accounts_workspace_id_provider_external_account_key;

-- The existing integration_accounts_facebook_ads_business_unique index
-- continues to allow only one advertising connection per venue.
-- Composite id/workspace/business foreign keys and RLS are unchanged.
