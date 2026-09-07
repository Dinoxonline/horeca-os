-- Supplier support tickets use the existing ticket queue and conversation model.
alter table public.staff_tickets
  add column if not exists ticket_kind text not null default 'staff'
    check (ticket_kind in ('staff', 'supplier', 'internal', 'customer')),
  add column if not exists supplier_id uuid,
  add column if not exists supplier_email text,
  add column if not exists outbound_sent_at timestamptz,
  add column if not exists last_external_message_at timestamptz;

alter table public.staff_tickets
  add constraint staff_tickets_supplier_scope_fkey
  foreign key (supplier_id, workspace_id)
  references public.suppliers(id, workspace_id)
  on delete set null;

alter table public.suppliers
  add column if not exists support_email text,
  add column if not exists support_phone text,
  add column if not exists support_notes text;

create index if not exists staff_tickets_supplier_queue_idx
  on public.staff_tickets(workspace_id, ticket_kind, supplier_id, status, created_at desc);

-- Supplier tickets need two additional lifecycle states.
alter table public.staff_tickets drop constraint if exists staff_tickets_status_check;
alter table public.staff_tickets add constraint staff_tickets_status_check
  check (status in ('nieuw', 'verzonden', 'wacht op leverancier', 'in behandeling', 'opgelost', 'gesloten'));
