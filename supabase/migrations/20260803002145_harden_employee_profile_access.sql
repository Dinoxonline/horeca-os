create policy employee_profiles_no_direct_access on public.employee_profiles
  for all to authenticated using (false) with check (false);
create policy employee_profile_audit_no_direct_access on public.employee_profile_audit
  for all to authenticated using (false) with check (false);

create index if not exists employee_profiles_user_idx on public.employee_profiles(user_id);
create index if not exists employee_profiles_created_by_idx on public.employee_profiles(created_by);
create index if not exists employee_profiles_updated_by_idx on public.employee_profiles(updated_by);
create index if not exists employee_profile_audit_workspace_idx on public.employee_profile_audit(workspace_id);
create index if not exists employee_profile_audit_actor_idx on public.employee_profile_audit(actor_id);
