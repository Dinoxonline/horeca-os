-- Only sanitized runner receipts; never connection strings, filenames or credentials.
create table public.backup_database_runs (
  run_id text primary key check (run_id ~ '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$'),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  ok boolean not null,
  copy_verified boolean not null,
  bytes bigint not null check (bytes >= 0),
  reported_at timestamptz not null default now(),
  check (completed_at >= started_at),
  check (not ok or (copy_verified and bytes > 0))
);
alter table public.backup_database_runs enable row level security;
revoke all on public.backup_database_runs from public, anon, authenticated;
grant select, insert on public.backup_database_runs to service_role;
grant select on public.backup_database_runs to horeca_backup_reader;

create function public.backup_overview_status() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'checkedAt', now(),
    'database', jsonb_build_object(
      'latest', (select to_jsonb(r) from public.backup_database_runs r order by started_at desc limit 1),
      'lastSuccess', (select to_jsonb(r) from public.backup_database_runs r where ok order by completed_at desc limit 1),
      'recent', coalesce((select jsonb_agg(t order by started_at desc) from (select * from public.backup_database_runs order by started_at desc limit 10)t), '[]'::jsonb)
    ),
    'files', jsonb_build_object(
      'enabled', (select enabled from public.backup_file_settings where id),
      'wakeError', coalesce((select last_wake_error is not null from public.backup_file_settings where id), false),
      'succeeded', (select count(*) from public.backup_file_jobs where status = 'succeeded'),
      'pending', (select count(*) from public.backup_file_jobs where status = 'pending'),
      'processing', (select count(*) from public.backup_file_jobs where status = 'processing'),
      'failed', (select count(*) from public.backup_file_jobs where status = 'failed'),
      'overdue', (select count(*) from public.backup_file_jobs where (status = 'pending' and created_at < now() - interval '15 minutes') or (status = 'processing' and lease_until < now())),
      'lastSuccessAt', (select max(completed_at) from public.backup_file_jobs where status = 'succeeded')
    )
  );
$$;
revoke all on function public.backup_overview_status() from public, anon, authenticated;
grant execute on function public.backup_overview_status() to service_role;
