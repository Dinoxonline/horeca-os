# Supabase migrations

Nieuwe databasewijzigingen worden met de Supabase CLI aangemaakt en opgeslagen in
`supabase/migrations`. Deze map bevat alleen historische documentatie.

Naamgeving:

`YYYYMMDDHHMMSS_beschrijving.sql`

Voorbeeld:

`20260802160000_add_inventory_tables.sql`

Voer DDL-wijzigingen nooit ad-hoc uit zonder ze ook als migratie in versiebeheer op te slaan.
