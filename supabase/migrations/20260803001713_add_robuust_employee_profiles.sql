create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid null references public.profiles(id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  employee_number text,
  phone text,
  employment_start date,
  employment_end date,
  address text,
  postal_code text,
  city text,
  birthplace text,
  competencies text[] not null default '{}',
  robuust_roles text[] not null default '{}',
  functions text[] not null default '{}',
  wage_type text check (wage_type is null or wage_type in ('hourly','monthly')),
  ranking integer not null default 10 check (ranking >= -1),
  active boolean not null default true,
  external_provider text not null default 'robuust',
  external_employee_id text,
  external_updated_at timestamptz,
  sync_status text not null default 'not_linked' check (sync_status in ('not_linked','pending','synced','error')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_profiles_employment_dates check (employment_end is null or employment_start is null or employment_end >= employment_start)
);
create unique index if not exists employee_profiles_workspace_user_uq on public.employee_profiles(workspace_id,user_id) where user_id is not null;
create unique index if not exists employee_profiles_external_uq on public.employee_profiles(workspace_id,external_provider,external_employee_id) where external_employee_id is not null;
create index if not exists employee_profiles_workspace_idx on public.employee_profiles(workspace_id);
create index if not exists employee_profiles_employee_number_idx on public.employee_profiles(workspace_id,employee_number);
alter table public.employee_profiles enable row level security;
revoke all on public.employee_profiles from anon, authenticated;
grant all on public.employee_profiles to service_role;

create table if not exists private.employee_sensitive_data (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  birth_date_encrypted bytea,
  bsn_encrypted bytea,
  iban_encrypted bytea,
  pin_encrypted bytea,
  wage_amount_encrypted bytea,
  updated_at timestamptz not null default now()
);
revoke all on private.employee_sensitive_data from public, anon, authenticated;
grant all on private.employee_sensitive_data to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name='horeca_os_employee_field_key') then
    perform vault.create_secret(encode(gen_random_bytes(32),'base64'),'horeca_os_employee_field_key','Encrypts sensitive employee fields');
  end if;
end $$;

create or replace function private.employee_field_key() returns text language sql security definer set search_path='' as $$
  select decrypted_secret from vault.decrypted_secrets where name='horeca_os_employee_field_key' limit 1
$$;
revoke all on function private.employee_field_key() from public,anon,authenticated;
grant execute on function private.employee_field_key() to service_role;

create or replace function private.encrypt_employee_value(value text) returns bytea language sql security definer set search_path='' as $$
  select case when nullif(value,'') is null then null else extensions.pgp_sym_encrypt(value,private.employee_field_key(),'cipher-algo=aes256, compress-algo=1') end
$$;
create or replace function private.decrypt_employee_value(value bytea) returns text language sql security definer set search_path='' as $$
  select case when value is null then null else extensions.pgp_sym_decrypt(value,private.employee_field_key()) end
$$;
revoke all on function private.encrypt_employee_value(text) from public,anon,authenticated;
revoke all on function private.decrypt_employee_value(bytea) from public,anon,authenticated;
grant execute on function private.encrypt_employee_value(text) to service_role;
grant execute on function private.decrypt_employee_value(bytea) to service_role;

create or replace function public.get_employee_sensitive(p_employee_id uuid)
returns table(birth_date date,bsn text,iban text,pin_code text,wage_amount numeric)
language sql security definer set search_path='' as $$
  select nullif(private.decrypt_employee_value(s.birth_date_encrypted),'')::date,
    private.decrypt_employee_value(s.bsn_encrypted),private.decrypt_employee_value(s.iban_encrypted),
    private.decrypt_employee_value(s.pin_encrypted),nullif(private.decrypt_employee_value(s.wage_amount_encrypted),'')::numeric
  from private.employee_sensitive_data s where s.employee_id=p_employee_id
$$;
revoke all on function public.get_employee_sensitive(uuid) from public,anon,authenticated;
grant execute on function public.get_employee_sensitive(uuid) to service_role;

create or replace function public.upsert_employee_sensitive(p_employee_id uuid,p_birth_date date default null,p_bsn text default null,p_iban text default null,p_pin_code text default null,p_wage_amount numeric default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.employee_sensitive_data(employee_id,birth_date_encrypted,bsn_encrypted,iban_encrypted,pin_encrypted,wage_amount_encrypted,updated_at)
  values(p_employee_id,private.encrypt_employee_value(p_birth_date::text),private.encrypt_employee_value(nullif(trim(p_bsn),'')),
    private.encrypt_employee_value(nullif(upper(replace(p_iban,' ','')) ,'')),private.encrypt_employee_value(nullif(trim(p_pin_code),'')),
    private.encrypt_employee_value(p_wage_amount::text),now())
  on conflict(employee_id) do update set birth_date_encrypted=excluded.birth_date_encrypted,bsn_encrypted=excluded.bsn_encrypted,
    iban_encrypted=excluded.iban_encrypted,pin_encrypted=excluded.pin_encrypted,wage_amount_encrypted=excluded.wage_amount_encrypted,updated_at=now();
end
$$;
revoke all on function public.upsert_employee_sensitive(uuid,date,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.upsert_employee_sensitive(uuid,date,text,text,text,numeric) to service_role;

create table if not exists public.employee_profile_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check(action in ('created','updated')),
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.employee_profile_audit enable row level security;
revoke all on public.employee_profile_audit from anon,authenticated;
grant all on public.employee_profile_audit to service_role;
create index if not exists employee_profile_audit_employee_idx on public.employee_profile_audit(employee_id,created_at desc);

comment on table public.employee_profiles is 'Employee master data prepared for Robuust POS synchronization; application authorization remains separate.';
comment on table private.employee_sensitive_data is 'Encrypted HR fields. Never expose this table through the Data API.';
comment on column public.employee_profiles.robuust_roles is 'Exact external Robuust role codes; these do not grant Horeca OS permissions.';
comment on column public.employee_profiles.functions is 'Exact Robuust employee function codes.';
