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

## Social Intelligence Hub

De Sprint 2-integratielaag is provider-onafhankelijk en ondersteunt in eerste instantie:

- Google Business Profile voor locaties, reviews en reviewreacties;
- Meta voor Facebook en Instagram;
- TikTok voor content, reacties en statistieken;
- Brevo voor contacten, nieuwsbrieven en campagneprestaties.

Alle gegevens blijven gescoped op workspace en, waar van toepassing, bedrijf en
vestiging. Externe accounts verwijzen alleen naar een server-side secretnaam; tokens
en API-sleutels worden nooit in publieke tabellen opgeslagen. Reviewreacties blijven
concept totdat een bevoegde gebruiker ze expliciet goedkeurt.

## Foodcost Engine

De foodcostketen is `supplier -> product -> ingredient -> recipe item -> recipe -> menu item`.
De bestaande inkoop- en recepttabellen worden uitsluitend additief uitgebreid. Kostinputs
blijven genormaliseerd en gescoped via workspace, bedrijf en optionele vestiging. De actuele
foodcost wordt uit bronprijzen berekend en niet als verouderingsgevoelig totaal opgeslagen.
Deze fundering activeert geen leveranciers-, factuur- of POS-koppeling.

## Back-ups

Dagelijkse logische snapshots worden maximaal 30 dagen bewaard.

Dit is geen vervanging voor een externe databaseback-up. Een tweede kopie buiten Supabase blijft noodzakelijk.

## AI-assistent

De AI-module gebruikt de OpenAI Responses API uitsluitend vanuit een Next.js serverroute.
`OPENAI_API_KEY` is een Vercel/server-secret en wordt nooit naar de browser gestuurd of
in Supabase opgeslagen. Iedere aanvraag valideert opnieuw de Supabase-sessie, het
`ai:use`-recht en de workspace-, bedrijfs- en optionele vestigingsscope.

Gesprekshistorie is alleen zichtbaar voor de maker en blijft onder RLS. De assistent
krijgt uitsluitend reeds tenant-gefilterde context. Audit-events bevatten gebruiksdoel,
model, status, tokens en doorlooptijd, maar geen prompt, antwoord of API-sleutel. Externe
acties en publicaties vallen buiten deze basis; de assistent geeft alleen advies.
