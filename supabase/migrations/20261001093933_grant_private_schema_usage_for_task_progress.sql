-- Process task status trigger calls private.has_permission().
-- Authenticated users already have EXECUTE on that guarded function; they also
-- need schema usage for PostgreSQL to resolve the function inside the trigger.
grant usage on schema private to authenticated;
