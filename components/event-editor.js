"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { calendarDistribution, calendarEventTimes } from '../lib/event-calendar';
import { eventEditorDraft, editorDifferences, imageRoles, safeEventUrl } from '../lib/event-editor';
import styles from './event-editor.module.css';

const imageSlots = [
  { key: 'landscape', label: 'Liggend', width: 1200, height: 630, ratio: '1,91:1', channels: 'Facebook, Google Bedrijfsprofiel en Brevo' },
  { key: 'square', label: 'Vierkant', width: 1080, height: 1080, ratio: '1:1', channels: 'Instagram, Facebook en Predis' },
  { key: 'portrait', label: 'Staand bericht', width: 1080, height: 1350, ratio: '4:5', channels: 'Instagram-feed' },
  { key: 'vertical', label: 'Story, Reel en TikTok', width: 1080, height: 1920, ratio: '9:16', channels: 'Stories, Reels, TikTok en WhatsApp Status' },
];
const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];

function Photo({ url, label }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return safeEventUrl(url) ? failed ? <p>Foto kon niet worden geladen.</p> : <Image unoptimized src={url} alt={label} width={500} height={360} className={styles.photo} onError={() => setFailed(true)} /> : <p>Geen foto opgegeven.</p>;
}
const labels = { title: 'Titel', description: 'Omschrijving', start: 'Begin', end: 'Einde', location: 'Locatie', ...imageRoles };
export default function EventEditor({ item, sources = [], checking, onRefresh, onSave, onUnsavedChange, onOpenChannel, onImageUpload, busy }) {
  const [base, setBase] = useState(item), [draft, setDraft] = useState(() => eventEditorDraft(item));
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [uploading, setUploading] = useState(''), [uploadMessage, setUploadMessage] = useState(''), [cropFocus, setCropFocus] = useState('center'), [draggingSlot, setDraggingSlot] = useState('');
  const lock = useRef(false), received = useRef(item), dirty = editorDifferences(eventEditorDraft(base), draft).length > 0;
  useEffect(() => { if (received.current === item) return; received.current = item; if (!dirty && !saving) { setBase(item); setDraft(eventEditorDraft(item)); } }, [item, dirty, saving]);
  useEffect(() => { onUnsavedChange?.(dirty || saving || Boolean(uploading)); }, [dirty, saving, uploading, onUnsavedChange]);
  useEffect(() => { if (typeof window === 'undefined') return; const warn = e => { e.preventDefault(); e.returnValue = ''; }; if (dirty || saving || uploading) window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, saving, uploading]);
  const website = sources.find(s => s.label === 'Eventin' && s.item?.business_id === item.business_id)?.item;
  const web = website ? eventEditorDraft(website) : null, webCommon = calendarDistribution(website).common || {};
  const differences = web ? editorDifferences(eventEditorDraft(item), web) : [];
  function change(key, value) { setDraft(v => ({ ...v, [key]: value })); setNotice(''); setError(''); }
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
      const sourceRatio = loaded.width / loaded.height;
      const targetRatio = slot.width / slot.height;
      const cropped = Math.abs(sourceRatio - targetRatio) / targetRatio > 0.01;
      let sourceX = 0, sourceY = 0, sourceWidth = loaded.width, sourceHeight = loaded.height;
      if (sourceRatio > targetRatio) { sourceWidth = loaded.height * targetRatio; sourceX = (loaded.width - sourceWidth) / 2; }
      else if (sourceRatio < targetRatio) { sourceHeight = loaded.width / targetRatio; sourceY = cropFocus === 'top' ? 0 : cropFocus === 'bottom' ? loaded.height - sourceHeight : (loaded.height - sourceHeight) / 2; }
      if (sourceWidth < slot.width || sourceHeight < slot.height) throw new Error(`${slot.label} heeft na het bijsnijden minimaal ${slot.width} × ${slot.height} bruikbare pixels nodig. Deze foto is ${loaded.width} × ${loaded.height} px.`);
      if (!cropped && loaded.width === slot.width && loaded.height === slot.height) return { file, width: loaded.width, height: loaded.height, cropped: false, resized: false };
      const canvas = document.createElement('canvas'); canvas.width = slot.width; canvas.height = slot.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('De afbeelding kon niet automatisch worden aangepast.');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(loaded.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, slot.width, slot.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, file.type, file.type === 'image/png' ? undefined : 0.92));
      if (!blob) throw new Error('De afbeelding kon niet automatisch worden aangepast.');
      const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const name = `${extension ? file.name.slice(0, -extension.length) : file.name}-${slot.width}x${slot.height}${extension}`;
      return { file: new File([blob], name, { type: file.type, lastModified: Date.now() }), width: slot.width, height: slot.height, cropped, resized: true };
    } finally { URL.revokeObjectURL(loaded.url); }
  }
  async function uploadSlot(slot, file) {
    const validation = validateImage(file);
    if (validation) return setUploadMessage(validation);
    if (!onImageUpload) return setUploadMessage('Afbeeldingen kunnen pas worden geüpload wanneer dit evenement is geladen.');
    setUploading(slot.key); setUploadMessage('');
    try {
      const prepared = await prepareImageForSlot(file, slot);
      const uploaded = await onImageUpload({ file: prepared.file, role: slot.key });
      if (!uploaded?.url) throw new Error('De opslag gaf geen bruikbare afbeeldingslink terug.');
      change(slot.key, uploaded.url);
      setUploadMessage(prepared.cropped ? `${slot.label} is aangepast naar ${slot.width} × ${slot.height} px. Bewaar daarna je evenement.` : `${slot.label} is geüpload. Bewaar daarna je evenement.`);
    } catch (e) { setUploadMessage(e.message || 'Uploaden is niet gelukt.'); }
    finally { setUploading(''); }
  }
  async function uploadAll(file) {
    const validation = validateImage(file);
    if (validation) return setUploadMessage(validation);
    if (!onImageUpload) return setUploadMessage('Afbeeldingen kunnen pas worden geüpload wanneer dit evenement is geladen.');
    setUploading('all'); setUploadMessage('');
    try {
      const original = await onImageUpload({ file, role: 'image_url' });
      if (!original?.url) throw new Error('De opslag gaf geen bruikbare afbeeldingslink terug.');
      const results = await Promise.allSettled(imageSlots.map(async slot => {
        const prepared = await prepareImageForSlot(file, slot);
        const uploaded = await onImageUpload({ file: prepared.file, role: slot.key });
        if (!uploaded?.url) throw new Error('Geen afbeeldingslink ontvangen.');
        return [slot.key, uploaded.url];
      }));
      const images = Object.fromEntries(results.filter(result => result.status === 'fulfilled').map(result => result.value));
      change('image_url', original.url); setDraft(current => ({ ...current, ...images }));
      const failed = results.length - Object.keys(images).length;
      setUploadMessage(failed ? `De originele Eventin-afbeelding en ${Object.keys(images).length} formaten zijn geüpload. ${failed} formaat/formats lukte niet; je kunt die hieronder opnieuw kiezen.` : 'De originele Eventin-afbeelding en alle vier formaten zijn geüpload. Bewaar daarna je evenement.');
    } catch (e) { setUploadMessage(e.message || 'Uploaden is niet gelukt.'); }
    finally { setUploading(''); }
  }
  function handleDrop(slot, event) { event.preventDefault(); setDraggingSlot(''); uploadSlot(slot, event.dataTransfer.files?.[0]); }
  function handleAllDrop(event) { event.preventDefault(); setDraggingSlot(''); uploadAll(event.dataTransfer.files?.[0]); }
  async function save() {
    if (lock.current || busy || !dirty) return;
    lock.current = true; setSaving(true); setError(''); setNotice('Evenement bewaren…');
    try { const saved = await onSave(base, draft); if (!saved) throw new Error('Opslaan kon niet worden bevestigd. Je wijzigingen blijven staan.'); setBase(saved); setDraft(eventEditorDraft(saved)); setNotice('Opgeslagen in Horeca OS. Er is niets gepubliceerd of gewijzigd op andere kanalen. Controleer hieronder welke kanalen je wilt bijwerken.'); }
    catch (e) { setNotice(''); setError(e.message || 'Opslaan mislukt. Je wijzigingen blijven staan.'); }
    finally { lock.current = false; setSaving(false); }
  }
  const disabled = busy || saving || Boolean(uploading);
  return <section className={styles.editor} aria-label="Evenement bekijken en bewerken">
    <p className={styles.notice}>Horeca OS is je basis. Bewerk en bewaar hier het evenement. De website, Facebook, Instagram en agenda worden pas via hun eigen acties bijgewerkt. Alle tijden zijn Nederlandse tijd.</p>
    {busy && <p role="status">Rond eerst de lopende actie of niet-opgeslagen kanaalvoorbereiding af. Daarna kun je de basis bewerken.</p>}
    {calendarDistribution(item).series && <p className={styles.notice}>Dit is een uitvoering van een reeks. Opslaan hier wijzigt alleen deze uitvoering en bewaart die als uitzondering. Gebruik ‘Reeks bekijken en wijzigen’ voor meerdere uitvoeringen.</p>}
    <>
      <div className={styles.panel}>
        <h4>Horeca OS — mijn evenement</h4>
        <div className={styles.horecaPreview}><strong>Foto in Horeca OS</strong><Photo url={draft.image_url} label="Foto in Horeca OS" /></div>
        <label>Titel<input value={draft.title} maxLength={300} disabled={disabled} onChange={e => change('title', e.target.value)} /></label>
        <label>Volledige omschrijving<textarea rows={9} value={draft.description} maxLength={30000} disabled={disabled} onChange={e => change('description', e.target.value)} /></label>
        <div className={styles.times}>{['start','end'].map(key => <label key={key}>{labels[key]} (Nederland)<input type={draft[key]?.length === 10 ? 'date' : 'datetime-local'} value={draft[key]} disabled={disabled} onChange={e => change(key,e.target.value)} />{draft[key]?.length === 10 && <button type="button" className="secondaryButton" disabled={disabled} onClick={() => change(key, draft[key] + 'T00:00')}>Tijd toevoegen</button>}</label>)}</div>
        <label>Locatie<input value={draft.location} disabled={disabled} onChange={e => change('location',e.target.value)} /></label>
        <section className={styles.imageUploads} aria-label="Afbeeldingen per kanaal">
          <div><strong>Afbeeldingen per kanaal</strong><p>Dezelfde keuzes als bij een nieuw evenement: één bronafbeelding voor alles, of per formaat een eigen flyer.</p></div>
          <article className={`${styles.eventinImageStatus} ${draft.image_url ? styles.ready : ''}`}><div><strong>Eventin-afbeelding</strong><span>{draft.image_url ? '✓ Gekozen en klaar voor Eventin' : 'Nog geen afbeelding gekozen'}</span><small>Deze originele afbeelding wordt voor Eventin gebruikt. De formaten hieronder staan daar los van.</small></div>{draft.image_url && <Photo url={draft.image_url} label="Eventin-afbeelding" />}</article>
          <label className={styles.cropFocus}>Focuspunt bij automatisch bijsnijden<select value={cropFocus} disabled={disabled || Boolean(uploading)} onChange={event => setCropFocus(event.target.value)}><option value="top">Boven — behoud gezichten of tekst bovenin</option><option value="center">Midden — standaard</option><option value="bottom">Onder — behoud tekst of details onderin</option></select><small>Horeca OS houdt dit deel zoveel mogelijk in beeld wanneer de verhoudingen verschillen.</small></label>
          <article className={`${styles.imageSlot} ${styles.imageSlotAll} ${draggingSlot === 'all' ? styles.dragging : ''}`} onDragEnter={event => { event.preventDefault(); setDraggingSlot('all'); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingSlot('all'); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingSlot(''); }} onDrop={handleAllDrop}><div><strong>Eén bronafbeelding voor alle formaten</strong><span>Horeca OS maakt automatisch 1,91:1, 1:1, 4:5 en 9:16</span><small>Je kunt elke uitsnede hieronder vervangen.</small></div><div className={styles.dropZone}><strong>{draggingSlot === 'all' ? 'Laat de bronafbeelding hier los' : 'Sleep één afbeelding hierheen'}</strong><small>of</small><label className={styles.uploadButton}>{uploading === 'all' ? 'Alle formaten maken…' : 'Bronafbeelding kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || Boolean(uploading) || !onImageUpload} onChange={event => uploadAll(event.target.files?.[0])} /></label></div></article>
          <div className={styles.imageSlotGrid}>{imageSlots.map(slot => <article className={`${styles.imageSlot} ${draggingSlot === slot.key ? styles.dragging : ''}`} key={slot.key} onDragEnter={event => { event.preventDefault(); setDraggingSlot(slot.key); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingSlot(slot.key); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingSlot(''); }} onDrop={event => handleDrop(slot, event)}><div><strong>{slot.label}</strong><span>{slot.width} × {slot.height} px · {slot.ratio}</span><small>{slot.channels}</small></div>{draft[slot.key] ? <div className={styles.uploadedImage}><Photo url={draft[slot.key]} label={slot.label} /><strong>✓ Upload gelukt</strong><small>Een nieuwe keuze vervangt alleen dit formaat.</small><label className={styles.uploadButton}>{uploading === slot.key ? 'Bezig met uploaden…' : 'Andere afbeelding kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || Boolean(uploading) || !onImageUpload} onChange={event => uploadSlot(slot, event.target.files?.[0])} /></label></div> : <div className={styles.dropZone}><strong>{draggingSlot === slot.key ? 'Laat de afbeelding hier los' : 'Sleep een afbeelding hierheen'}</strong><small>of</small><label className={styles.uploadButton}>{uploading === slot.key ? 'Bezig met uploaden…' : 'Afbeelding kiezen'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || Boolean(uploading) || !onImageUpload} onChange={event => uploadSlot(slot, event.target.files?.[0])} /></label></div>}</article>)}</div>
          <small>JPG, PNG of WebP · maximaal 10 MB per afbeelding. Een upload vervangt niets op Facebook, Eventin of andere kanalen totdat je hieronder bewaart.</small>
          {uploadMessage && <p role="status" className={styles.uploadMessage}>{uploadMessage}</p>}
        </section>
        <div className={styles.actions}><button type="button" className="primaryButton" disabled={disabled || !dirty} onClick={save}>{saving ? 'Evenement bewaren…' : 'Wijzigingen bewaren in Horeca OS'}</button><button type="button" className="secondaryButton" disabled={disabled || !dirty} onClick={() => { if (window.confirm('Je niet-opgeslagen wijzigingen terugzetten?')) { setBase(item); setDraft(eventEditorDraft(item)); setNotice('Niet-opgeslagen wijzigingen teruggezet.'); setError(''); } }}>Wijzigingen terugzetten</button></div>
        {dirty && <p role="status">Nog niet opgeslagen.</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <p role="alert">{error}</p>}
      </div>
      <div className={styles.panel}>
        <h4>Website (Eventin) — apart opgehaalde gegevens</h4>
        <button type="button" className="secondaryButton" disabled={disabled || checking || !onRefresh} onClick={onRefresh}>{checking ? 'Websitegegevens ophalen…' : 'Websitegegevens opnieuw ophalen'}</button>
        {web ? <>
          <p className={styles.notice}>{checking ? 'Nieuwe controle loopt; hieronder staan de laatst opgehaalde gegevens.' : 'Laatst opgehaalde websitegegevens; niet je onopgeslagen bewerkingen.'}</p>
          <strong>{web.title || 'Titel ontbreekt'}</strong><Photo url={web.image_url} label="Foto opgehaald van de website" />
          <dl className={styles.facts}>{['start','end','location'].map(key => <div key={key}><dt>{labels[key]}</dt><dd>{web[key]?.replace('T',' ') || 'Niet opgehaald / niet opgegeven'}</dd></div>)}</dl>
          <p className={styles.text}>{web.description || 'Geen omschrijving opgehaald.'}</p>
          {safeEventUrl(webCommon.website_url) && <a href={safeEventUrl(webCommon.website_url)} target="_blank" rel="noreferrer">Evenement op website openen</a>}
          <p className={styles.notice}>{differences.length ? `Verschil met opgeslagen Horeca OS: ${differences.map(k => labels[k]).join(', ')}. Ontbrekende websitevelden zijn niet automatisch leeg in Horeca OS.` : 'De opgehaalde gegevens komen overeen met Horeca OS.'}</p>
          <button type="button" className="secondaryButton" disabled={disabled || checking} onClick={() => { change('title', web.title); change('description',web.description); }}>Website-tekst overnemen als bewerking</button>
          <button type="button" className="secondaryButton" disabled={disabled || checking || !calendarEventTimes(website).valid} onClick={() => { change('start', web.start); change('end', web.end); }}>Websitetijden overnemen als bewerking</button>
          <button type="button" className="secondaryButton" disabled={disabled || checking || !safeEventUrl(web.image_url)} onClick={() => change('image_url',web.image_url)}>Websitefoto als hoofdfoto overnemen</button>
          <small>Overnemen is alleen een voorstel. Controleer het links en bewaar daarna in Horeca OS.</small>
        </> : <p className={styles.notice}>{checking ? 'De websitegegevens worden gecontroleerd.' : 'Geen websitegegevens beschikbaar. Haal de gekoppelde bron opnieuw op. Horeca OS-gegevens worden hier niet als websitegegevens getoond.'}</p>}
      </div>
    </>
    <div className={styles.actions}>{[['website','Website bijwerken openen'],['facebook','Facebook bijwerken openen'],['calendar','Agenda controleren openen']].map(([channel,label]) => <button type="button" className="secondaryButton" key={channel} disabled={disabled || dirty} onClick={() => onOpenChannel?.(channel)}>{label}</button>)}</div>
    <small>De bronvergelijking controleert titel en tekst. Controleer gewijzigde tijden, locatie en foto’s apart; de knop ‘Website bijwerken’ werkt alleen titel en tekst bij. Voor een Facebookfoto gebruik je ‘Foto overnemen — Facebook → Horeca OS → website’.</small>
  </section>;
}
