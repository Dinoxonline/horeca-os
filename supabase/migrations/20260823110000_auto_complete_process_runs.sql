create or replace function public.sync_process_run_status()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  update public.process_runs
  set status = case
    when exists (select 1 from public.process_run_tasks where run_id = new.run_id and status <> 'done') then 'active'
    else 'completed'
  end,
  updated_at = now()
  where id = new.run_id;
  return new;
end;
$$;
drop trigger if exists sync_process_run_status on public.process_run_tasks;
create trigger sync_process_run_status
after insert or update of status on public.process_run_tasks
for each row execute function public.sync_process_run_status();
