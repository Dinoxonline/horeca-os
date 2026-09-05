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
