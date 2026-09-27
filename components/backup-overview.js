'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { databaseHealth, filesHealth } from '../lib/backup-status.mjs';
import styles from './backup-overview.module.css';

const date = value => value ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(value)) : 'Nog niet beschikbaar';
const size = value => `${(value / 1024 / 1024).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MB`;

export default function BackupOverview({ workspaceId }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoading(true); setError(''); setOverview(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Log opnieuw in om de back-ups te bekijken.');
        const response = await fetch(`/api/backups/status?workspaceId=${encodeURIComponent(workspaceId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'De controle is mislukt.');
        if (active) setOverview(result);
      } catch (failure) {
        if (active) setError(failure.name === 'AbortError' ? 'De controle duurt te lang. Probeer opnieuw.' : failure.message);
      } finally { clearTimeout(timeout); if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [workspaceId, refresh]);

  const db = overview?.database, files = overview?.files;
  const dbHealth = databaseHealth(db), fileHealth = filesHealth(files);
  return <section className={styles.overview} aria-labelledby="backup-title">
    <header className={styles.header}><div><p className="eyebrow">Beveiliging</p><h2 id="backup-title">Back-ups</h2><p>Database en bestanden, met afzonderlijke controles.</p></div>
      <button onClick={() => setRefresh(value => value + 1)} disabled={loading}>{loading ? 'Status ophalen…' : 'Status vernieuwen'}</button></header>
    {loading && <p role="status">De actuele back-upstatus wordt opgehaald.</p>}
    {error && <div className={`${styles.message} ${styles.danger}`} role="alert">{error} Er is geen actuele status bevestigd.</div>}
    {overview && <>
      <p className={styles.checked}>Gecontroleerd: {date(overview.checkedAt)} · Nederlandse tijd · Voor heel Horeca OS</p>
      <div className={styles.grid}>
        <article className={styles.card}><h3>Uurlijkse databasekopie</h3><p className={`${styles.message} ${styles[dbHealth.tone]}`}>{dbHealth.label}</p>
          <dl><dt>Laatste geslaagde kopie</dt><dd>{date(db.lastSuccess?.completed_at)}</dd><dt>Grootte</dt><dd>{db.lastSuccess ? size(db.lastSuccess.bytes) : 'Onbekend'}</dd><dt>Dropbox-ontvangst</dt><dd>Niet automatisch bevestigd in dit overzicht</dd></dl>
          <p>Een gecontroleerde lokale kopie is nog geen bevestiging dat Dropbox deze online heeft ontvangen.</p>
          <p>Bestemming: <strong>Horeca OS Backups / Automatisch</strong></p>
          <p>Deze computer, Codex en Dropbox moeten actief zijn. Na meer dan twee uur zonder geslaagde melding verschijnt een waarschuwing.</p>
        </article>
        <article className={styles.card}><h3>Foto’s en bijlagen</h3><p className={`${styles.message} ${styles[fileHealth.tone]}`}>{fileHealth.label}</p>
          <dl><dt>Door Dropbox bevestigde bestandsversies</dt><dd>{files.succeeded}</dd><dt>Wachten / bezig</dt><dd>{files.pending} / {files.processing}</dd><dt>Mislukt / vertraagd</dt><dd>{files.failed} / {files.overdue}</dd><dt>Laatste bevestigde kopie</dt><dd>{date(files.lastSuccessAt)}</dd></dl>
          <p>Nieuwe en gewijzigde bestanden gaan na upload automatisch naar Dropbox. Dit werkt ook als je computer uitstaat.</p>
          <p>Bestemming: <strong>Apps / Horeca OS Backups / Bestanden</strong></p>
          {files.wakeError && <p role="alert">Het starten van een bestandskopie is mislukt. Controle is nodig.</p>}
        </article>
      </div>
      <details className={styles.card}><summary>Laatste databasepogingen</summary>
        {!db.recent.length ? <p>Nog geen meldingen ontvangen van de back-upcomputer.</p> : <div className={styles.tableScroll}><table><thead><tr><th>Tijd</th><th>Resultaat</th><th>Grootte</th></tr></thead><tbody>{db.recent.map(run => <tr key={run.run_id}><td>{date(run.completed_at)}</td><td>{run.ok && run.copy_verified ? 'Lokaal gecontroleerd' : 'Mislukt — controle nodig'}</td><td>{size(run.bytes)}</td></tr>)}</tbody></table></div>}
      </details>
    </>}
    <section className={styles.card}><h3>Wat bewaren we?</h3><div className={styles.grid}><div><h4>Wel in deze eenvoudige back-up</h4><ul><li>Actuele bedrijfsgegevens en toepassingsschema’s: onder andere gasten, offertes en evenementen.</li><li>Bestanden uit marketing-assets en staff-ticket-attachments.</li><li>Versleutelde kopieën; bestaande kopieën worden niet automatisch verwijderd.</li></ul></div><div><h4>Niet inbegrepen</h4><ul><li>Inlogaccounts, wachtwoorden, geheime sleutels en volledige wijzigingsgeschiedenis.</li><li>Bestanden die alleen op WordPress of lokaal staan, waaronder niet-geüploade offertebestanden.</li><li>Een volledige herstelkopie van de hele Supabase-omgeving.</li></ul></div></div><p>De herstelsleutel blijft nodig om versleutelde kopieën te openen. Dit scherm is alleen een overzicht: er wordt niets teruggezet of verwijderd.</p></section>
  </section>;
}
