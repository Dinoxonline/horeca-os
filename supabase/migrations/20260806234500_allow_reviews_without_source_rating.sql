-- Some review platforms provide text and sentiment without an individual score.
-- Keep those source records accurate instead of inventing a rating.
alter table public.customer_reviews
  alter column rating drop not null;

