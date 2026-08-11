# Horeca OS — projectgeheugen

Laatst bijgewerkt: 9 augustus 2026

Dit document bewaart bevestigde projectcontext die niet verloren mag gaan wanneer oude chats worden verwijderd. Tijdelijke foutmeldingen en achterhaalde bedieningsinstructies zijn bewust niet als actuele waarheid opgenomen.

## Repository en levering

- GitHub-repository: `Dinoxonline/horeca-os`.
- De ChatGPT Codex Connector heeft lees- en schrijftoegang tot deze repository.
- GitHub en Vercel zijn gekoppeld aan het ontwikkel- en previewproces.
- Bestaande productiegegevens en Supabase-data moeten bij wijzigingen behouden blijven.
- Wijzigingen worden eerst gecontroleerd via een branch en Vercel-preview voordat ze naar productie gaan.

## Oorspronkelijke Release 1-scope

De eerste modulaire Horeca OS-release is opgezet rond:

- een nieuwe dashboard-shell;
- werkende navigatie;
- een zichtbare Foodcost-module;
- afzonderlijke routes voor dashboard, foodcost, producten, recepturen, leveranciers, reviews, marketing en AI;
- behoud van bestaande Supabase-data;
- minimale risico's voor de bestaande productieomgeving.

Belangrijke routes:

- `/dashboard`
- `/foodcost`
- `/producten`
- `/recepten`
- `/leveranciers`
- `/reviews`
- `/social-inbox`
- `/marketing`
- `/ai`

## Ontwikkelvolgorde

1. De bestaande applicatie en data veilig behouden.
2. De modulaire shell en echte routes neerzetten.
3. Wijzigingen via een Vercel-preview controleren.
4. Daarna de functionele modules verdiepen.

## Reviews en social media blijven gescheiden

- `/reviews` is uitsluitend voor beoordelingen, broncijfers, opvolging en antwoorden op reviews.
- `/social-inbox` is het centrale kanaal voor reacties en berichten van sociale platforms.
- Social-inboxgegevens blijven per vestiging gescheiden en volgen het recht `social:read`.
- Beheeracties volgen het recht `social:manage`.
- Facebook is de eerste aangesloten bron. Instagram, WhatsApp Business en TikTok kunnen later aan dezelfde social-inboxarchitectuur worden toegevoegd.

## Onderhoudsregel

Werk dit document alleen bij met bevestigde, duurzame informatie.
