-- Workspace members need a minimal directory so managers can assign work.
-- The application only selects id and full_name from this table.
create policy "profiles_workspace_member_directory"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members member
      where member.user_id = profiles.id
        and private.is_workspace_member(member.workspace_id)
    )
  );
