"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { calendarDistribution, calendarEventTimes } from '../lib/event-calendar';
import { eventEditorDraft, editorDifferences, imageRoles, safeEventUrl } from '../lib/event-editor';
import { instagramEventMedia } from '../lib/instagram-event-media';
import styles from './event-editor.module.css';

const imageSlots = [
  { key: 'landscape', label: 'Liggend', width: 1200, height: 630, ratio: '1,91:1' },
  { key: 'square', label: 'Vierkant', width: 1080, height: 1080, ratio: '1:1' },
  { key: 'portrait', label: 'Staand bericht', width: 1080, height: 1350, ratio: '4:5' },
  { key: 'vertical', label: 'Story, Reel en TikTok', width: 1080, height: 1920, ratio: '9:16' },
];
const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const registeredImageUploaders = new Map();

export function registerEventImageUploader(itemId, uploader) {
  const id = String(itemId || '');
  if (!id) return () => {};
  registeredImageUploaders.set(id, uploader);
  return () => {
    if (registeredImageUploaders.get(id) === uploader) registeredImageUploaders.delete(id);
  };
}

function Photo({ url, label }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return safeEventUrl(url) ? failed ? <p>Foto kon niet worden geladen.</p> : <Image unoptimized src={url} alt={label} width={500} height={360} className={styles.photo} onError={() => setFailed(true)} /> : <p>Geen foto opgegeven.</p>;
}

const labels = { title: 'Titel', description: 'Omschrijving', start: 'Begin', end: 'Einde', location: 'Locatie', ...imageRoles };

