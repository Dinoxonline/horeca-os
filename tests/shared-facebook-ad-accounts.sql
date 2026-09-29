-- Run on a workspace containing two venue-specific advertising connections.
-- Every test write, including audit records, is rolled back.
begin;
do $$
declare
  first_ad public.integration_accounts%rowtype;
  second_ad public.integration_accounts%rowtype;
  first_page public.integration_accounts%rowtype;
  second_page public.integration_accounts%rowtype;
  violated text;
begin
  select * into strict first_ad from public.integration_accounts
    where provider = 'facebook_ads' and business_id is not null
    order by (connection_status = 'connected') desc, id limit 1;
  select * into strict second_ad from public.integration_accounts
    where provider = 'facebook_ads' and workspace_id = first_ad.workspace_id
      and business_id <> first_ad.business_id order by id limit 1;

  update public.integration_accounts set external_account_id = first_ad.external_account_id
    where id = second_ad.id;
  if (select count(*) from public.integration_accounts where provider = 'facebook_ads'
    and workspace_id = first_ad.workspace_id and external_account_id = first_ad.external_account_id
    and id in (first_ad.id, second_ad.id)) <> 2 then
    raise exception 'Two venues could not share the advertising account';
  end if;

  -- A second advertising connection for the SAME venue is still forbidden.
  begin
    insert into public.integration_accounts(workspace_id,business_id,provider,external_account_id,display_name)
      values (first_ad.workspace_id,first_ad.business_id,'facebook_ads','test-shared-ad-duplicate','Rollback test');
    raise exception 'Duplicate advertising connection for one venue was accepted';
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated <> 'integration_accounts_facebook_ads_business_unique' then raise; end if;
  end;

  select * into strict first_page from public.integration_accounts
    where workspace_id = first_ad.workspace_id and business_id = first_ad.business_id and provider = 'facebook' limit 1;
  select * into strict second_page from public.integration_accounts
    where workspace_id = second_ad.workspace_id and business_id = second_ad.business_id and provider = 'facebook' limit 1;
  -- Sharing an advertising account must not also allow sharing page records.
  begin
    update public.integration_accounts set external_account_id = first_page.external_account_id
      where id = second_page.id;
    raise exception 'Workspace-wide Facebook page uniqueness was lost';
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated <> 'integration_accounts_nonshared_external_unique' then raise; end if;
  end;

  if first_page.external_account_id = second_page.external_account_id then
    raise exception 'Expected distinct page identities';
  end if;
  if (select count(*) from public.integration_credentials c join public.integration_accounts a
    on a.id=c.account_id and a.workspace_id=c.workspace_id and a.business_id=c.business_id
    where a.id in (first_ad.id,second_ad.id)) <> 2 then
    raise exception 'Per-venue credentials missing';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.integration_accounts'::regclass) then
    raise exception 'Account RLS was disabled';
  end if;
end $$;
rollback;
select 'passed: shared ads, unique venue binding, separate pages and credentials, RLS enabled; test writes rolled back' as verification;
