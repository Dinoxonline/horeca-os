create table if not exists public.process_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_key text not null,
  name text not null,
  description text,
  category text not null default 'operations',
  trigger_type text not null default 'manual',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, template_key)
);

create table if not exists public.process_template_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid not null references public.process_templates(id) on delete cascade,
  title text not null,
  description text,
  relative_days integer not null default 0,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  role_key text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.process_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  template_id uuid not null references public.process_templates(id) on delete restrict,
  name text not null,
  anchor_date date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.process_run_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  run_id uuid not null references public.process_runs(id) on delete cascade,
  template_step_id uuid not null references public.process_template_steps(id) on delete restrict,
  title text not null,
  description text,
  due_date date,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  status text not null default 'not_started' check (status in ('not_started','in_progress','blocked','done')),
  assigned_to uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists process_templates_workspace_idx on public.process_templates(workspace_id, active, category);
create index if not exists process_template_steps_template_idx on public.process_template_steps(template_id, sort_order);
create index if not exists process_runs_workspace_date_idx on public.process_runs(workspace_id, anchor_date desc);
create index if not exists process_run_tasks_workspace_due_idx on public.process_run_tasks(workspace_id, status, due_date);

alter table public.process_templates enable row level security;
alter table public.process_template_steps enable row level security;
alter table public.process_runs enable row level security;
alter table public.process_run_tasks enable row level security;

create policy process_templates_read on public.process_templates for select to authenticated using (private.has_permission(workspace_id, 'processes:read', null, null));
create policy process_templates_manage on public.process_templates for all to authenticated using (private.has_permission(workspace_id, 'processes:manage', null, null)) with check (private.has_permission(workspace_id, 'processes:manage', null, null));
create policy process_template_steps_read on public.process_template_steps for select to authenticated using (private.has_permission(workspace_id, 'processes:read', null, null));
create policy process_template_steps_manage on public.process_template_steps for all to authenticated using (private.has_permission(workspace_id, 'processes:manage', null, null)) with check (private.has_permission(workspace_id, 'processes:manage', null, null));
create policy process_runs_read on public.process_runs for select to authenticated using (private.has_permission(workspace_id, 'processes:read', business_id, null));
create policy process_runs_manage on public.process_runs for all to authenticated using (private.has_permission(workspace_id, 'processes:manage', business_id, null)) with check (private.has_permission(workspace_id, 'processes:manage', business_id, null));
create policy process_run_tasks_read on public.process_run_tasks for select to authenticated using (private.has_permission(workspace_id, 'processes:read', business_id, null));
create policy process_run_tasks_manage on public.process_run_tasks for all to authenticated using (private.has_permission(workspace_id, 'processes:manage', business_id, null)) with check (private.has_permission(workspace_id, 'processes:manage', business_id, null));

grant select, insert, update, delete on public.process_templates, public.process_template_steps, public.process_runs, public.process_run_tasks to authenticated;
create trigger set_updated_at_process_runs before update on public.process_runs for each row execute function public.set_updated_at();
create trigger set_updated_at_process_run_tasks before update on public.process_run_tasks for each row execute function public.set_updated_at();

insert into public.role_permissions (workspace_id, role_id, permission)
select workspace_id, id, 'processes:read' from public.roles where role_key in ('owner','manager','employee','staff','viewer','kitchen_manager')
on conflict (role_id, permission) do nothing;
insert into public.role_permissions (workspace_id, role_id, permission)
select workspace_id, id, 'processes:manage' from public.roles where role_key in ('owner','manager')
on conflict (role_id, permission) do nothing;

do $$
declare w record;
begin
  for w in select id as workspace_id from public.workspaces loop
    insert into public.process_templates (workspace_id, template_key, name, description, category)
    values
      (w.workspace_id, 'event', 'Evenement', 'Van idee tot promotie, uitvoering en evaluatie.', 'marketing'),
      (w.workspace_id, 'dish', 'Nieuw gerecht', 'Recept, kostprijs, allergenen, training en lancering.', 'product'),
      (w.workspace_id, 'menu', 'Nieuwe menukaart', 'Assortiment, prijzen, ontwerp, POS, drukwerk en briefing.', 'product'),
      (w.workspace_id, 'newsletter', 'Nieuwsbrief', 'Inhoud, doelgroep, controle, planning en evaluatie.', 'marketing'),
      (w.workspace_id, 'vacancy', 'Vacature', 'Vacaturetekst, publicatie, selectie en onboarding.', 'people'),
      (w.workspace_id, 'grill_your_own', 'Nieuw concept', 'Campagne- en operatieproces voor het nieuwe concept.', 'marketing')
    on conflict (workspace_id, template_key) do nothing;
  end loop;
end $$;

