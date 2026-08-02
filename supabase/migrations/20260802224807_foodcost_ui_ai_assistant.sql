-- Sprint 3B: AI assistant foundation. Additive; no provider secrets are stored.

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  location_id uuid,
  created_by uuid not null references public.profiles(id) on delete cascade,
  use_case text not null default 'operations',
  title text not null default 'Nieuw gesprek',
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, business_id, location_id, created_by),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  check (location_id is null or business_id is not null),
  check (use_case in ('ceo', 'foodcost', 'reviews', 'marketing', 'operations'))
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  workspace_id uuid not null,
  business_id uuid,
  location_id uuid,
  created_by uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  content text not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id, business_id, location_id, created_by)
    references public.ai_conversations(id, workspace_id, business_id, location_id, created_by) on delete cascade,
  check (role in ('user', 'assistant')),
  check (length(content) between 1 and 20000),
  check (input_tokens is null or input_tokens >= 0),
  check (output_tokens is null or output_tokens >= 0)
);

create table public.ai_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  location_id uuid,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid,
  event_type text not null,
  use_case text not null,
  model text,
  status text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  created_at timestamptz not null default now(),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  check (location_id is null or business_id is not null),
  check (event_type in ('assistant.request', 'assistant.response', 'assistant.error')),
  check (status in ('started', 'succeeded', 'failed'))
);

create index ai_conversations_owner_idx on public.ai_conversations(created_by, workspace_id, updated_at desc);
create index ai_messages_conversation_idx on public.ai_messages(conversation_id, created_at);
create index ai_audit_scope_idx on public.ai_audit_events(workspace_id, business_id, location_id, created_at desc);

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, permission
from public.roles r
cross join lateral unnest(case r.role_key
  when 'owner' then array['ai:read', 'ai:use', 'ai:audit']
  when 'manager' then array['ai:read', 'ai:use']
  when 'kitchen_manager' then array['ai:read', 'ai:use']
  when 'marketing' then array['ai:read', 'ai:use']
  when 'accountant' then array['ai:read', 'ai:use']
  else array[]::text[]
end) permission
where r.is_system
on conflict (role_id, permission) do nothing;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_audit_events enable row level security;

create or replace function private.validate_ai_message_scope()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not exists (
    select 1 from public.ai_conversations c
    where c.id = new.conversation_id
      and c.workspace_id = new.workspace_id
      and c.business_id is not distinct from new.business_id
      and c.location_id is not distinct from new.location_id
      and c.created_by = new.created_by
  ) then
    raise exception 'AI message scope does not match its conversation';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_ai_message_scope() from public;

create policy ai_conversations_read on public.ai_conversations for select to authenticated
  using (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:read', business_id, location_id));
create policy ai_conversations_create on public.ai_conversations for insert to authenticated
  with check (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:use', business_id, location_id));
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:use', business_id, location_id))
  with check (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:use', business_id, location_id));
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:use', business_id, location_id));

create policy ai_messages_read on public.ai_messages for select to authenticated
  using (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:read', business_id, location_id));
create policy ai_messages_create on public.ai_messages for insert to authenticated
  with check (created_by = auth.uid() and private.has_permission(workspace_id, 'ai:use', business_id, location_id));

create policy ai_audit_owner_read on public.ai_audit_events for select to authenticated
  using (private.has_permission(workspace_id, 'ai:audit', business_id, location_id));
create policy ai_audit_actor_insert on public.ai_audit_events for insert to authenticated
  with check (actor_id = auth.uid() and private.has_permission(workspace_id, 'ai:use', business_id, location_id));

revoke all on public.ai_conversations, public.ai_messages, public.ai_audit_events from anon;
grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages, public.ai_audit_events to authenticated;

create trigger set_updated_at_ai_conversations before update on public.ai_conversations
  for each row execute function public.set_updated_at();
create trigger validate_ai_message_scope before insert or update on public.ai_messages
  for each row execute function private.validate_ai_message_scope();
create trigger audit_ai_conversations after insert or update or delete on public.ai_conversations
  for each row execute function private.audit_row_change();

comment on table public.ai_conversations is 'User-owned, tenant-scoped assistant threads. The model name is configuration metadata, never a credential.';
comment on table public.ai_messages is 'Tenant-scoped assistant history. Access is limited to the creating user and ai permissions.';
comment on table public.ai_audit_events is 'Content-free AI request audit metadata; prompts, responses and API secrets are deliberately excluded.';

