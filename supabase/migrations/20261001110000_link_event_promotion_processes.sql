alter table public.process_runs
  add column if not exists marketing_item_id uuid references public.social_content_items(id) on delete set null;

create index if not exists process_runs_marketing_item_idx
  on public.process_runs (workspace_id, marketing_item_id)
  where marketing_item_id is not null;

create unique index if not exists process_runs_one_event_promotion_checklist_idx
  on public.process_runs (workspace_id, marketing_item_id, template_id)
  where marketing_item_id is not null;
