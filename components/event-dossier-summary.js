"use client";
import { eventDistribution, normalizedEventImages } from '../lib/event-dossier';
import { calendarLocalTime } from '../lib/event-calendar';

export default function EventDossierSummary({ item, onEdit }) {
  const common = eventDistribution(item).common || {};
  const images = normalizedEventImages(common.images);
  const photos = [['Eventin / hoofdfoto', common.eventin_image?.url || common.image_url],
    ...Object.entries(images).map(([key, value]) => [{ landscape: 'Liggend', square: 'Vierkant', portrait: 'Staand', vertical: 'Story / Reel' }[key] || key, value?.url])];
  return <section aria-label="Opgeslagen evenement in Horeca OS" style={{ padding: 16, background: 'white', border: '1px solid #c8dce5', borderRadius: 10 }}>
    <h3>{common.title || 'Nog geen naam'}</h3>
    <p>{calendarLocalTime(common.start)?.replace('T', ' ') || 'Datum nog in te plannen'}{common.end ? ' — ' + calendarLocalTime(common.end).replace('T', ' ') : ''}</p>
    <p>{common.location || 'Locatie nog niet ingevuld'}</p>
    <p style={{ whiteSpace: 'pre-wrap' }}>{common.description || 'Tekst kun je later toevoegen.'}</p>
    {common.artist_program && <p><strong>Artiesten en programma: </strong>{common.artist_program}</p>}
    {common.practical_details && <p><strong>Praktische informatie: </strong>{common.practical_details}</p>}
    <h4>Tickets</h4>
    {(common.tickets?.variations || []).map((ticket, index) => <p key={ticket.id || index}><strong>{ticket.name || 'Ticket'}</strong> — {ticket.type === 'paid' ? '€ ' + ticket.price : 'Gratis'}{ticket.capacity ? ' · ' + ticket.capacity + ' beschikbaar' : ' · Onbeperkt'}{ticket.description ? ' · ' + ticket.description : ''}</p>)}
    {!(common.tickets?.variations || []).length && <p>Geen ticketsoorten ingevuld.</p>}
    <p>{common.organizer || ''}{common.contact_email ? ' · ' + common.contact_email : ''}</p>
    <h4>Opgeslagen afbeeldingen</h4>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12 }}>
      {photos.map(([label, url]) => <figure key={label} style={{ margin: 0, minWidth: 0 }}>
        <figcaption>{label}</figcaption>
        {url ? <img src={url} alt={label} style={{ width: '100%', height: 180, objectFit: 'contain', background: '#f1f6f8' }} /> : <p>Nog geen afbeelding gekozen.</p>}
      </figure>)}
    </div>
    {onEdit && <button type="button" className="primaryButton" onClick={onEdit}>Gegevens, tickets en afbeeldingen bewerken</button>}
  </section>;
}
