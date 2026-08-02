-- Sprint 2: Social Intelligence Hub foundation.
-- This migration creates storage and authorization only. It does not activate
-- external providers, create webhooks, or store credentials.

create table public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  location_id uuid,
  provider text not null,
  external_account_id text not null,
  display_name text not null,
  account_type text,
  connection_status text not null default 'not_configured',
  granted_scopes text[] not null default '{}',
  credential_secret_name text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (id, workspace_id, business_id),
  unique (workspace_id, provider, external_account_id),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  check (provider in ('google_business', 'meta', 'tiktok', 'brevo')),
  check (connection_status in ('not_configured', 'pending', 'connected', 'degraded', 'revoked')),
  check (location_id is null or business_id is not null),
  check (credential_secret_name is null or credential_secret_name ~ '^[a-zA-Z0-9_./-]+$')
);

create table public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  account_id uuid not null,
  job_type text not null,
  status text not null default 'queued',
  idempotency_key text not null,
  cursor_value text,
  attempt_count integer not null default 0,
  records_processed integer not null default 0,
  error_code text,
  error_message text,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, account_id, idempotency_key),
  foreign key (account_id, workspace_id)
    references public.integration_accounts(id, workspace_id) on delete cascade,
  foreign key (account_id, workspace_id, business_id)
    references public.integration_accounts(id, workspace_id, business_id) on delete cascade,
  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  check (attempt_count >= 0 and records_processed >= 0)
);

create table public.social_content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  location_id uuid,
  account_id uuid not null,
  external_id text,
  content_type text not null,
  direction text not null default 'inbound',
  status text not null default 'imported',
  body text,
  media jsonb not null default '[]'::jsonb,
  permalink text,
  scheduled_for timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, workspace_id)
    references public.integration_accounts(id, workspace_id) on delete cascade,
  foreign key (account_id, workspace_id, business_id)
    references public.integration_accounts(id, workspace_id, business_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  check (location_id is null or business_id is not null),
  check (content_type in ('post', 'reel', 'story', 'video', 'comment', 'campaign', 'email')),
  check (direction in ('inbound', 'outbound')),
  check (status in ('draft', 'scheduled', 'publishing', 'published', 'imported', 'failed', 'deleted')),
  check (status <> 'scheduled' or scheduled_for is not null),
  check (status not in ('scheduled', 'publishing', 'published')
    or (approved_by is not null and approved_at is not null)),
  check (status not in ('published', 'imported') or external_id is not null),
  check (jsonb_typeof(media) = 'array')
);

create table public.social_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  location_id uuid,
  account_id uuid not null,
  external_id text not null,
  channel text not null,
  participant_external_id text,
  participant_display_name text,
  status text not null default 'open',
  assigned_to uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, account_id, external_id),
  unique (id, workspace_id),
  unique (id, workspace_id, business_id),
  foreign key (account_id, workspace_id)
    references public.integration_accounts(id, workspace_id) on delete cascade,
  foreign key (account_id, workspace_id, business_id)
    references public.integration_accounts(id, workspace_id, business_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  check (location_id is null or business_id is not null),
  check (channel in ('comment', 'direct_message', 'email')),
  check (status in ('open', 'pending', 'resolved', 'archived'))
);

create table public.social_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  conversation_id uuid not null,
  external_id text,
  direction text not null,
  sender_type text not null,
  body text,
  media jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, conversation_id, external_id),
  foreign key (conversation_id, workspace_id)
    references public.social_conversations(id, workspace_id) on delete cascade,
  foreign key (conversation_id, workspace_id, business_id)
    references public.social_conversations(id, workspace_id, business_id) on delete cascade,
  check (direction in ('inbound', 'outbound')),
  check (sender_type in ('customer', 'staff', 'automation', 'provider')),
  check (jsonb_typeof(media) = 'array')
);

alter table public.reviews
  add constraint reviews_id_workspace_unique unique (id, workspace_id),
  add constraint reviews_id_workspace_business_unique unique (id, workspace_id, business_id);

create table public.review_response_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  review_id uuid not null references public.reviews(id) on delete cascade,
  body text not null,
  status text not null default 'draft',
  generated_by text not null default 'human',
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  provider_response_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, business_id),
  foreign key (review_id, workspace_id)
    references public.reviews(id, workspace_id) on delete cascade,
  foreign key (review_id, workspace_id, business_id)
    references public.reviews(id, workspace_id, business_id) on delete cascade,
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  check (status in ('draft', 'approved', 'publishing', 'published', 'rejected', 'failed')),
  check (generated_by in ('human', 'ai_assisted')),
  check (
    status in ('draft', 'rejected')
    or (approved_by is not null and approved_at is not null)
  )
);

