# Outlook-integratie

## Huidige situatie

De agenda van `info@leclubbbq.nl` wordt periodiek naar Horeca OS gesynchroniseerd.

## Doelarchitectuur

Microsoft Graph OAuth met:

- veilige tokenopslag
- delta queries
- verwerking van nieuwe, gewijzigde en verwijderde afspraken
- deduplicatie op external_calendar_id
- synchronisatiestatus in `integrations`

## Kalender

Centrale bedrijfsagenda: `Le Club BBQ`.
