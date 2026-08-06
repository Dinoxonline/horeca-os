create table public.integration_credentials (
  account_id uuid primary key references public.integration_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null,
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, workspace_id, business_id)
    references public.integration_accounts(id, workspace_id, business_id) on delete cascade,
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade
);

alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from anon, authenticated, public;
grant select, insert, update, delete on public.integration_credentials to service_role;

create trigger set_updated_at_integration_credentials before update on public.integration_credentials
  for each row execute function public.set_updated_at();

create unique index integration_accounts_meta_business_unique
  on public.integration_accounts(workspace_id, business_id, provider)
  where provider = 'meta' and business_id is not null;

