do $$
declare
  w record;
  t uuid;
begin
  for w in select id as workspace_id from public.workspaces loop
    insert into public.process_templates (workspace_id, template_key, name, description, category)
    values
      (w.workspace_id, 'daily_opening', 'Dagelijkse opening', 'Vaste openingscontrole voor iedere horecadag.', 'operations'),
      (w.workspace_id, 'weekly_review', 'Wekelijkse managementcheck', 'Wekelijks overzicht van omzet, planning, voorraad, personeel en marketing.', 'operations'),
      (w.workspace_id, 'monthly_menu_review', 'Maandelijkse menureview', 'Maandelijkse controle van kaart, marges, verkoop en gastfeedback.', 'product')
    on conflict (workspace_id, template_key) do update set active = true;

    select id into t from public.process_templates where workspace_id = w.workspace_id and template_key = 'daily_opening';
    if not exists (select 1 from public.process_template_steps where template_id = t) then
      insert into public.process_template_steps (workspace_id, template_id, title, relative_days, priority, role_key, sort_order)
      values
        (w.workspace_id, t, 'Reserveringen en bijzonderheden controleren', 0, 'high', 'manager', 0),
        (w.workspace_id, t, 'Voorraad, mise-en-place en apparatuur controleren', 0, 'critical', 'kitchen_manager', 1),
        (w.workspace_id, t, 'Zaal, sanitair en entree controleren', 0, 'high', 'team', 2),
        (w.workspace_id, t, 'Kassa, POS en dagbriefing klaarzetten', 0, 'high', 'manager', 3),
        (w.workspace_id, t, 'Team kort briefen voor de dienst', 0, 'medium', 'manager', 4);
    end if;

    select id into t from public.process_templates where workspace_id = w.workspace_id and template_key = 'weekly_review';
    if not exists (select 1 from public.process_template_steps where template_id = t) then
      insert into public.process_template_steps (workspace_id, template_id, title, relative_days, priority, role_key, sort_order)
      values
        (w.workspace_id, t, 'Omzet, marge en opvallende cijfers bekijken', 0, 'high', 'manager', 0),
        (w.workspace_id, t, 'Personeelsplanning en open diensten controleren', 0, 'high', 'manager', 1),
        (w.workspace_id, t, 'Voorraad, bestellingen en verspilling nalopen', 0, 'high', 'kitchen_manager', 2),
        (w.workspace_id, t, 'Marketing, evenementen en openstaande promoties nalopen', 0, 'medium', 'marketing', 3),
        (w.workspace_id, t, 'Actiepunten verdelen en opvolgdatum bepalen', 0, 'critical', 'manager', 4);
    end if;

    select id into t from public.process_templates where workspace_id = w.workspace_id and template_key = 'monthly_menu_review';
    if not exists (select 1 from public.process_template_steps where template_id = t) then
      insert into public.process_template_steps (workspace_id, template_id, title, relative_days, priority, role_key, sort_order)
      values
        (w.workspace_id, t, 'Verkoop per gerecht en drankje analyseren', 0, 'high', 'manager', 0),
        (w.workspace_id, t, 'Kostprijzen, marges en prijswijzigingen controleren', 0, 'critical', 'manager', 1),
        (w.workspace_id, t, 'Gastfeedback en teamfeedback verzamelen', 0, 'medium', 'team', 2),
        (w.workspace_id, t, 'Kaart, recepten en allergenen actualiseren', 0, 'high', 'kitchen_manager', 3),
        (w.workspace_id, t, 'Besluiten vastleggen en communicatie plannen', 0, 'high', 'manager', 4);
    end if;
  end loop;
end $$;