-- Additive first release: private guest CRM and concept quotes only.
-- No mail, calendar creation, publication or changes to existing marketing tables.
create function private.quote_owner(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal') = 'aal2', false) and exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = (select auth.uid()) and role::text = 'owner'
  );
$$;
revoke all on function private.quote_owner(uuid) from public;
grant execute on function private.quote_owner(uuid) to authenticated;

create table public.crm_guests (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  name text not null check (char_length(trim(name)) between 1 and 160),
  company text not null default '' check (char_length(company) <= 160),
  email text not null default '' check (char_length(email) <= 254),
  phone text not null default '' check (char_length(phone) <= 60),
  address text not null default '' check (char_length(address) <= 300),
  notes text not null default '' check (char_length(notes) <= 2000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index crm_guests_workspace_updated on public.crm_guests(workspace_id, updated_at desc, id);

create table public.quote_drafts (
  id uuid primary key,
  quote_number bigint generated always as identity unique,
  workspace_id uuid not null references public.workspaces(id),
  business_id uuid not null,
  guest_id uuid not null,
  guest_snapshot jsonb not null check (jsonb_typeof(guest_snapshot) = 'object' and octet_length(guest_snapshot::text) <= 5000),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 100000),
  status text not null default 'draft' check (status = 'draft'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id),
  foreign key (guest_id, workspace_id) references public.crm_guests(id, workspace_id),
  unique (id, workspace_id)
);
create index quote_drafts_workspace_updated on public.quote_drafts(workspace_id, updated_at desc, id);
create index quote_drafts_business on public.quote_drafts(business_id, workspace_id);
create index quote_drafts_guest on public.quote_drafts(guest_id, workspace_id);

create table public.quote_versions (
  workspace_id uuid not null,
  quote_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid,
  primary key (quote_id, version),
  foreign key (quote_id, workspace_id) references public.quote_drafts(id, workspace_id)
);
create index quote_versions_workspace on public.quote_versions(workspace_id, quote_id, version desc);

create function private.quote_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.created_at is distinct from old.created_at then
    raise exception 'Identity and workspace cannot change';
  end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.quote_revision() from public;
create trigger crm_guests_revision before update on public.crm_guests for each row execute function private.quote_revision();
create trigger quote_drafts_revision before update on public.quote_drafts for each row execute function private.quote_revision();

-- Append-only revisions are written atomically with the quote, not by a browser.
create function private.record_quote_version() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.quote_versions(workspace_id, quote_id, version, snapshot, saved_by)
  values (new.workspace_id, new.id, new.version, to_jsonb(new), auth.uid());
  return new;
end;
$$;
revoke all on function private.record_quote_version() from public;
create trigger record_quote_version after insert or update on public.quote_drafts for each row execute function private.record_quote_version();

alter table public.crm_guests enable row level security;
alter table public.quote_drafts enable row level security;
alter table public.quote_versions enable row level security;
create policy crm_guests_read on public.crm_guests for select to authenticated using (private.quote_owner(workspace_id));
create policy crm_guests_add on public.crm_guests for insert to authenticated with check (private.quote_owner(workspace_id) and version = 1);
create policy crm_guests_edit on public.crm_guests for update to authenticated using (private.quote_owner(workspace_id)) with check (private.quote_owner(workspace_id));
create policy quote_drafts_read on public.quote_drafts for select to authenticated using (private.quote_owner(workspace_id));
create policy quote_drafts_add on public.quote_drafts for insert to authenticated with check (private.quote_owner(workspace_id) and version = 1);
create policy quote_drafts_edit on public.quote_drafts for update to authenticated using (private.quote_owner(workspace_id)) with check (private.quote_owner(workspace_id));
create policy quote_versions_read on public.quote_versions for select to authenticated using (private.quote_owner(workspace_id));
revoke all on public.crm_guests, public.quote_drafts, public.quote_versions from public, anon, authenticated;
grant select on public.crm_guests, public.quote_drafts, public.quote_versions to authenticated;
grant insert (id, workspace_id, name, company, email, phone, address, notes) on public.crm_guests to authenticated;
grant update (name, company, email, phone, address, notes) on public.crm_guests to authenticated;
grant insert (id, workspace_id, business_id, guest_id, guest_snapshot, content) on public.quote_drafts to authenticated;
grant update (business_id, guest_id, guest_snapshot, content) on public.quote_drafts to authenticated;
