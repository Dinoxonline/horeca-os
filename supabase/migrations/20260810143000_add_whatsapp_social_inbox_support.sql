alter table public.integration_accounts
  drop constraint if exists integration_accounts_provider_check;

alter table public.integration_accounts
  add constraint integration_accounts_provider_check
  check (provider = any (array[
    'google_business',
    'meta',
    'facebook',
    'whatsapp',
    'tiktok',
    'brevo',
    'robuust'
  ]));

alter table public.social_content_items
  drop constraint if exists social_content_items_content_type_check;

alter table public.social_content_items
  add constraint social_content_items_content_type_check
  check (content_type = any (array[
    'post',
    'reel',
    'story',
    'video',
    'comment',
    'message',
    'campaign',
    'email'
  ]));

create unique index if not exists social_content_items_provider_external_unique
  on public.social_content_items (account_id, external_id)
  where external_id is not null;
