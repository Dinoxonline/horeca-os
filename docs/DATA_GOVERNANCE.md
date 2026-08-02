# Databeheer

## Uitgangspunten

- één centrale bron per datatype
- geen dubbele handmatige administraties
- wijzigingen moeten traceerbaar zijn
- gevoelige data alleen toegankelijk op basis van rol
- geen API-geheimen in frontend of GitHub

## Bronnen

| Data | Primaire bron |
|---|---|
| Agenda | Outlook |
| Bezorgomzet | Appsmen |
| Reserveringen | Robuust |
| Reviews | Google, Tripadvisor en overige kanalen |
| Nieuwsbrieven | Brevo |
| Producten en leveranciers | Horeca OS |
| Recepturen | Horeca OS |
| Taken en besluiten | Horeca OS |
| AI-gesprekken | Horeca OS, per gebruiker en tenant-scope |

## AI-dataminimalisatie

- OpenAI-sleutels staan uitsluitend in de server-side secret store.
- Alleen de laatste zestien gespreksberichten worden per aanvraag meegestuurd.
- Bedrijfscontext wordt server-side onder de ingelogde RLS-sessie opgehaald.
- Auditlogs bevatten geen volledige prompts of antwoorden.
- De OpenAI-aanvraag gebruikt `store: false`; Horeca OS beheert de eigen geschiedenis.
