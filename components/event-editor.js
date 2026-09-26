"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { calendarDistribution } from '../lib/event-calendar';
import { eventEditorDraft, editorDifferences, imageRoles, safeEventUrl } from '../lib/event-editor';
import { instagramEventMedia } from '../lib/instagram-event-media';
import styles from './event-editor.module.css';

function Photo({ url, label }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return safeEventUrl(url) ? failed ? <p>Foto kon niet worden geladen.</p> : <Image unoptimized src={url} alt={label} width={500} height={360} className={styles.photo} onError={() => setFailed(true)} /> : <p>Geen foto opgegeven.</p>;
}
const labels = { title: 'Titel', description: 'Omschrijving', start: 'Begin', end: 'Einde', location: 'Locatie', ...imageRoles };
export default function EventEditor({ item, sources = [], checking, onRefresh, onSave, onUnsavedChange, onOpenChannel, busy }) {
  const [base, setBase] = useState(item), [draft, setDraft] = useState(() => eventEditorDraft(item));
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [photoRole, setPhotoRole] = useState('image_url');
  const lock = useRef(false), received = useRef(item), dirty = editorDifferences(eventEditorDraft(base), draft).length > 0;
  useEffect(() => { if (received.current === item) return; received.current = item; if (!dirty && !saving) { setBase(item); setDraft(eventEditorDraft(item)); } }, [item, dirty, saving]);
  useEffect(() => { onUnsavedChange?.(dirty || saving); }, [dirty, saving, onUnsavedChange]);
  useEffect(() => { if (typeof window === 'undefined') return; const warn = e => { e.preventDefault(); e.returnValue = ''; }; if (dirty || saving) window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, saving]);
  const website = sources.find(s => s.label === 'Eventin' && s.item?.business_id === item.business_id)?.item;
  const web = website ? eventEditorDraft(website) : null, webCommon = calendarDistribution(website).common || {};
  const differences = web ? editorDifferences(eventEditorDraft(item), web) : [];
  const assets = instagramEventMedia(item).filter(a => a.type === 'image');
  function change(key, value) { setDraft(v => ({ ...v, [key]: value })); setNotice(''); setError(''); }
  async function save() {
    if (lock.current || busy || !dirty) return;
    lock.current = true; setSaving(true); setError(''); setNotice('Evenement bewaren…');
    try { const saved = await onSave(base, draft); if (!saved) throw new Error('Opslaan kon niet worden bevestigd. Je wijzigingen blijven staan.'); setBase(saved); setDraft(eventEditorDraft(saved)); setNotice('Opgeslagen in Horeca OS. Er is niets gepubliceerd of gewijzigd op andere kanalen. Controleer hieronder welke kanalen je wilt bijwerken.'); }
    catch (e) { setNotice(''); setError(e.message || 'Opslaan mislukt. Je wijzigingen blijven staan.'); }
    finally { lock.current = false; setSaving(false); }
  }
  const disabled = busy || saving;
  return <section className={styles.editor} aria-label="Evenement bekijken en bewerken">
    <p className={styles.notice}>Horeca OS is je basis. Bewerk en bewaar hier het evenement. De website, Facebook, Instagram en agenda worden pas via hun eigen acties bijgewerkt. Alle tijden zijn Nederlandse tijd.</p>
    {busy && <p role="status">Rond eerst de lopende actie of niet-opgeslagen kanaalvoorbereiding af. Daarna kun je de basis bewerken.</p>}
    {calendarDistribution(item).series && <p className={styles.notice}>Dit is een uitvoering van een reeks. Opslaan hier wijzigt alleen deze uitvoering en bewaart die als uitzondering. Gebruik ‘Reeks bekijken en wijzigen’ voor meerdere uitvoeringen.</p>}
    <div className={styles.columns}>
      <div className={styles.panel}>
        <h4>Horeca OS — mijn evenement</h4>
        <label>Titel<input value={draft.title} maxLength={300} disabled={disabled} onChange={e => change('title', e.target.value)} /></label>
        <label>Volledige omschrijving<textarea rows={9} value={draft.description} maxLength={30000} disabled={disabled} onChange={e => change('description', e.target.value)} /></label>
        <div className={styles.times}>{['start','end'].map(key => <label key={key}>{labels[key]} (Nederland)<input type={draft[key]?.length === 10 ? 'date' : 'datetime-local'} value={draft[key]} disabled={disabled} onChange={e => change(key,e.target.value)} />{draft[key]?.length === 10 && <button type="button" className="secondaryButton" disabled={disabled} onClick={() => change(key, draft[key] + 'T00:00')}>Tijd toevoegen</button>}</label>)}</div>
        <label>Locatie<input value={draft.location} disabled={disabled} onChange={e => change('location',e.target.value)} /></label>
        <h4>Foto’s in Horeca OS</h4>
        <label>Welke foto aanpassen?<select value={photoRole} disabled={disabled} onChange={e => setPhotoRole(e.target.value)}>{Object.entries(imageRoles).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <Photo url={draft[photoRole]} label={imageRoles[photoRole]} />
        <label>{imageRoles[photoRole]} — fotolink<input type="url" value={draft[photoRole]} disabled={disabled} onChange={e => change(photoRole,e.target.value)} /></label>
        <small>Een andere foto kiezen verandert alleen deze fotoversie. Andere versies en al geplaatste berichten blijven behouden.</small>
        <details><summary>Beschikbare foto’s van dit evenement ({assets.length})</summary><div className={styles.media}>{assets.map(a => <figure key={a.url}><Photo url={a.url} label={a.label} /><figcaption>{a.label}</figcaption><button type="button" className="secondaryButton" disabled={disabled} onClick={() => change(photoRole,a.url)}>Als {imageRoles[photoRole].toLowerCase()} gebruiken</button></figure>)}</div></details>
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
          <button type="button" className="secondaryButton" disabled={disabled || checking || !safeEventUrl(web.image_url)} onClick={() => change(photoRole,web.image_url)}>Websitefoto als {imageRoles[photoRole].toLowerCase()} overnemen</button>
          <small>Overnemen is alleen een voorstel. Controleer het links en bewaar daarna in Horeca OS.</small>
        </> : <p className={styles.notice}>{checking ? 'De websitegegevens worden gecontroleerd.' : 'Geen websitegegevens beschikbaar. Haal de gekoppelde bron opnieuw op. Horeca OS-gegevens worden hier niet als websitegegevens getoond.'}</p>}
      </div>
    </div>
    <div className={styles.actions}>{[['website','Website bijwerken openen'],['facebook','Facebook bijwerken openen'],['calendar','Agenda controleren openen']].map(([channel,label]) => <button type="button" className="secondaryButton" key={channel} disabled={disabled || dirty} onClick={() => onOpenChannel?.(channel)}>{label}</button>)}</div>
    <small>De bronvergelijking controleert titel en tekst. Controleer gewijzigde tijden, locatie en foto’s apart; de bestaande websiteknop werkt alleen titel en tekst bij.</small>
  </section>;
}
