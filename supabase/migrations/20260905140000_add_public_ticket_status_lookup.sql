create or replace function public.lookup_staff_ticket(
  p_token text,
  p_ticket_number text,
  p_contact text
)
returns table (
  ticket_number text,
  title text,
  category text,
  priority text,
  location text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    t.ticket_number::text,
    t.title,
    t.category,
    t.priority,
    t.location,
    t.status,
    t.created_at,
    t.updated_at
  from public.staff_tickets t
  join public.staff_ticket_links l on l.id = t.link_id
  where l.token = trim(p_token)
    and l.active = true
    and t.ticket_number::text = trim(p_ticket_number)
    and lower(trim(coalesce(t.reporter_contact, ''))) = lower(trim(coalesce(p_contact, '')))
  limit 1;
$$;

revoke all on function public.lookup_staff_ticket(text, text, text) from public;
grant execute on function public.lookup_staff_ticket(text, text, text) to anon, authenticated;


create or replace function public.submit_staff_ticket(
  p_token text,
  p_category text,
  p_priority text,
  p_title text,
  p_description text,
  p_location text,
  p_reporter_name text,
  p_reporter_contact text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.staff_ticket_links%rowtype;
  v_ticket_number bigint;
begin
  select * into v_link
  from public.staff_ticket_links
  where token = trim(p_token) and active = true
  limit 1;

  if not found then
    raise exception 'Deze medewerkerslink is niet actief.';
  end if;

  insert into public.staff_tickets (
    workspace_id, link_id, category, priority, title, description,
    location, reporter_name, reporter_contact
  )
  values (
    v_link.workspace_id, v_link.id, trim(p_category), trim(p_priority),
    trim(p_title), trim(p_description), nullif(trim(p_location), ''),
    trim(p_reporter_name), nullif(trim(p_reporter_contact), '')
  )
  returning ticket_number into v_ticket_number;

  return v_ticket_number;
end;
$$;

revoke all on function public.submit_staff_ticket(text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_staff_ticket(text,text,text,text,text,text,text,text) to anon, authenticated;