create table public.integration_event_receipts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  account_id uuid not null,
  provider_event_id text not null,
  event_type text not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error_code text,
  unique (workspace_id, account_id, provider_event_id),
  foreign key (account_id, workspace_id)
    references public.integration_accounts(id, workspace_id) on delete cascade,
  foreign key (account_id, workspace_id, business_id)
    references public.integration_accounts(id, workspace_id, business_id) on delete cascade,
  check (payload_sha256 ~ '^[a-f0-9]{64}$')
);

create index integration_accounts_scope_idx
  on public.integration_accounts(workspace_id, business_id, location_id, provider);
create index integration_sync_jobs_queue_idx
  on public.integration_sync_jobs(status, scheduled_at) where status = 'queued';
create index social_content_scope_published_idx
  on public.social_content_items(workspace_id, business_id, published_at desc);
create unique index social_content_provider_object_unique
  on public.social_content_items(workspace_id, account_id, external_id)
  where external_id is not null;
create index social_content_schedule_idx
  on public.social_content_items(status, scheduled_for)
  where status = 'scheduled';
create index social_conversations_queue_idx
  on public.social_conversations(workspace_id, business_id, status, last_message_at desc);
create index social_messages_conversation_idx
  on public.social_messages(conversation_id, sent_at);
create index review_response_drafts_review_idx
  on public.review_response_drafts(review_id, created_at desc);
create index integration_event_receipts_pending_idx
  on public.integration_event_receipts(account_id, received_at) where processed_at is null;

insert into public.integrations (workspace_id, provider, purpose, status, notes)
select w.id, seed.provider, seed.purpose, 'not_started',
  'Configuratie uitgeschakeld totdat OAuth, scopes, webhookverificatie en secretopslag zijn goedgekeurd.'
from public.workspaces w
cross join (values
  ('google_business', 'Reviews, locaties en bedrijfsprofiel'),
  ('meta', 'Facebook- en Instagram-content, reacties en berichten'),
  ('tiktok', 'Video-content, reacties en statistieken'),
  ('brevo', 'Nieuwsbrieven, contacten en campagneprestaties')
) as seed(provider, purpose)
on conflict (workspace_id, provider) do nothing;

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, permission
from public.roles r
cross join lateral unnest(case r.role_key
  when 'owner' then array[
    'integrations:read', 'integrations:manage',
    'social:read', 'social:manage', 'social:publish',
    'reviews:read', 'reviews:respond'
  ]
  when 'manager' then array[
    'integrations:read', 'social:read', 'reviews:read', 'reviews:respond'
  ]
  when 'marketing' then array[
    'integrations:read', 'social:read', 'social:manage', 'social:publish',
    'reviews:read', 'reviews:respond'
  ]
  when 'viewer' then array['social:read', 'reviews:read']
  else array[]::text[]
end) permission
where r.is_system
on conflict (role_id, permission) do nothing;

alter table public.integration_accounts enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.social_content_items enable row level security;
alter table public.social_conversations enable row level security;
alter table public.social_messages enable row level security;
alter table public.review_response_drafts enable row level security;
alter table public.integration_event_receipts enable row level security;

create policy integration_accounts_read on public.integration_accounts for select to authenticated
  using (private.has_permission(workspace_id, 'integrations:read', business_id, location_id));
create policy integration_accounts_manage on public.integration_accounts for all to authenticated
  using (private.has_permission(workspace_id, 'integrations:manage', business_id, location_id))
  with check (private.has_permission(workspace_id, 'integrations:manage', business_id, location_id));

create policy integration_sync_jobs_read on public.integration_sync_jobs for select to authenticated
  using (private.has_permission(workspace_id, 'integrations:read', business_id, null));
