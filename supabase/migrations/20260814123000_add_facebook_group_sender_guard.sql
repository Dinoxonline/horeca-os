alter table public.facebook_group_targets
  add column if not exists sender_page_id text,
  add column if not exists sender_page_name text,
  add column if not exists sender_verified_at timestamptz;

comment on column public.facebook_group_targets.sender_page_id is
  'Facebook Page id that must be selected as the posting identity before guided group sharing.';

comment on column public.facebook_group_targets.sender_verified_at is
  'Timestamp at which an operator confirmed that this Page is allowed to post in the group.';
