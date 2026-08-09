create table public.calendar_connections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null default 'microsoft' check (provider='microsoft'),
 external_user_id text not null,
 email text not null check (lower(email) like '%@leclubbbq.nl'),
 display_name text,
 granted_scopes text[] not null default '{}',
 access_token_ciphertext text not null, access_token_iv text not null, access_token_tag text not null,
 refresh_token_ciphertext text, refresh_token_iv text, refresh_token_tag text,
 token_expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,user_id,provider), unique(workspace_id,provider,external_user_id)
);
alter table public.calendar_connections enable row level security;
revoke all on public.calendar_connections from anon,authenticated,public;
grant select,insert,update,delete on public.calendar_connections to service_role;
create trigger set_updated_at_calendar_connections before update on public.calendar_connections for each row execute function public.set_updated_at();
