# Securitybeleid

## Reeds uitgevoerd

- Row Level Security op publieke tabellen
- geen anonieme database-toegang
- openbare registratie uit
- anonieme login uit
- e-mailbevestiging aan
- eigenaar gekoppeld aan werkruimte
- SECURITY DEFINER-functies met vast search path
- audit logging
- dagelijkse logische back-up
- beveiligde Next.js-versie

## Openstaande verbeteringen

- MFA voor beheerders
- extern back-updoel
- GitHub 2FA controleren
- Vercel 2FA controleren
- branch protection zodra ontwikkelworkflow actief is
- dependency scanning
- rate limiting op gevoelige routes
- sessiebeleid en automatische uitlogtijd
- herstelprocedure testen

## Sleutelbeheer

Nooit opslaan in GitHub:

- Supabase service-role key
- Microsoft client secret
- OpenAI API key
- Brevo API key
- Appsmen API key
- databasewachtwoord
