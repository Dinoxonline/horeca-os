do $$
declare
  w record;
  t uuid;
begin
  for w in select id as workspace_id from public.workspaces loop
    insert into public.process_templates (workspace_id, template_key, name, description, category)
    values (w.workspace_id, 'marketing_campaign', 'Promotiecampagne', 'Van promotie-idee naar publicatie, uitvoering en evaluatie.', 'marketing')
    on conflict (workspace_id, template_key) do update set active = true
    returning id into t;

    if t is null then
      select id into t from public.process_templates
      where workspace_id = w.workspace_id and template_key = 'marketing_campaign';
    end if;

    if not exists (select 1 from public.process_template_steps where template_id = t) then
      insert into public.process_template_steps (workspace_id, template_id, title, relative_days, priority, role_key, sort_order)
      values
        (w.workspace_id, t, 'Doel, doelgroep en budget bepalen', -21, 'high', 'manager', 0),
        (w.workspace_id, t, 'Aanbieding en boodschap vastleggen', -18, 'high', 'manager', 1),
        (w.workspace_id, t, 'Beeld, flyer en teksten maken', -14, 'high', 'marketing', 2),
        (w.workspace_id, t, 'Website, nieuwsbrief en socials voorbereiden', -10, 'high', 'marketing', 3),
        (w.workspace_id, t, 'Publicatiekalender en verantwoordelijken controleren', -5, 'critical', 'manager', 4),
        (w.workspace_id, t, 'Campagne publiceren', 0, 'critical', 'marketing', 5),
        (w.workspace_id, t, 'Resultaat en vervolgpromotie evalueren', 7, 'medium', 'manager', 6);
    end if;
  end loop;
end $$;