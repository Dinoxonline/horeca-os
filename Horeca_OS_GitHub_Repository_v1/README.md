# Horeca OS

Centraal managementplatform voor:

- Caribbean Corner
- Grandcafé Het Plein
- toekomstige horecaformules en vestigingen

## Doel

Horeca OS brengt agenda, taken, omzet, producten, recepturen, leveranciers, HACCP, reviews, marketing en managementinformatie samen in één veilige omgeving.

## Huidige status

- Supabase-productiedatabase actief
- beveiligde eigenaarstoegang
- Row Level Security actief
- openbare registratie uitgeschakeld
- Outlook-agenda-import ingericht
- Appsmen-basisdata ingericht
- producten- en recepturenstructuur ingericht
- audit logging ingericht
- dagelijkse logische back-up ingericht
- Vercel-productieomgeving actief

## Productie-URL

`https://horeca-os-le-club.vercel.app`

## Technische basis

- Frontend: Next.js
- Database en authenticatie: Supabase
- Hosting: Vercel
- Versiebeheer: GitHub
- Automatisering: ChatGPT-taken en later server-side jobs

## Veiligheid

Plaats nooit wachtwoorden, service-role keys, API-geheimen of databasewachtwoorden in deze repository.

Gebruik uitsluitend:

- `.env.local` voor lokaal gebruik
- Vercel Environment Variables voor productie
- Supabase Secrets voor Edge Functions

## Hoofdmodules

1. CEO Dashboard
2. Taken en besluiten
3. Agenda en evenementen
4. Omzet en verkoopdata
5. Producten en recepturen
6. Voorraad en bestellijsten
7. Leveranciers
8. HACCP
9. Personeel
10. Reviews
11. Marketing
12. Security Center
13. AI-directeur

## Eerstvolgende prioriteiten

1. Bestaande Vercel-code synchroniseren met deze repository
2. Vercel aan GitHub koppelen
3. Security Center zichtbaar maken in de webapp
4. Producten- en recepturenmodule zichtbaar maken
5. Outlook via Microsoft Graph volledig automatisch koppelen
6. Appsmen-import automatiseren
