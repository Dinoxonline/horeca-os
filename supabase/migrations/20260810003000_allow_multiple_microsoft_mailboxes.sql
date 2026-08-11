alter table public.calendar_connections
  drop constraint if exists calendar_connections_workspace_id_user_id_provider_key,
  drop constraint if exists calendar_connections_workspace_id_provider_external_user_id_key;

alter table public.calendar_connections
  add constraint calendar_connections_workspace_user_provider_email_key
  unique (workspace_id, user_id, provider, email);
