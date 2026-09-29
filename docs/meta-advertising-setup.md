# Meta-advertentietoegang

Gewoon Facebook koppelen vraagt alleen de bestaande paginarechten. Alleen een
expliciet verzoek met `purpose: "ads"` mag daarnaast `ads_management` aanvragen.

Meta weigerde op 29 september 2026 deze extra scope voor de gebruikte app met
`Invalid Scopes: ads_management`. De precieze appinstelling kon niet worden
gecontroleerd omdat toegang tot Meta Developers in de browser geblokkeerd was.

Later op dezelfde dag toonde de gebruiker het Meta-dashboard voor app
`2231952860937833`: Marketing API toegevoegd en `ads_management` op
**Ready for testing**. Voor deze app is het aanvragen van advertentietoestemming
daarom standaard aangezet. Dit bevestigt nog geen succesvolle OAuth-toestemming,
gekoppeld advertentieaccount of App Review voor algemeen gebruik.
`META_ADS_ENABLED=false` blijft beschikbaar om het koppelen uit te zetten.

## Activeren

1. Open de Meta-app die bij `META_APP_ID` hoort in Meta Developers.
2. Controleer de Marketing API-usecase en of `ads_management` beschikbaar is.
   Controleer tevens de vereiste toegangsstatus voor de gebruikers en accounts
   die deze app gebruiken. Dit is meer dan de bestaande paginakoppeling.
3. Voor de hierboven gecontroleerde Horeca OS-app is aanvragen standaard aan.
   Zet voor een andere app pas na die controle `META_ADS_ENABLED=true` in de
   productieomgeving en publiceer opnieuw. Onbekende apps blijven standaard uit.
4. Open bij het evenement Meta-campagne en koppel het advertentieaccount.
   Controleer dat de teruggegeven toestemming `ads_management` bevat en het
   juiste advertentieaccount gekoppeld is. Het koppelen start geen campagne.

De knop Meta-appinstellingen in Horeca OS verwijst naar de gebruikte app.
De advertentieformulieren maken campagnes standaard gepauzeerd aan.

## URL kan niet worden geladen

Meta meldde vervolgens dat een domein niet bij de app is toegestaan. Controleer
in Basisinstellingen > Appdomeinen de Horeca OS-hostnamen:

- `horeca-os-le-club.vercel.app`
- `horeca-os-iota.vercel.app` (nog gebruikt als standaard OAuth-callback)

Bij Facebook Login > Instellingen > Geldige OAuth-omleidings-URI's moet het
exacte adres uit `FACEBOOK_REDIRECT_URI` staan. Zonder deze serverinstelling
gebruikt de code `https://horeca-os-iota.vercel.app/api/integrations/facebook/callback`.
Verander dit adres niet zonder de Meta-instelling mee te wijzigen; OAuth gebruikt
hetzelfde exacte adres bij het openen van de login en het inwisselen van de code.
De productievariabele en Meta-allowlist zijn nog niet gezamenlijk gecontroleerd.

Documentatie: https://developers.facebook.com/docs/marketing-api/get-started/authorization/
