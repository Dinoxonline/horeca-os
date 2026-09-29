# Meta-campagne: bronnen en doelgroepen

De gedeelde editor wordt gebruikt bij evenementdetails en na opslaan via Nieuw evenement / campagne.

## Beschikbaar

- Campagne en bron: nieuwe afbeeldingsadvertentie, Facebook-evenement, bestaand Facebookbericht, bestaand Instagrambericht / Reel.
- Bronlijsten lezen alleen van de gekoppelde Facebookpagina en het daaraan gekoppelde Instagram-profiel. Paginering met ‘Meer laden’; zoekfilter geldt alleen voor geladen resultaten.
- Facebookbericht gebruikt `object_story_id`; Instagram gebruikt `source_instagram_media_id` met pagina/Instagram-identiteit. Inhoud blijft ongewijzigd, doel Betrokkenheid en oorspronkelijk kanaal; Meta bepaalt geschikte plaatsingen en promotietoelating.
- Facebook-evenement wordt als bestemming van een linkadvertentie gebruikt, doel Verkeer. Geen EVENT_RESPONSES / Geïnteresseerd-Gaat-promotie.
- Doelgroep: zelf samenstellen, expliciete Advantage+-instelling, opgeslagen Meta-doelgroep. Bestaande aangepaste / vergelijkbare doelgroepen kunnen bij zelf samenstellen of Advantage+ worden gekozen. Geen klantgegevensupload of nieuwe doelgroepcreatie.
- Opgeslagen doelgroep wordt server-side opnieuw gelezen. Alle doelgroepvoorwaarden blijven behouden; plaatsingen worden apart gekozen. Jonger dan 18 wordt geweigerd.
- Begunstigde en betaler zijn verplicht in editor v3 en worden als dsa_beneficiary/dsa_payor naar Meta gestuurd. Betaler wordt bewust ingevuld, niet uit het gedeelde account afgeleid.
- Bijzondere advertentiecategorieën zijn zichtbaar maar blokkeren aanmaken; hiervoor wordt verwezen naar Meta.

## Veiligheid en grenzen

- Advertenties, advertentiesets en campagnes blijven PAUSED. Aanmaken vereist bevestiging. Tests doen geen echte Meta-mutaties.
- Autorisatie, account en credentials blijven gescheiden per workspace en vestiging. De gebruiker kan geen pagina/account via requestparameters vervangen.
- Bron en doelgroep worden vóór externe writes opnieuw gevalideerd op eigendom. Ontbrekende toegang geeft een fout; er is geen terugval naar een andere vestiging.
- Paginering volgt nooit een door Meta meegeleverde URL met token; alleen een cursor op een vaste Graph-edge. Tokens blijven server-side in Authorization-headers.
- De oorspronkelijke post wordt gepromoot; de preview is alleen indicatief, video/carrousel is een stilstaand beeld.
- Bestaande Meta-campagnes buiten Horeca OS worden niet automatisch gematcht. Hiervoor staat vóór de bronkeuze een waarschuwing.
- Bij opgeslagen doelgroepen blijft locatie/leeftijd volgens Meta leidend, niet de verborgen handmatige velden.
- Bij Advantage+ kunnen suggesties worden uitgebreid. De editor belooft geen exact bereik of vaste maximale leeftijd.

## Verificatie

Gerichte tests: meta-promotion-catalog, meta-campaign-composer, meta-campaign-status, facebook-ads-authorization, facebook-ad-account-selection; daarnaast drie schermregressietests.

Meta API-velden en edges zijn gecontroleerd in de officiële facebook-python-business-sdk (adaccount, adcreative, targeting, targetingautomation, savedaudience, customaudience, page, igmedia). De actuele promotietoelating van een specifiek bericht moet nog met de ingelogde Meta-toegang worden bevestigd. Browsercontrole was niet beschikbaar door de bestaande browserbeveiligingsblokkade. Er is geen campagne gestart als test.
