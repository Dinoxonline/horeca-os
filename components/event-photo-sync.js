"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './event-editor.module.css';

export function EventPhoto({ url, label }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || !/^https:\/\//i.test(url)) return <p>Geen foto beschikbaar.</p>;
  return failed ? <p>Voorbeeld niet bereikbaar. Haal de foto opnieuw op.</p> : <Image unoptimized src={url} alt={label} width={600} height={400} className={styles.photo} onError={() => setFailed(true)} />;
}

export default function EventPhotoSync({ workspaceId, session, item, busy, onSaved, onBusyChange, mode = 'facebook', onOpenWebsite }) {
  const d = (item.media || []).find(m => m?.kind === 'campaign_distribution') || {};
  const [facebook, setFacebook] = useState(null), [website, setWebsite] = useState(null);
  const [working, setWorking] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setConfirmed(false);
    // A status reconciliation may return an updated item and its fresh preview together.
    setWebsite(current => current?.itemRevision === item.updated_at ? current : null);
  }, [item.updated_at]);
  useEffect(() => { onBusyChange?.(working); }, [working, onBusyChange]);
  useEffect(() => {
    if (!working) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working]);
  async function run(action) {
    if (lock.current || busy) return;
    if (action === 'website-publish' && !confirmed) return;
    lock.current = true; setWorking(true); setError(''); setNotice('Foto wordt gecontroleerd…');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch('/api/marketing/event-photo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, signal: controller.signal,
        body: JSON.stringify({ workspaceId, businessId: item.business_id, itemId: item.id, action, revision: item.updated_at, hash: facebook?.hash, websiteVersion: website?.version, confirmed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'De foto kon niet worden verwerkt.');
      if (!mounted.current) return;
      if (data.item) onSaved?.(data.item);
      if (action === 'facebook-preview') setFacebook(data.preview);
      if (action === 'website-preview') setWebsite({ ...data.preview, itemRevision: data.item?.updated_at || item.updated_at });
      if (action === 'facebook-import' || action === 'website-publish') { setWebsite(null); setConfirmed(false); }
      setNotice(data.message || (action === 'facebook-preview' ? 'Dit is de huidige foto van het gekoppelde Facebook-evenement. Er is nog niets overgenomen.' : 'Huidige websitefoto opgehaald. Er is geen nieuwe foto gepubliceerd.'));
    } catch (e) {
      if (mounted.current) { setError(e.name === 'AbortError' ? 'Het verzoek duurt te lang. Ververs het evenement en controleer de foto vóór je opnieuw probeert.' : e.message); setNotice(''); setConfirmed(false); }
    } finally { clearTimeout(timer); lock.current = false; if (mounted.current) setWorking(false); }
  }
  const disabled = busy || working;
  const imported = d.event_photo_import?.url === d.common?.image_url && Boolean(d.event_photo_import?.hash);
  const job = d.event_photo_website;
  const updated = imported && job?.status === 'updated' && job.hash === d.event_photo_import.hash && job.targetId === String(d.eventin_event_id || d.external_ids?.eventin || '');
  return <section className={styles.editor} aria-label={mode === 'facebook' ? 'Facebookfoto kiezen' : 'Websitefoto vervangen'} aria-busy={working}>
    {mode === 'facebook' ? <div className={styles.panel}>
      <h4>Foto van Facebook</h4>
      <button className="secondaryButton" type="button" disabled={disabled} onClick={() => run('facebook-preview')}>Actuele Facebookfoto ophalen</button>
      {facebook && <><EventPhoto url={facebook.url} label="Te kiezen Facebookfoto" /><button className="primaryButton" type="button" disabled={disabled} onClick={() => run('facebook-import')}>Deze foto gebruiken</button><p>Deze foto bewaren als hoofdfoto in Horeca OS. De website verandert nog niet.</p></>}
      {imported && <p role="status">De gekozen Facebookfoto is bewaard in Horeca OS.</p>}
      {imported && onOpenWebsite && <button className="secondaryButton" type="button" disabled={disabled} onClick={onOpenWebsite}>Verder naar website bijwerken</button>}
    </div> : <div className={styles.panel}><h4>Foto op de website bijwerken</h4>
      <button className="secondaryButton" type="button" disabled={disabled || !(d.eventin_event_id || d.external_ids?.eventin)} onClick={() => run('website-preview')}>Websitefoto controleren</button>
      {updated && <p className={styles.notice}>Deze Facebookfoto is op de website gezet en gecontroleerd.</p>}
      {job?.status === 'updating' && <p role="status">Foto-update gestart; controleer de websitefoto om het resultaat te bevestigen.</p>}
      <div className={styles.columns}>
        <div className={styles.panel}><h4>Nu op de website — wordt vervangen</h4>{website ? <EventPhoto url={website.url} label="Oude foto op de website — wordt vervangen" /> : <p>Klik op ‘Websitefoto controleren’ om de huidige foto te zien.</p>}</div>
        <div className={styles.panel}><h4>Nieuwe foto uit Horeca OS — wordt geplaatst</h4><EventPhoto url={d.common?.image_url} label="Nieuwe foto uit Horeca OS — deze wordt op de website gezet" />
          {!imported && <p>Kies eerst ‘Deze foto gebruiken’ bij de Facebook-bron.</p>}
        </div>
      </div>
      {website && <>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}><input style={{ width: 'auto' }} type="checkbox" checked={confirmed} disabled={disabled || !imported || job?.status === 'updating'} onChange={e => setConfirmed(e.target.checked)} />Ik wil de oude websitefoto vervangen door de hierboven getoonde nieuwe foto uit Horeca OS.</label>
        <button className="primaryButton" type="button" disabled={disabled || !imported || !confirmed || job?.status === 'updating'} onClick={() => run('website-publish')}>Nieuwe foto uit Horeca OS op de website zetten</button>
      </>}
      <p>Alleen de foto wordt vervangen. Gebruik de tekstknop in ditzelfde websitegedeelte om ook de tekst bij te werken. Datums en tickets blijven staan.</p>
    </div>}
    <small>Andere fotoversies en geplaatste Instagramberichten blijven ongewijzigd. Bij een reeks geldt dit alleen voor deze uitvoering.</small>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <p role="alert" className={styles.notice}>{error}</p>}
  </section>;
}
