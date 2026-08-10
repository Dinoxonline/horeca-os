# Brevo-integratie

De eerste fase is uitsluitend lezen. Horeca OS kan:

- de Brevo-accountverbinding controleren;
- contactlijsten per vestiging ophalen;
- verzonden campagnes per vestiging ophalen;
- afleveringen, openratio, klikratio en uitschrijvingen uit de campagnestatistieken tonen.

## Strikte scheiding per vestiging

Iedere vestiging krijgt een eigen set Brevo-lijst-ID's:

- `BREVO_CARIBBEAN_CORNER_LIST_IDS`
- `BREVO_GRANDCAFE_HET_PLEIN_LIST_IDS`

Zonder toegewezen lijst-ID's geeft de API geen contacten of campagnes terug. Hetzelfde lijst-ID mag nooit bij beide vestigingen worden ingesteld.

## Nog te bouwen

- contacten en segmenten in de Horeca OS-interface;
- campagne-KPI's en campagneomzet;
- synchronisatiestatus en foutmeldingen;
- schrijven of campagnes verzenden, pas na aparte goedkeuring.