export default function EventEditor({ item, sources = [], checking, onRefresh, onSave, onUnsavedChange, onOpenChannel, onImageUpload, busy }) {
  const [base, setBase] = useState(item), [draft, setDraft] = useState(() => eventEditorDraft(item));
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [uploading, setUploading] = useState(''), [uploadMessage, setUploadMessage] = useState(''), [cropFocus, setCropFocus] = useState('center');
  const lock = useRef(false), received = useRef(item), editor = useRef(null), dirty = editorDifferences(eventEditorDraft(base), draft).length > 0;
  useEffect(() => { editor.current?.closest('details')?.setAttribute('open', ''); }, []);
  useEffect(() => { if (received.current === item) return; received.current = item; if (!dirty && !saving) { setBase(item); setDraft(eventEditorDraft(item)); } }, [item, dirty, saving]);
  useEffect(() => { onUnsavedChange?.(dirty || saving || Boolean(uploading)); }, [dirty, saving, uploading, onUnsavedChange]);
  useEffect(() => { if (typeof window === 'undefined') return; const warn = event => { event.preventDefault(); event.returnValue = ''; }; if (dirty || saving || uploading) window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, saving, uploading]);
  const website = sources.find(source => source.label === 'Eventin' && source.item?.business_id === item.business_id)?.item;
  const web = website ? eventEditorDraft(website) : null, webCommon = calendarDistribution(website).common || {};
  const differences = web ? editorDifferences(eventEditorDraft(item), web) : [];
  const assets = instagramEventMedia(item).filter(asset => asset.type === 'image');
  const savedCommon = calendarDistribution(item).common || {};
  const savedPhotos = [...Object.entries(imageRoles).map(([key, label]) => ({ label, url: draft[key] })), ...assets.map(asset => ({ label: asset.label, url: asset.url }))]
    .filter((photo, index, all) => safeEventUrl(photo.url) && all.findIndex(candidate => candidate.url === photo.url) === index);
  const savedTickets = Array.isArray(savedCommon.tickets?.variations) ? savedCommon.tickets.variations : [];
  const uploader = () => onImageUpload || registeredImageUploaders.get(String(item.id));

  function change(key, value) { setDraft(current => ({ ...current, [key]: value })); setNotice(''); setError(''); }
  function validateImage(file) {
    if (!file) return 'Kies eerst een afbeelding.';
    if (!acceptedImageTypes.includes(file.type)) return 'Gebruik een JPG-, PNG- of WebP-afbeelding.';
    if (file.size > 10 * 1024 * 1024) return 'De afbeelding mag maximaal 10 MB zijn.';
    return '';
  }
  async function prepareImageForSlot(file, slot) {
    const loaded = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new window.Image();
      image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Afbeelding kon niet worden gelezen.')); };
      image.src = url;
    });
    try {
      const sourceRatio = loaded.width / loaded.height, targetRatio = slot.width / slot.height;
      let sourceX = 0, sourceY = 0, sourceWidth = loaded.width, sourceHeight = loaded.height;
      if (sourceRatio > targetRatio) { sourceWidth = loaded.height * targetRatio; sourceX = (loaded.width - sourceWidth) / 2; }
      else if (sourceRatio < targetRatio) { sourceHeight = loaded.width / targetRatio; sourceY = cropFocus === 'top' ? 0 : cropFocus === 'bottom' ? loaded.height - sourceHeight : (loaded.height - sourceHeight) / 2; }
      if (sourceWidth < slot.width || sourceHeight < slot.height) throw new Error(`${slot.label} heeft minimaal ${slot.width} × ${slot.height} bruikbare pixels nodig. Deze foto is ${loaded.width} × ${loaded.height} px.`);
      const canvas = document.createElement('canvas'); canvas.width = slot.width; canvas.height = slot.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('De afbeelding kon niet automatisch worden aangepast.');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(loaded.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, slot.width, slot.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, file.type, file.type === 'image/png' ? undefined : 0.92));
      if (!blob) throw new Error('De afbeelding kon niet automatisch worden aangepast.');
      const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const name = `${extension ? file.name.slice(0, -extension.length) : file.name}-${slot.width}x${slot.height}${extension}`;
      return new File([blob], name, { type: file.type, lastModified: Date.now() });
    } finally { URL.revokeObjectURL(loaded.url); }
  }
  async function uploadOne(slot, file) {
    const validation = validateImage(file); if (validation) return setUploadMessage(validation);
    const saveImage = uploader(); if (!saveImage) return setUploadMessage('Afbeeldingen kunnen nog niet worden opgeslagen. Sluit dit evenement en open het opnieuw.');
    setUploading(slot.key); setUploadMessage('');
    try {
      const uploaded = await saveImage({ file: await prepareImageForSlot(file, slot), role: slot.key });
      if (!uploaded?.url) throw new Error('De afbeelding kon niet worden opgeslagen.');
      change(slot.key, uploaded.url);
      setUploadMessage(`${slot.label} is gekozen. Klik nu op ‘Wijzigingen bewaren in Horeca OS’.`);
    } catch (uploadError) { setUploadMessage(uploadError.message || 'Uploaden is niet gelukt.'); }
    finally { setUploading(''); }
  }
  async function uploadAll(file) {
    const validation = validateImage(file); if (validation) return setUploadMessage(validation);
    const saveImage = uploader(); if (!saveImage) return setUploadMessage('Afbeeldingen kunnen nog niet worden opgeslagen. Sluit dit evenement en open het opnieuw.');
    setUploading('all'); setUploadMessage('');
    try {
      const original = await saveImage({ file, role: 'image_url' });
      if (!original?.url) throw new Error('De hoofdafbeelding kon niet worden opgeslagen.');
      const results = await Promise.allSettled(imageSlots.map(async slot => {
        const uploaded = await saveImage({ file: await prepareImageForSlot(file, slot), role: slot.key });
        if (!uploaded?.url) throw new Error('Geen afbeeldingslink ontvangen.');
        return [slot.key, uploaded.url];
      }));
      const images = Object.fromEntries(results.filter(result => result.status === 'fulfilled').map(result => result.value));
      setDraft(current => ({ ...current, image_url: original.url, ...images }));
      const failed = results.length - Object.keys(images).length;
      setUploadMessage(failed ? `De flyer is gekozen. ${Object.keys(images).length} formaten zijn gemaakt; ${failed} lukte niet automatisch. Je kunt die hieronder apart kiezen. Klik nu op ‘Wijzigingen bewaren in Horeca OS’.` : 'De flyer en alle formaten zijn klaar. Klik nu op ‘Wijzigingen bewaren in Horeca OS’.');
    } catch (uploadError) { setUploadMessage(uploadError.message || 'Uploaden is niet gelukt.'); }
    finally { setUploading(''); }
  }
  async function save() {
    if (lock.current || busy || !dirty) return;
    lock.current = true; setSaving(true); setError(''); setNotice('Evenement bewaren…');
    try { const saved = await onSave(base, draft); if (!saved) throw new Error('Opslaan kon niet worden bevestigd. Je wijzigingen blijven staan.'); setBase(saved); setDraft(eventEditorDraft(saved)); setNotice('Opgeslagen in Horeca OS. Er is niets gepubliceerd of gewijzigd op andere kanalen.'); }
    catch (saveError) { setNotice(''); setError(saveError.message || 'Opslaan mislukt. Je wijzigingen blijven staan.'); }
    finally { lock.current = false; setSaving(false); }
  }
  const disabled = busy || saving || Boolean(uploading);
  return <section ref={editor} className={styles.editor} aria-label="Evenement bekijken en bewerken">
    <section className={styles.savedOverview} aria-label="Opgeslagen in Horeca OS">
      <div className={styles.savedOverviewHead}><div><p>HORECA OS</p><h4>Dit staat klaar voor Eventin</h4></div><span>Concept</span></div>
      <dl className={styles.savedFacts}><div><dt>Titel</dt><dd>{draft.title || 'Nog niet ingevuld'}</dd></div><div><dt>Begin</dt><dd>{draft.start?.replace('T', ' ') || 'Nog niet ingevuld'}</dd></div><div><dt>Einde</dt><dd>{draft.end?.replace('T', ' ') || 'Nog niet ingevuld'}</dd></div><div><dt>Locatie</dt><dd>{draft.location || 'Nog niet ingevuld'}</dd></div></dl>
      <div className={styles.savedText}><strong>Omschrijving</strong><p>{draft.description || 'Nog niet ingevuld'}</p></div>
      <div className={styles.savedTickets}><strong>Tickets</strong>{savedTickets.length ? <ul>{savedTickets.map((ticket, index) => <li key={`${ticket.name || 'ticket'}-${index}`}>{ticket.name || 'Ticket'} · {ticket.type === 'paid' ? `€ ${Number(ticket.price || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Gratis'}{ticket.capacity ? ` · ${ticket.capacity} beschikbaar` : ''}</li>)}</ul> : <p>Nog geen tickets opgeslagen.</p>}</div>
      <div className={styles.savedPhotos}><strong>Afbeeldingen ({savedPhotos.length})</strong>{savedPhotos.length ? <div>{savedPhotos.map(photo => <figure key={photo.url}><Photo url={photo.url} label={photo.label} /><figcaption>{photo.label}</figcaption></figure>)}</div> : <p>Nog geen afbeeldingen opgeslagen.</p>}</div>
    </section>
    <details className={styles.editDetails}><summary>Gegevens aanpassen</summary><div className={styles.editForm}>
      <div className={styles.panel}>
        <h4>Mijn evenement</h4>
        <label>Titel<input value={draft.title} maxLength={300} disabled={disabled} onChange={event => change('title', event.target.value)} /></label>
        <label>Volledige omschrijving<textarea rows={9} value={draft.description} maxLength={30000} disabled={disabled} onChange={event => change('description', event.target.value)} /></label>
        <div className={styles.times}>{['start', 'end'].map(key => <label key={key}>{labels[key]} (Nederland)<input type={draft[key]?.length === 10 ? 'date' : 'datetime-local'} value={draft[key]} disabled={disabled} onChange={event => change(key, event.target.value)} />{draft[key]?.length === 10 && <button type="button" className="secondaryButton" disabled={disabled} onClick={() => change(key, `${draft[key]}T00:00`)}>Tijd toevoegen</button>}</label>)}</div>
        <label>Locatie<input value={draft.location} disabled={disabled} onChange={event => change('location', event.target.value)} /></label>
        <section className={styles.imageUploads} aria-label="Afbeeldingen">
          <div><strong>Afbeeldingen</strong><p>Kies één flyer van je computer. Die wordt bewaard als hoofdafbeelding voor Eventin; de andere formaten worden automatisch gemaakt waar dat kan.</p></div>
          <label className={styles.uploadButton}>{uploading === 'all' ? 'Flyer voorbereiden…' : 'Afbeelding kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => uploadAll(event.target.files?.[0])} /></label>
          <label className={styles.cropFocus}>Bij het bijsnijden: <select value={cropFocus} disabled={disabled} onChange={event => setCropFocus(event.target.value)}><option value="top">boven behouden</option><option value="center">midden behouden</option><option value="bottom">onder behouden</option></select></label>
          <details className={styles.formatDetails}><summary>Ander formaat kiezen</summary><p>Alleen nodig wanneer je per kanaal een andere flyer wilt gebruiken.</p><div className={styles.imageSlotGrid}>{imageSlots.map(slot => <article className={styles.imageSlot} key={slot.key}><div><strong>{slot.label}</strong><span>{slot.width} × {slot.height} px · {slot.ratio}</span>{draft[slot.key] && <Photo url={draft[slot.key]} label={slot.label} />}</div><label className={styles.uploadButton}>{uploading === slot.key ? 'Bezig…' : 'Afbeelding kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => uploadOne(slot, event.target.files?.[0])} /></label></article>)}</div></details>
          <small>JPG, PNG of WebP · maximaal 10 MB per afbeelding.</small>{uploadMessage && <p role="status" className={styles.uploadMessage}>{uploadMessage}</p>}
        </section>
        <div className={styles.actions}><button type="button" className="primaryButton" disabled={disabled || !dirty} onClick={save}>{saving ? 'Evenement bewaren…' : 'Wijzigingen bewaren in Horeca OS'}</button><button type="button" className="secondaryButton" disabled={disabled || !dirty} onClick={() => { if (window.confirm('Je niet-opgeslagen wijzigingen terugzetten?')) { setBase(item); setDraft(eventEditorDraft(item)); setNotice('Niet-opgeslagen wijzigingen teruggezet.'); setError(''); } }}>Wijzigingen terugzetten</button></div>
        {dirty && <p role="status">Nog niet opgeslagen.</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <p role="alert">{error}</p>}
      </div>
      <details className={styles.sourceDetails}><summary>Vergelijken met Eventin (optioneel)</summary><div className={styles.panel}><button type="button" className="secondaryButton" disabled={disabled || checking || !onRefresh} onClick={onRefresh}>{checking ? 'Websitegegevens ophalen…' : 'Websitegegevens opnieuw ophalen'}</button>{web ? <><strong>{web.title || 'Titel ontbreekt'}</strong><Photo url={web.image_url} label="Foto opgehaald van de website" /><dl className={styles.facts}>{['start', 'end', 'location'].map(key => <div key={key}><dt>{labels[key]}</dt><dd>{web[key]?.replace('T', ' ') || 'Niet opgehaald / niet opgegeven'}</dd></div>)}</dl><p className={styles.text}>{web.description || 'Geen omschrijving opgehaald.'}</p>{safeEventUrl(webCommon.website_url) && <a href={safeEventUrl(webCommon.website_url)} target="_blank" rel="noreferrer">Evenement op website openen</a>}<p className={styles.notice}>{differences.length ? `Verschil met opgeslagen Horeca OS: ${differences.map(key => labels[key]).join(', ')}.` : 'De opgehaalde gegevens komen overeen met Horeca OS.'}</p><button type="button" className="secondaryButton" disabled={disabled || checking} onClick={() => { change('title', web.title); change('description', web.description); }}>Website-tekst overnemen als bewerking</button><button type="button" className="secondaryButton" disabled={disabled || checking || !calendarEventTimes(website).valid} onClick={() => { change('start', web.start); change('end', web.end); }}>Websitetijden overnemen als bewerking</button><button type="button" className="secondaryButton" disabled={disabled || checking || !safeEventUrl(web.image_url)} onClick={() => change('image_url', web.image_url)}>Websitefoto als hoofdfoto overnemen</button></> : <p className={styles.notice}>{checking ? 'De websitegegevens worden gecontroleerd.' : 'Geen websitegegevens beschikbaar.'}</p>}</div></details>
    </div></details>
    <div className={styles.actions}>{[['website', 'Website bijwerken openen'], ['facebook', 'Facebook bijwerken openen'], ['calendar', 'Agenda controleren openen']].map(([channel, label]) => <button type="button" className="secondaryButton" key={channel} disabled={disabled || dirty} onClick={() => onOpenChannel?.(channel)}>{label}</button>)}</div>
  </section>;
}
