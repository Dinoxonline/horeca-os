alter table public.integration_accounts drop constraint if exists integration_accounts_provider_check;
alter table public.integration_accounts add constraint integration_accounts_provider_check
  check (provider in ('google_business','meta','tiktok','brevo','robuust'));

create or replace function public.configure_robuust_account(p_workspace_id uuid,p_business_id uuid,p_pid text,p_api_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_account_id uuid; v_secret_name text; v_secret_id uuid;
begin
  if nullif(trim(p_pid),'') is null or nullif(trim(p_api_key),'') is null then raise exception 'PID and API key are required'; end if;
  select id into v_account_id from public.integration_accounts
  where workspace_id=p_workspace_id and business_id=p_business_id and provider='robuust' order by created_at limit 1;
  if v_account_id is null then
    insert into public.integration_accounts(workspace_id,business_id,provider,external_account_id,display_name,account_type,connection_status,granted_scopes)
    values(p_workspace_id,p_business_id,'robuust',trim(p_pid),'Robuust','pos','pending',array['partner_company:read','reservations:availability'])
    returning id into v_account_id;
  else
    update public.integration_accounts set external_account_id=trim(p_pid),connection_status='pending',
      last_error_code=null,last_error_at=null,updated_at=now() where id=v_account_id;
  end if;
  v_secret_name:='robuust_api_key_'||replace(v_account_id::text,'-','_');
  select id into v_secret_id from vault.secrets where name=v_secret_name limit 1;
  if v_secret_id is null then
    perform vault.create_secret(trim(p_api_key),v_secret_name,'Robuust API key for integration account '||v_account_id::text);
  else
    perform vault.update_secret(v_secret_id,trim(p_api_key),v_secret_name,'Robuust API key for integration account '||v_account_id::text);
  end if;
  update public.integration_accounts set credential_secret_name=v_secret_name,updated_at=now() where id=v_account_id;
  return v_account_id;
end $$;
revoke all on function public.configure_robuust_account(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.configure_robuust_account(uuid,uuid,text,text) to service_role;

create or replace function public.get_robuust_account_secret(p_account_id uuid)
returns table(account_id uuid,workspace_id uuid,business_id uuid,pid text,api_key text)
language sql security definer set search_path='' as $$
  select a.id,a.workspace_id,a.business_id,a.external_account_id,s.decrypted_secret
  from public.integration_accounts a join vault.decrypted_secrets s on s.name=a.credential_secret_name
  where a.id=p_account_id and a.provider='robuust'
$$;
revoke all on function public.get_robuust_account_secret(uuid) from public,anon,authenticated;
grant execute on function public.get_robuust_account_secret(uuid) to service_role;
comment on function public.configure_robuust_account(uuid,uuid,text,text) is 'Stores Robuust API credentials encrypted in Supabase Vault.';
comment on function public.get_robuust_account_secret(uuid) is 'Service-role-only retrieval for outbound Robuust API calls.';
