# Back-upoverzicht in Horeca OS

Route: `/beveiliging/backups`, bereikbaar via Beveiliging en de link Back-ups.
Alleen de eigenaar van de productie-werkruimte, met gecontroleerde sessie en
tweestapsverificatie, krijgt toegang. Het overzicht geldt voor de hele installatie,
niet alleen voor de geselecteerde vestiging. De server haalt alleen een beperkte
samenvatting op; geen opslagpaden, geheime sleutels of inhoud van bestanden.

## Twee verschillende bewijzen

- Database: de lokale Hourly-runner meldt alleen run-id, begin/eindtijd, resultaat,
  gecontroleerde lokale kopie en aantal versleutelde bytes. Het scherm bevestigt
  hiermee nadrukkelijk geen ontvangst door Dropbox. Na twee uur zonder recente
  geslaagde melding verschijnt een waarschuwing. Een mislukte laatste poging blijft
  zichtbaar, ook als er eerder wel een goede kopie was.
- Bestanden: aantallen en ontvangstbevestiging komen uit de bestaande serverwachtrij.
  Vertraagde opdrachten, mislukte opdrachten, verlopen leases, uitgeschakelde
  verwerking en startfouten krijgen een waarschuwing. Geen nieuwe bestanden betekent
  niet dat de dienst verouderd is.

Een fout bij ophalen vervangt de oude groene status; deze wordt niet als actueel
gepresenteerd. Status vernieuwen vraagt een nieuwe controle aan, geen nieuwe back-up.

## Statusrapportage

De lokale `Run-HorecaBackup.ps1 -Mode Hourly` is uitgebreid met
`runtime/report-status.mjs`. De oorspronkelijke back-upuitkomst blijft behouden
als alleen de rapportage mislukt. `statusReported` in RUN-RESULT.json geeft aan of
de melding is afgeleverd. De lokale runner en exporthelpers zijn computergebonden;
een webapp-uitrol installeert of verplaatst deze niet.

De aparte `horeca-backup-report` Edge Function gebruikt een uitsluitend voor
statusmeldingen bestemde geheime sleutel. Deze is lokaal met Windows DPAPI
opgeslagen buiten repository en Dropbox, en als BACKUP_REPORT_TOKEN in Edge
Functions. De endpoint accepteert maximaal 2048 bytes, slechts zes velden, uitsluitend
POST en geen lees-/wijzig-/verwijderopdrachten. Herhaalde run-id's overschrijven
niets. De back-updatabasegebruiker houdt alleen SELECT-rechten.

De tabellen hebben RLS zonder clientbeleid: dit is bewust deny-by-default.
Alleen de server mag rapportages opslaan en de statussamenvatting ophalen.

## Grenzen

Dit blijft de eenvoudige gedeeltelijke back-up: geen Auth-accounts, geheimen,
audit_log/backup_snapshots-inhoud of volledige projectherstelkopie. Bestandskopieën
dekken alleen marketing-assets en staff-ticket-attachments. Externe WordPress-media
en lokaal bewaarde oorspronkelijke offertes vallen erbuiten. De onafhankelijke
herstelsleutel blijft nodig. Er is geen automatisch verwijderbeleid.

## Verificatie

`node --test tests/backup-status.test.cjs tests/dropbox-backup.test.mjs` controleert
toegang, afgeschermde werkruimte, 2FA, lokale versus online bevestiging, foutstatus,
strikte rapportage, begrensde invoer en verversen zonder oude succesmelding.
Een echte Hourly-uitvoering op 27 september 2026 leverde zowel een gecontroleerde
kopie als `statusReported: true` op. De nieuwe statusgegevens worden meegenomen in
volgende database-exports.

Bij voorbereiding van de uitrol is Next.js binnen dezelfde 15.5-reeks gepatcht
van 15.5.21 naar 15.5.26 vanwege bestaande beveiligingsmeldingen.
Bron: https://github.com/vercel/next.js/releases/tag/v15.5.26
