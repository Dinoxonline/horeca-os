create table public.backup_content_checks (
 run_id text primary key references public.backup_database_runs(run_id),
 compared_to text references public.backup_database_runs(run_id),
 checked_at timestamptz not null,
 table_count integer not null check(table_count >= 0),
 changes jsonb not null check(jsonb_typeof(changes) = 'array'),
 schema_compared boolean not null default false check(not schema_compared)
);
create table public.backup_restore_checks (
 id uuid primary key default gen_random_uuid(),
 run_id text not null references public.backup_database_runs(run_id),
 checked_at timestamptz not null,
 archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
 archive_restored boolean not null,
 local_server_stopped boolean not null,
 production_touched boolean not null check(not production_touched),
 category text not null check(category in ('MANAGED_SCHEMA_MISSING','REQUIRED_ROLE_MISSING','REQUIRED_EXTENSION_MISSING','LOCAL_RESTORE_FAILED','EXISTING_OBJECT_CONFLICT','APPLICATION_ARCHIVE_RESTORED')),
 unique(run_id,checked_at)
);
alter table public.backup_content_checks enable row level security;
alter table public.backup_restore_checks enable row level security;
revoke all on public.backup_content_checks,public.backup_restore_checks from public,anon,authenticated;
grant select,insert on public.backup_content_checks,public.backup_restore_checks to service_role;
grant select on public.backup_content_checks,public.backup_restore_checks to horeca_backup_reader;
