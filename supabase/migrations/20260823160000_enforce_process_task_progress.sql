create or replace function public.enforce_process_task_status_progress()
returns trigger
language plpgsql
as $$
declare
  can_manage boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  can_manage := private.has_permission(old.workspace_id, 'processes:manage', old.business_id, null);

  if can_manage then
    return new;
  end if;

  if old.status in ('blocked', 'done') then
    raise exception 'Alleen een manager kan een geblokkeerde of afgeronde taak terugzetten.';
  end if;

  if new.status = 'not_started' then
    raise exception 'Een medewerker kan een taak niet terugzetten naar toegewezen.';
  end if;

  if old.status = 'in_progress' and new.status not in ('blocked', 'done') then
    raise exception 'Een taak kan alleen van bezig naar geblokkeerd of gereed.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_process_task_status_progress on public.process_run_tasks;
create trigger enforce_process_task_status_progress
before update of status on public.process_run_tasks
for each row execute function public.enforce_process_task_status_progress();
