# Social Intelligence Hub

## Doel

Eén veilige inbox en contentlaag voor reviews, reacties, berichten, publicaties en
campagneresultaten van Google Business, Facebook, Instagram, TikTok en Brevo.

## Integratielaag

1. OAuth of API-autorisatie vindt uitsluitend server-side plaats.
2. `integration_accounts` bewaart provideridentiteit, scopes en een secretreferentie;
   nooit het token of de API-sleutel zelf.
3. Webhooks worden vóór verwerking gecontroleerd op handtekening, tijdvenster en
   replay. Alleen een SHA-256-hash en provider-event-id worden als ontvangstbewijs
   bewaard.
4. `integration_sync_jobs` maakt synchronisatie hervatbaar, observeerbaar en
   idempotent.
5. Providerpayloads worden vertaald naar generieke content-, conversatie-, bericht-
   en reviewmodellen. Providerspecifieke velden komen pas na dataminimalisatie in een
   afzonderlijke private opslaglaag.

## Autorisatie

- `integrations:read` — status en syncresultaten bekijken.
- `integrations:manage` — accounts en configuratie beheren.
- `social:read` — content, reacties en berichten bekijken.
- `social:manage` — content en inbox beheren.
- `social:publish` — publicatie goedkeuren of starten.
- `reviews:read` — reviews en conceptreacties bekijken.
- `reviews:respond` — reviewreacties opstellen en goedkeuren.

Alle RLS-policies gebruiken de bestaande databaserechten met workspace-, bedrijfs-
en vestigingsscope. Autorisatie gebruikt geen bewerkbare gebruikersmetadata.

Conceptcontent kan zonder provider-ID worden gepland. De database vereist een
bevoegde menselijke goedkeurder voordat content de status `scheduled`, `publishing`
of `published` krijgt. Een provider-ID wordt pas verplicht zodra content werkelijk
gepubliceerd of geïmporteerd is.

AI-ondersteuning mag uitsluitend een reviewconcept maken. Bij de eerste overgang
naar `approved` registreert de database de ingelogde gebruiker en het tijdstip; deze
goedkeuringsmetadata kan daarna niet worden herschreven.

## Veilige activatie per provider

Een provider blijft `not_configured` totdat aan alle voorwaarden is voldaan:

- afzonderlijke OAuth-app en redirect-URL's voor preview en productie;
- minimale, gedocumenteerde scopes;
- secrets uitsluitend in een server-side secret store;
- webhookhandtekening en replaybescherming getest;
- rate limits, backoff, tokenrotatie en intrekking geïmplementeerd;
- audit- en foutlogging zonder tokens of volledige gevoelige payloads;
- handmatige smoke test per gekoppeld bedrijf en vestiging.

## Gefaseerd plan

1. Databasefundering en RBAC valideren.
2. Server-side provideradapters definiëren met één intern contract.
3. Google Business read-only reviewsynchronisatie als eerste pilot.
4. Conceptreacties en menselijke goedkeuringsflow toevoegen.
5. Meta, TikTok en Brevo één voor één aansluiten en per provider beveiligen.
6. Publicatie en automatisering pas activeren na audit, monitoring en rollbacktest.