create policy integration_sync_jobs_manage on public.integration_sync_jobs for all to authenticated
  using (private.has_permission(workspace_id, 'integrations:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'integrations:manage', business_id, null));

create policy social_content_read on public.social_content_items for select to authenticated
  using (private.has_permission(workspace_id, 'social:read', business_id, location_id));
create policy social_content_manage on public.social_content_items for all to authenticated
  using (private.has_permission(workspace_id, 'social:manage', business_id, location_id))
  with check (private.has_permission(workspace_id, 'social:manage', business_id, location_id));

create policy social_conversations_read on public.social_conversations for select to authenticated
  using (private.has_permission(workspace_id, 'social:read', business_id, location_id));
create policy social_conversations_manage on public.social_conversations for all to authenticated
  using (private.has_permission(workspace_id, 'social:manage', business_id, location_id))
  with check (private.has_permission(workspace_id, 'social:manage', business_id, location_id));

create policy social_messages_read on public.social_messages for select to authenticated
  using (private.has_permission(workspace_id, 'social:read', business_id, null));
create policy social_messages_manage on public.social_messages for all to authenticated
  using (private.has_permission(workspace_id, 'social:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'social:manage', business_id, null));

create policy review_response_drafts_read on public.review_response_drafts for select to authenticated
  using (private.has_permission(workspace_id, 'reviews:read', business_id, null));
create policy review_response_drafts_manage on public.review_response_drafts for all to authenticated
  using (private.has_permission(workspace_id, 'reviews:respond', business_id, null))
  with check (private.has_permission(workspace_id, 'reviews:respond', business_id, null));

create policy integration_event_receipts_read on public.integration_event_receipts for select to authenticated
  using (private.has_permission(workspace_id, 'integrations:read', business_id, null));
create policy integration_event_receipts_manage on public.integration_event_receipts for all to authenticated
  using (private.has_permission(workspace_id, 'integrations:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'integrations:manage', business_id, null));

revoke all on public.integration_accounts, public.integration_sync_jobs,
  public.social_content_items, public.social_conversations, public.social_messages,
  public.review_response_drafts, public.integration_event_receipts from anon;
grant select, insert, update, delete on public.integration_accounts,
  public.integration_sync_jobs, public.social_content_items, public.social_conversations,
  public.social_messages, public.review_response_drafts to authenticated;
grant select on public.integration_event_receipts to authenticated;

create or replace function private.enforce_social_content_approval()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status in ('scheduled', 'publishing', 'published')
     and (tg_op = 'INSERT' or old.status not in ('scheduled', 'publishing', 'published')) then
    if auth.uid() is null or not private.has_permission(
      new.workspace_id, 'social:publish', new.business_id, new.location_id
    ) then
      raise exception 'social content publication requires social:publish permission';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif tg_op = 'UPDATE'
     and old.status in ('scheduled', 'publishing', 'published')
     and (new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at) then
    raise exception 'social content approval metadata is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_social_content_approval() from public;

create or replace function private.enforce_review_response_approval()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status in ('approved', 'publishing', 'published')
     and (tg_op = 'INSERT' or old.status not in ('approved', 'publishing', 'published')) then
    if auth.uid() is null or not private.has_permission(
      new.workspace_id, 'reviews:respond', new.business_id, null
    ) then
      raise exception 'review response approval requires an authenticated reviewer';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif tg_op = 'UPDATE'
     and old.status in ('approved', 'publishing', 'published')
     and (new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at) then
    raise exception 'review response approval metadata is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_review_response_approval() from public;

create trigger set_updated_at_integration_accounts before update on public.integration_accounts
  for each row execute function public.set_updated_at();
create trigger set_updated_at_social_content_items before update on public.social_content_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at_social_conversations before update on public.social_conversations
  for each row execute function public.set_updated_at();
create trigger set_updated_at_review_response_drafts before update on public.review_response_drafts
  for each row execute function public.set_updated_at();
create trigger enforce_social_content_approval before insert or update on public.social_content_items
  for each row execute function private.enforce_social_content_approval();
create trigger enforce_review_response_approval before insert or update on public.review_response_drafts
  for each row execute function private.enforce_review_response_approval();

create trigger audit_integration_accounts after insert or update or delete on public.integration_accounts
  for each row execute function private.audit_row_change();
create trigger audit_integration_sync_jobs after insert or update or delete on public.integration_sync_jobs
  for each row execute function private.audit_row_change();
create trigger audit_social_content_items after insert or update or delete on public.social_content_items
  for each row execute function private.audit_row_change();
create trigger audit_social_conversations after insert or update or delete on public.social_conversations
  for each row execute function private.audit_row_change();
create trigger audit_social_messages after insert or update or delete on public.social_messages
  for each row execute function private.audit_row_change();
create trigger audit_review_response_drafts after insert or update or delete on public.review_response_drafts
  for each row execute function private.audit_row_change();
create trigger audit_integration_event_receipts after insert or update or delete on public.integration_event_receipts
  for each row execute function private.audit_row_change();

comment on column public.integration_accounts.credential_secret_name is
  'Reference to a server-side secret. Never store OAuth tokens or API keys in this table.';
comment on table public.integration_event_receipts is
  'Idempotency ledger. Raw webhook payloads are intentionally not retained.';
comment on table public.review_response_drafts is
  'Review replies require explicit human approval before publishing.';
