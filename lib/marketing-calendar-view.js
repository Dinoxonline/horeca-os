export const CALENDAR_CONTENT_VIEWS = {
  events: { label: 'Evenementen', description: 'Alleen evenementen op hun evenementdatum. Publicatiemomenten staan bij Berichtenplanning.', empty: 'Geen evenementen in deze selectie.' },
  publications: { label: 'Berichtenplanning', description: 'Berichten op hun gewenste publicatiedatum, niet op de evenementdatum. Voorbereid betekent: nog niet verstuurd.', empty: 'Nog geen publicatiemomenten bewaard. Kies bij een evenement je bericht en publicatiemomenten.' },
  both: { label: 'Beide', description: 'Evenementen en publicatiemomenten samen. Kaartjes met Publicatie zijn berichten, geen evenementen op die dag.', empty: 'Geen evenementen of publicatiemomenten in deze selectie.' },
};

// Display only: never change dates, saved preparations or provider confirmations.
export function calendarContentItems(events, publications, view = 'events') {
  if (view === 'publications') return [...publications];
  if (view === 'both') return [...events, ...publications];
  return [...events];
}
