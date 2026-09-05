alter table public.staff_tickets
  add column if not exists reporter_user_id uuid references auth.users(id);

create index if not exists staff_tickets_reporter_user_id_idx
  on public.staff_tickets(reporter_user_id);

create or replace function public.submit_staff_ticket(
  p_token text, p_category text, p_priority text, p_title text,
  p_description text, p_location text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.staff_ticket_links%rowtype;
  v_ticket_number bigint;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Inloggen is vereist om een melding te doen.';
  end if;

  select * into v_link
  from public.staff_ticket_links
  where token = trim(p_token) and active = true
  limit 1;

  if not found then
    raise exception 'Deze medewerkerslink is niet actief.';
  end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = v_link.workspace_id and wm.user_id = v_user_id
  ) then
    raise exception 'Je account heeft geen toegang tot deze medewerkerslink.';
  end if;

  insert into public.staff_tickets (
    workspace_id, link_id, reporter_user_id, category, priority,
    title, description, location, reporter_name, reporter_contact
  )
  values (
    v_link.workspace_id, v_link.id, v_user_id, trim(p_category),
    trim(p_priority), trim(p_title), trim(p_description),
    nullif(trim(p_location), ''),
    coalesce(nullif(trim((select p.full_name from public.profiles p where p.id = v_user_id)), ''), 'Medewerker'),
    null
  )
  returning ticket_number into v_ticket_number;

  return v_ticket_number;
end;
$$;

revoke all on function public.submit_staff_ticket(text,text,text,text,text,text,text,text) from public;
revoke all on function public.submit_staff_ticket(text,text,text,text,text,text) from public;
grant execute on function public.submit_staff_ticket(text,text,text,text,text,text) to authenticated;

create or replace function public.lookup_staff_ticket(p_token text, p_ticket_number text)
returns table (
  ticket_number text, title text, category text, priority text,
  location text, status text, created_at timestamptz, updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select t.ticket_number::text, t.title, t.category, t.priority,
         t.location, t.status, t.created_at, t.updated_at
  from public.staff_tickets t
  join public.staff_ticket_links l on l.id = t.link_id
  where l.token = trim(p_token)
    and l.active = true
    and t.ticket_number::text = trim(p_ticket_number)
    and t.reporter_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.lookup_staff_ticket(text, text, text) from public;
revoke all on function public.lookup_staff_ticket(text, text) from public;
grant execute on function public.lookup_staff_ticket(text, text) to authenticated;
