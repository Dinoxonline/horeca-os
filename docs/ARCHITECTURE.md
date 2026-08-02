# Architectuur

## Frontend

Next.js-applicatie op Vercel.

De browser gebruikt uitsluitend de Supabase publishable key. Dat is veilig in combinatie met correct ingestelde Row Level Security.

## Database

Supabase PostgreSQL in EU Central.

Belangrijkste tabellen:

- workspaces
- workspace_members
- profiles
- businesses
- business_locations
- roles
- role_permissions
- user_role_assignments
- tasks
- decisions
- events
- integrations
- suppliers
- products
- recipes
- recipe_items
- reviews
- sales_daily
- product_sales
- audit_log
- backup_snapshots
- security_checks

## Authenticatie

- openbare registratie uitgeschakeld
- anonieme login uitgeschakeld
- e-mailbevestiging actief
- gebruikers worden handmatig door een beheerder toegevoegd
- rollen: owner, manager, employee, viewer
- uitbreidbare workspace-rollen met optionele bedrijfs- en vestigingsscope
- autorisatie komt uit databasetabellen en nooit uit bewerkbare user metadata

## Integraties

### Outlook
Agenda `info@leclubbbq.nl` is de centrale bedrijfsagenda.

### Appsmen
Huidige fase: database en handmatige import.
Volgende fase: API of automatische export.

### Robuust
Nog te inventariseren.

### Brevo
Nog te koppelen voor campagnes en rapportages.

## Back-ups

Dagelijkse logische snapshots worden maximaal 30 dagen bewaard.

Dit is geen vervanging voor een externe databaseback-up. Een tweede kopie buiten Supabase blijft noodzakelijk.
