'use client';
import { useEffect,useState } from 'react';
import { supabase } from '../lib/supabase';
import { historySummary,restoreSummary,tableLabel } from '../lib/backup-history.mjs';
import styles from './backup-overview.module.css';
const date=v=>v?new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(new Date(v)):'Nog niet afgerond';
const size=v=>v===null?'—':`${(v/1024/1024).toLocaleString('nl-NL',{maximumFractionDigits:2})} MB`;
const state={pending:'Wacht op kopie',processing:'Bezig',succeeded:'Gekopieerd',failed:'Mislukt'};

export default function BackupHistory({workspaceId}){
 const [kind,setKind]=useState('database'),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[selected,setSelected]=useState(null);
 useEffect(()=>{
  let active=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  setLoading(true);setError('');setData(null);setSelected(null);
  (async()=>{
   try{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session)throw Error('Log opnieuw in om de lijst te bekijken.');
    const response=await fetch(`/api/backups/history?workspaceId=${encodeURIComponent(workspaceId)}&kind=${kind}&page=${page}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Ophalen mislukt.');
    if(active)setData(result);
   }catch(e){if(active)setError(e.name==='AbortError'?'Het ophalen duurt te lang. Probeer opnieuw.':e.message);}
   finally{clearTimeout(timer);if(active)setLoading(false);}
  })();
  return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[workspaceId,kind,page,refresh]);
 const chooseKind=value=>{setKind(value);setPage(0);};
 return <section className={styles.card} aria-labelledby="backup-history-title">
  <h3 id="backup-history-title">Back-uplijst en herstel</h3>
  <p>Alle geregistreerde databasepogingen en bestandskopieën, met afzonderlijke lijsten. Tijdstippen zijn Nederlandse tijd. Een geslaagde kopie is niet automatisch een geslaagd herstel.</p>
  <div className={styles.actions}>
   <button aria-pressed={kind==='database'} onClick={()=>chooseKind('database')}>Databaseback-ups</button>
   <button aria-pressed={kind==='files'} onClick={()=>chooseKind('files')}>Foto’s en bijlagen</button>
   <button disabled={loading} onClick={()=>setRefresh(v=>v+1)}>Lijst vernieuwen</button>
  </div>
  {loading&&<p role="status">Back-uplijst ophalen…</p>}
  {error&&<p role="alert" className={`${styles.message} ${styles.danger}`}>{error}</p>}
  {data&&<>
   <p>{data.total} geregistreerde {kind==='database'?'databasepogingen':'bestandsversies'} · Pagina {page+1} van {Math.max(1,Math.ceil(data.total/25))}</p>
   {kind==='database'&&data.latestSuccess&&<button onClick={()=>setSelected(data.latestSuccess)}>Laatste geslaagde back-up bekijken voor herstel</button>}
   {!data.items.length?<p>Geen back-ups op deze pagina.</p>:<div className={styles.tableScroll}><table>
    <thead><tr><th>Datum / tijd</th><th>{kind==='database'?'Resultaat':'Bestand'}</th><th>Grootte</th><th>{kind==='database'?'Wat is gewijzigd?':'Gebeurtenis / resultaat'}</th>{kind==='database'&&<th>Details</th>}</tr></thead>
    <tbody>{data.items.map(r=>kind==='database'?<tr key={r.run_id}>
     <td>{date(r.completed_at)}</td><td>{r.ok&&r.copy_verified?'Lokale kopie gecontroleerd':'Poging mislukt'}</td><td>{size(r.bytes)}</td><td>{historySummary(r.contentCheck)}</td><td><button onClick={()=>setSelected(r)}>Inhoud en herstel bekijken</button></td>
    </tr>:<tr key={r.id}>
     <td>{date(r.completedAt||r.createdAt)}</td><td className={styles.filename}>{r.name}<small>{r.bucket}</small></td><td>{size(r.bytes)}</td><td>{r.event==='UPDATE'?'Bijgewerkt bestand':r.event==='INSERT'?'Toegevoegd bestand':'Bestandskopie'} · {r.cloudConfirmed?'Dropbox-ontvangst bevestigd':state[r.status]||'Onbekend'}</td>
    </tr>)}</tbody>
   </table></div>}
   <div className={styles.actions}><button disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Vorige pagina</button><button disabled={loading||(page+1)*25>=data.total} onClick={()=>setPage(p=>p+1)}>Volgende pagina</button></div>
   <p>De bestandsgrootte zegt niet welke gegevens zijn gewijzigd. Bestandskopieën worden afzonderlijk gemaakt; dit is geen volledige gezamenlijke momentopname.</p>
  </>}
  {selected&&<section className={styles.selection} aria-labelledby="restore-selection-title">
   <h4 id="restore-selection-title">Gekozen back-up: {date(selected.completed_at)}</h4>
   <p>Begonnen: {date(selected.started_at)}. De precieze database-momentopname ligt binnen deze exportperiode.</p>
   <h4>Wijzigingen</h4><p>{historySummary(selected.contentCheck)}</p>
   {selected.contentCheck&&<>
    <p>{selected.contentCheck.table_count} tabellen onderzocht. {selected.contentCheck.compared_to&&<>Vergelijking met back-up <code>{selected.contentCheck.compared_to}</code>.</>}</p>
    {!!selected.contentCheck.changes.length&&<ul>{selected.contentCheck.changes.map(c=><li key={c.table}><strong>{tableLabel(c.table)}</strong>: {c.state==='added'?'onderdeel toegevoegd':c.state==='removed'?'onderdeel verdwenen':'inhoud gewijzigd'}; aantal records {c.before??'—'} → {c.after??'—'}.</li>)}</ul>}
    <p>Vergelijking van opgeslagen tabelinhoud, niet van opmaak, databasefuncties, rechten, foto’s of de volledige wijzigingsgeschiedenis. ‘Geen wijziging’ geldt alleen voor de vergeleken tabelinhoud. Bijgewerkte regels kunnen hetzelfde aantal behouden.</p>
   </>}
   <h4>Terugzetten</h4>
   <p className={`${styles.message} ${styles.warning}`}>{restoreSummary(selected.restoreCheck)}</p>
   {selected.restoreCheck&&<p>Proefherstel gecontroleerd op {date(selected.restoreCheck.checked_at)}. De productiegegevens zijn niet gewijzigd.</p>}
   <p>Deze eenvoudige databasekopie bevat bedrijfsgegevens, maar geen inlogaccounts of bestanden. Voor ‘alles terugzetten’ zijn een geslaagd proefherstel, passende bestandsversies en een veiligheidskopie van de huidige gegevens nodig.</p>
   <button disabled aria-describedby="restore-blocked-reason">Terugzetten nog niet beschikbaar</button>
   <p id="restore-blocked-reason">Volledig herstel is nog niet vrijgegeven. Deze keuze bewaart of overschrijft niets.</p>
   <button onClick={()=>setSelected(null)}>Details sluiten</button>
  </section>}
 </section>;
}
