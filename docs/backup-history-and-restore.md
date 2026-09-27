# Back-uplijst en herstelstatus

Eigenaar + tweestapsverificatie: `/beveiliging/backups` → **Back-uplijst en herstel**.
De API controleert de gebruiker en het eigenaarschap vóór gebruik van serverrechten.
Databasepogingen en bestandsversies hebben afzonderlijke, gepagineerde lijsten (25 per pagina).
Dit is een register van gemelde automatische kopieën, geen volledige inventaris van ieder
los handmatig archief in Dropbox. Niet-gemelde of oudere handmatige archieven zijn niet automatisch zichtbaar.

## Inhoudsvergelijking

Na een geslaagde Hourly-melding analyseert `runtime/analyze-backup.mjs` de huidige
en voorafgaande geslaagde Hourly-kopie. Beide lokale Dropbox-archieven worden gecontroleerd
op grootte en SHA-256 uit hun oorspronkelijke RUN-RESULT. De privésleutel wordt alleen via
een lokale pipe ontsleuteld. De archieven worden in geheugen gelezen; er wordt geen SQL uitgevoerd.

Elke COPY-rij wordt gehasht. Gesorteerde rijhashes + kolommen vormen de tabelvingerafdruk:
volgordeverschillen worden genegeerd, dubbele rijen blijven meetellen, wijzigingen zonder
aantalverschil worden ontdekt. Niet-herkende COPY-syntaxis en onvolledige invoer blokkeren
de vergelijking; dit wordt nooit als ‘geen wijzigingen’ gerapporteerd.

Alleen tabelnaam, voor/na-aantallen en wijzigingssoort worden via de apart beveiligde
`horeca-backup-detail`-functie opgeslagen. Geen klantwaarden, privésleutels of rijhashes.
Ontbrekende vergelijking staat als ‘niet vastgelegd’. Falen van de vergelijking maakt
een geslaagde back-up niet ongedaan. Schema, functies, rechten, sequences en bestanden
worden NIET inhoudelijk vergeleken. Bestanden tonen hun upload-/bijwerkgebeurtenis apart.

## Herstel: nog niet vrijgegeven

De keuzeknop selecteert alleen een kopie om inhoud en proefherstelstatus te bekijken.
Er is bewust geen productieherstel-API, achtergrondhersteltaak of uitvoerbare terugzetknop.
`backup_restore_checks` bevat uitsluitend gecontroleerde metadata uit een lokaal testverslag.

2026-09-27: laatste kopie `20260927T161811Z-bd93295e` geprobeerd in een nieuw,
wachtwoordbeveiligd PostgreSQL-cluster dat uitsluitend op 127.0.0.1 luistert.
Herstel strandde op ontbrekend schema `auth`; cluster is gestopt, productie onaangeraakt.
Deze proef bewijst NIET dat herstel in een correct voorbereide Supabase-omgeving onmogelijk is.
Hij bewijst evenmin dat de kopie zelfstandig volledig herstelbaar is.

Voor vrijgave blijven nodig: een passende geïsoleerde Supabase-testomgeving, beheer van
de ontbrekende Auth/Storage-afhankelijkheden, controle op bijpassende bestandsversies,
een veiligheidskopie vooraf, write-stop tijdens omschakeling, afzonderlijke expliciete
bevestiging en een geteste rollback. Niet uitvoeren op basis van alleen een groen exportresultaat.

De eenvoudige Hourly-export sluit onder meer Auth, Storage en audit/backup-snapshot-inhoud uit.
Gekopieerde bestanden zijn afzonderlijke versies, geen atomaire gezamenlijke momentopname.
Er worden geen abonnementen, schedules, bestaande klantgegevens of bestaande rechten gewijzigd.

## Beveiligingscontrole

Nieuwe metadatatabellen: RLS aan, geen clientpolicies (bedoeld deny-all), alleen server INSERT/SELECT,
back-upinlog SELECT. Security-advisor heeft daarvoor alleen informatieve deny-all-meldingen.
Bestaande waarschuwingen over medewerkersfuncties en wachtwoordbescherming zijn niet aangepast.
Zie https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
en https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
