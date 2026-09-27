"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './event-editor.module.css';

function Photo({ url, label }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || !/^https:\/\//i.test(url)) return <p>Geen foto beschikbaar.</p>;
  return failed ? <p>Voorbeeld niet bereikbaar. Haal de foto opnieuw op.</p> : <Image unoptimized src={url} alt={label} width={600} height={400} className={styles.photo} onError={() => setFailed(true)} />;
}

export default function EventPhotoSync({ workspaceId, session, item, busy, onSaved, onBusyChange }) {
  const d = (item.media || []).find(m => m?.kind === 'campaign_distribution') || {};
  const [facebook, setFacebook] = useState(null), [website, setWebsite] = useState(null);
  const [working, setWorking] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setConfirmed(false); }, [item.updated_at]);
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
      if (action === 'website-preview') setWebsite(data.preview);
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
  return <section className={styles.editor} aria-label="Evenementfoto overnemen" aria-busy={working}>
    <p>Tekst en foto zijn afzonderlijke keuzes. Neem hier de hoofdfoto van het gekoppelde Facebook-evenement over. Andere fotoversies en geplaatste Instagramberichten blijven ongewijzigd. Bij een reeks geldt dit alleen voor deze uitvoering.</p>
    <div className={styles.columns}>
      <div className={styles.panel}><h4>1. Facebookfoto kiezen</h4>
        <button type="button" disabled={disabled} onClick={() => run('facebook-preview')}>Actuele Facebookfoto ophalen</button>
        {facebook && <><Photo url={facebook.url} label="Actuele Facebookfoto" /><button type="button" disabled={disabled} onClick={() => run('facebook-import')}>Facebookfoto bewaren in Horeca OS</button><p>Vervangt alleen de hoofdfoto hieronder. De website verandert nog niet.</p></>}
      </div>
      <div className={styles.panel}><h4>Hoofdfoto in Horeca OS</h4><Photo url={d.common?.image_url} label="Bewaarde hoofdfoto in Horeca OS" />
        <p>{imported ? 'Facebookfoto als eigen bestand bewaard.' : 'Bewaar eerst de gewenste Facebookfoto met de knop hiernaast.'}</p>
      </div>
    </div>
    <div className={styles.panel}><h4>2. Websitefoto vervangen</h4>
      <button type="button" disabled={disabled || !(d.eventin_event_id || d.external_ids?.eventin)} onClick={() => run('website-preview')}>Websitefoto controleren</button>
      {updated && <p className={styles.notice}>Deze Facebookfoto is op de website gezet en gecontroleerd.</p>}
      {job?.status === 'updating' && <p role="status">Foto-update gestart; controleer de websitefoto om het resultaat te bevestigen.</p>}
      {website && <><Photo url={website.url} label="Huidige hoofdfoto op de website" />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}><input style={{ width: 'auto' }} type="checkbox" checked={confirmed} disabled={disabled || !imported || job?.status === 'updating'} onChange={e => setConfirmed(e.target.checked)} />Ik wil de websitefoto van dit evenement vervangen door de hoofdfoto uit Horeca OS.</label>
        <button type="button" disabled={disabled || !imported || !confirmed || job?.status === 'updating'} onClick={() => run('website-publish')}>Deze foto op de website zetten</button>
      </>}
      <p>Dit verandert de website direct. Titel, tekst, datums en tickets blijven staan. Tekst werk je apart bij via ‘Website afzonderlijk bijwerken’.</p>
    </div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}{error && <p role="alert" className={styles.notice}>{error}</p>}
  </section>;
}
