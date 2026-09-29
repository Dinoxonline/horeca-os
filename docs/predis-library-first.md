# Predis: eerst maken, daarna inplannen

De standaardroute op de evenementdetailpagina, bij publicatiemomenten en bij opgeslagen dossiers onder ‘Nieuw evenement of campagne’ is nu:

1. Afbeelding, carrousel of video kiezen.
2. De overgenomen opdracht en bronfoto's controleren en expliciet toestemming geven voor Predis-tegoed.
3. Eén maakopdracht naar het server-side gekoppelde Predis-merk. De bestaande beveiligde route bewaart de aanvraag vóór verzending en herhaalt geen onzekere maakopdrachten.
4. Horeca OS haalt het resultaat automatisch op terwijl het onderdeel openstaat: normaal iedere 20 seconden, maximaal 15 minuten vanaf aanmaak. Bij fouten loopt de wachttijd op; na drie fouten pauzeert de controle. Handmatig ophalen blijft beschikbaar. Sluiten stopt de browsercontrole, niet de reeds geaccepteerde Predis-opdracht.
5. Het ontwerp bekijken, daarna het bestaande ontwerp in de Predis-inhoudsbibliotheek openen om kanalen/datum/tijd te kiezen. Geen opnieuw uploaden of opnieuw genereren.

De bibliotheeklink selecteert geen merk of specifiek ontwerp. Horeca OS toont daarom vestiging en Predis-contentnummer. De officiële API documenteert creëren en ophalen, geen planning die hier is geïmplementeerd. ‘Klaar’ betekent dus niet ingepland of gepubliceerd. UGC, productfotoshoots en andere speciale UI-modi blijven expliciet handmatige Predis-opties.

Een nieuw dossier wordt eerst intern opgeslagen; opslaan genereert geen betaalde content meer. Dezelfde maker staat daarna in het opgeslagen dossier. Bij bewerken blijven Predis-jobs, resultaten en oude handmatige voorbereidingen behouden. De update gebruikt de actuele versie en weigert een gelijktijdige wijziging (bijvoorbeeld een webhook) te overschrijven. RLS en bestaande werkruimte-/vestigingsbeperkingen blijven actief.

Eerdere handmatige voorbereiding en planning blijven via een apart uitklapbaar onderdeel bereikbaar. Deze route is niet meer de standaard, ook niet bij een publicatiemoment.

## Verificatie

Geautomatiseerde tests met nagebootste providerantwoorden toetsen: geaccepteerd → automatisch ophalen → klaar → expliciet bekeken → planlink; geen tweede maakopdracht; pauzeren bij fouten/sluiten; behouden van opgeslagen historie; gelijktijdige wijzigingen weigeren; beide marketingingangen. Geen betaald echt ontwerp, planning of publicatie uitgevoerd. De daadwerkelijke verschijning in de ingelogde Predis-bibliotheek is nog niet end-to-end bevestigd; browserbediening was in deze sessie geblokkeerd.

Bronnen: [Create content](https://predis.ai/developers/docs/predis-api/API%20reference/create-content-api/), [Get posts](https://predis.ai/developers/docs/predis-api/API%20reference/get-all-posts/), [Quick start](https://predis.ai/developers/docs/predis-api/quick-start/).
