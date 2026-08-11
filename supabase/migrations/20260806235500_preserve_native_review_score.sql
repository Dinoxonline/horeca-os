-- Preserve the score exactly as supplied by the review source.
-- This supports stars, numbers, letters, and source-specific subscores.
alter table public.customer_reviews
  add column if not exists source_rating text;

update public.customer_reviews
set source_rating = rating::text
where rating is not null
  and nullif(source_rating, '') is null;

update public.customer_reviews
set source_rating = 'Eten 3/5 Â· Service 3/5 Â· Sfeer 1/5'
where external_id = 'manual-20260802-angelique-schouten';