do $$
declare r record; payload jsonb; item jsonb; i integer;
begin
  for r in select id, workspace_id, template_key from public.process_templates loop
    if exists (select 1 from public.process_template_steps where template_id = r.id) then continue; end if;
    payload := case r.template_key
      when 'event' then '[{"title":"Doel, doelgroep en budget bepalen","days":-42,"priority":"high","role":"manager"},{"title":"Website en evenement aanmaken","days":-35,"priority":"high","role":"marketing"},{"title":"Flyer en beeldmateriaal maken","days":-28,"priority":"high","role":"marketing"},{"title":"Nieuwsbrief en social posts voorbereiden","days":-21,"priority":"high","role":"marketing"},{"title":"Personeel, voorraad en draaiboek controleren","days":-7,"priority":"critical","role":"manager"},{"title":"Medewerkers briefen","days":-1,"priority":"high","role":"manager"},{"title":"Evenement uitvoeren","days":0,"priority":"critical","role":"team"},{"title":"Evalueren en vervolgactie bepalen","days":1,"priority":"medium","role":"manager"}]'::jsonb
      when 'dish' then '[{"title":"Recept en proefbereiding vastleggen","days":-14,"priority":"high","role":"kitchen_manager"},{"title":"Kostprijs, verkoopprijs en marge controleren","days":-10,"priority":"critical","role":"manager"},{"title":"Allergenen en werkinstructie vastleggen","days":-7,"priority":"high","role":"kitchen_manager"},{"title":"POS, website en menukaart aanpassen","days":-5,"priority":"high","role":"marketing"},{"title":"Team trainen en proefronde doen","days":-1,"priority":"high","role":"manager"},{"title":"Gerecht lanceren","days":0,"priority":"critical","role":"team"},{"title":"Verkoop en feedback evalueren","days":14,"priority":"medium","role":"manager"}]'::jsonb
      when 'menu' then '[{"title":"Assortiment en doelmarges bepalen","days":-42,"priority":"high","role":"manager"},{"title":"Recepten, prijzen en allergenen controleren","days":-28,"priority":"critical","role":"kitchen_manager"},{"title":"Kaart ontwerpen en teksten controleren","days":-21,"priority":"high","role":"marketing"},{"title":"POS, website en QR-kaart aanpassen","days":-10,"priority":"high","role":"marketing"},{"title":"Drukwerk bestellen en oude voorraad afbouwen","days":-7,"priority":"medium","role":"manager"},{"title":"Team trainen","days":-1,"priority":"high","role":"manager"},{"title":"Nieuwe kaart lanceren","days":0,"priority":"critical","role":"team"},{"title":"Marge en gastfeedback evalueren","days":14,"priority":"medium","role":"manager"}]'::jsonb
      when 'newsletter' then '[{"title":"Onderwerp en doelgroep bepalen","days":-10,"priority":"high","role":"marketing"},{"title":"Tekst, beeld en call-to-action maken","days":-7,"priority":"high","role":"marketing"},{"title":"Links, doelgroep en afzender controleren","days":-3,"priority":"critical","role":"manager"},{"title":"Testversie goedkeuren","days":-1,"priority":"high","role":"manager"},{"title":"Nieuwsbrief versturen","days":0,"priority":"critical","role":"marketing"},{"title":"Openingen en klikken evalueren","days":3,"priority":"low","role":"manager"}]'::jsonb
      when 'vacancy' then '[{"title":"Functie, uren en profiel bepalen","days":-14,"priority":"high","role":"manager"},{"title":"Vacaturetekst en beeld maken","days":-12,"priority":"high","role":"manager"},{"title":"Vacature publiceren","days":-10,"priority":"critical","role":"manager"},{"title":"Sollicitaties dagelijks opvolgen","days":-7,"priority":"high","role":"manager"},{"title":"Gesprekken plannen en voeren","days":-3,"priority":"high","role":"manager"},{"title":"Kandidaat kiezen en aanbod doen","days":0,"priority":"critical","role":"manager"},{"title":"Onboardingproces starten","days":7,"priority":"high","role":"manager"}]'::jsonb
      else '[{"title":"Concept en doel bepalen","days":-35,"priority":"high","role":"manager"},{"title":"Werkinstructie en prijs/marge vastleggen","days":-28,"priority":"critical","role":"manager"},{"title":"Flyer, website en socials voorbereiden","days":-21,"priority":"high","role":"marketing"},{"title":"Nieuwsbrief voorbereiden","days":-14,"priority":"high","role":"marketing"},{"title":"Voorraad, planning en briefing controleren","days":-3,"priority":"critical","role":"manager"},{"title":"Nieuw concept lanceren","days":0,"priority":"critical","role":"team"},{"title":"Evalueren en vervolgpromotie plannen","days":7,"priority":"medium","role":"manager"}]'::jsonb;
    i := 0;
    for item in select * from jsonb_array_elements(payload) loop
      insert into public.process_template_steps (workspace_id, template_id, title, relative_days, priority, role_key, sort_order)
      values (r.workspace_id, r.id, item->>'title', (item->>'days')::integer, item->>'priority', item->>'role', i);
      i := i + 1;
    end loop;
  end loop;
end $$;
