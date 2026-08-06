-- Add auditable manager corrections to employee time registrations.
alter table public.time_entries
  add column break_minutes integer not null default 0 check (break_minutes >= 0),
  add column original_clocked_in_at timestamptz,
  add column original_clocked_out_at timestamptz,
  add column corrected_at timestamptz,
  add column corrected_by uuid references public.profiles(id) on delete set null,
  add column correction_reason text check (char_length(correction_reason) <= 500);

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, 'time:manage' from public.roles r
where r.role_key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

create or replace function private.audit_time_entry_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare actor uuid := (select auth.uid());
begin
  if old.user_id = actor and old.clocked_out_at is null and new.clocked_out_at is not null
     and new.clocked_in_at = old.clocked_in_at and new.break_minutes = old.break_minutes then return new; end if;
  if new.clocked_in_at is distinct from old.clocked_in_at or new.clocked_out_at is distinct from old.clocked_out_at or new.break_minutes is distinct from old.break_minutes then
    if not private.has_permission(old.workspace_id, 'time:manage', old.business_id, null) then raise exception 'Geen toestemming om uren te corrigeren.'; end if;
    if nullif(btrim(new.correction_reason), '') is null then raise exception 'Een reden voor de correctie is verplicht.'; end if;
    new.original_clocked_in_at := coalesce(old.original_clocked_in_at, old.clocked_in_at);
    new.original_clocked_out_at := coalesce(old.original_clocked_out_at, old.clocked_out_at);
    new.corrected_at := now(); new.corrected_by := actor;
  end if;
  return new;
end; $$;

revoke all on function private.audit_time_entry_change() from public;
grant execute on function private.audit_time_entry_change() to authenticated;
create trigger audit_time_entry_change before update on public.time_entries for each row execute function private.audit_time_entry_change();

create policy time_entries_manager_update on public.time_entries for update to authenticated
  using (private.has_permission(workspace_id, 'time:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'time:manage', business_id, null));
grant update (clocked_in_at, clocked_out_at, break_minutes, correction_reason, note) on public.time_entries to authenticated;

comment on column public.time_entries.original_clocked_in_at is 'First recorded start, retained after manager corrections.';
comment on column public.time_entries.correction_reason is 'Required explanation for a manager correction.';

