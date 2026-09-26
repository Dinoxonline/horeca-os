"use client";
import {useEffect,useRef,useState} from 'react';
import {seriesDistribution as dist,seriesInitial,seriesDates} from '../lib/event-series';
import styles from './manual-predis.module.css';
const days=['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
const labels={title:'Titel',description:'Omschrijving',location:'Locatie',start:'Begin',end:'Einde'};
const showDate=v=>v?new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium',...(v.includes('T')?{timeStyle:'short'}:{})}).format(new Date(v.includes('T')?v:v+'T12:00:00')):'—';
export default function EventSeries({item,workspaceId,session,enabled,onSaved,onOpen,onUnsavedChange}){
 const initial=seriesInitial(item),startDay=initial.date||new Date().toISOString().slice(0,10);
 const [rule,setRule]=useState(()=>({type:'weekly',interval:1,weekday:new Date(startDay+'T12:00:00Z').getUTCDay(),ordinal:-1,from:startDay,until:startDay.slice(0,4)+'-12-31',exclude:[]}));
 const [values,setValues]=useState(initial),[scope,setScope]=useState('one'),[fields,setFields]=useState(['title']),[includePast,setIncludePast]=useState(false),[includeExceptions,setIncludeExceptions]=useState(false);
 const [rows,setRows]=useState([item]),[definition,setDefinition]=useState(dist(item).series_definition||null),[preview,setPreview]=useState(null),[notice,setNotice]=useState(''),[failed,setFailed]=useState(false),[requestBusy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[dirty,setDirty]=useState(false),[loaded,setLoaded]=useState(false);
 const [websitePreview,setWebsitePreview]=useState(null),[websiteConfirmed,setWebsiteConfirmed]=useState(false),[batchBusy,setBatchBusy]=useState(false),[progress,setProgress]=useState('');
 const batchLock=useRef(false),stop=useRef(false),busy=requestBusy||batchBusy;
 const alive=useRef(true),lock=useRef(false),abort=useRef(null),latest=useRef({session,onSaved});latest.current={session,onSaved};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{onUnsavedChange?.(dirty||busy);return()=>onUnsavedChange?.(false);},[dirty,busy,onUnsavedChange]);
 useEffect(()=>{if(typeof window==='undefined')return;const warn=e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,busy]);
 const member=dist(rows.find(r=>r.id===item.id)||item).series;
 function change(fn){fn();setPreview(null);setConfirmed(false);setDirty(true);}
 async function run(action,extra={},internal=false){
  if(lock.current||(!internal&&batchLock.current)||!latest.current.session?.access_token)return;
  lock.current=true;setBusy(true);setFailed(false);setNotice('');abort.current=new AbortController();const timer=setTimeout(()=>abort.current?.abort(),55000);
  try{
   const r=await fetch('/api/marketing/event-series',{method:'POST',signal:abort.current.signal,headers:{Authorization:`Bearer ${latest.current.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({workspaceId,businessId:item.business_id,itemId:item.id,action,rule,startTime:values.startTime,endTime:values.endTime,scope,fields,values,includePast,includeExceptions,token:preview?.token,confirmed,...extra})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Reeks verwerken mislukt.');if(!alive.current)return;
   if(data.rows){setRows(data.rows);setDefinition(data.definition);setLoaded(true);latest.current.onSaved?.(data.rows);}
   if(data.row){setRows(old=>old.map(r=>r.id===data.row.id?data.row:r));latest.current.onSaved?.([data.row]);}
   if(action==='preview-website'){setWebsitePreview(data);if(!internal)setWebsiteConfirmed(false);}else if(action.startsWith('preview'))setPreview(data);else{setPreview(null);setConfirmed(false);if(action!=='get')setDirty(false);}
   setNotice(data.message||(action==='preview-website'?'Controleer hieronder de websiteplanning.':'Reeks geladen.'));if(data.failed?.length)setFailed(true);return data;
  }catch(e){if(alive.current){setFailed(true);setNotice(e.name==='AbortError'?'Geen volledige bevestiging ontvangen. Laad de reeks opnieuw; een deel kan al bewaard zijn.':e.message);setPreview(null);setConfirmed(false);}}
  finally{clearTimeout(timer);lock.current=false;if(alive.current)setBusy(false);}
 }
 async function publishWebsite(){
  if(batchLock.current||!websiteConfirmed||!websitePreview)return;
  batchLock.current=true;stop.current=false;setBatchBusy(true);
  const planned=[...websitePreview.changes];let done=0;
  try{
   for(const approved of planned){
    if(stop.current||!alive.current)break;
    setProgress(`${done} van ${planned.length} bevestigd — ${showDate(approved.date)} wordt verwerkt.`);
    const fresh=await run('preview-website',{},true);if(!fresh)break;
    const target=fresh.changes.find(p=>p.id===approved.id);
    if(!target)continue;
    if(JSON.stringify(target)!==JSON.stringify(approved)){setFailed(true);setNotice('De planning is tussentijds veranderd. Controleer een nieuw websitevoorstel.');break;}
    const result=await run('website-step',{targetId:target.id,token:fresh.token,confirmed:true},true);if(!result)break;done++;
   }
  }finally{
   batchLock.current=false;if(alive.current){setBatchBusy(false);setWebsiteConfirmed(false);setWebsitePreview(null);setProgress(`${done} van ${planned.length} uitvoeringen bevestigd. ${done===planned.length?'Websiteplanning afgerond.':'Resterende uitvoeringen zijn nog niet bevestigd. Bekijk de planning opnieuw.'}`);}
  }
 }
 useEffect(()=>{let cancelled=false;Promise.resolve().then(()=>{if(!cancelled&&enabled&&!loaded&&!lock.current)run('get');});return()=>{cancelled=true;};},[enabled,Boolean(session?.access_token)]);
 if(!enabled&&!loaded)return null;
 let dates=[];try{dates=seriesDates({...rule,exclude:[]});}catch{}
 return <section className={styles.root} aria-label="Evenementenreeks">
  <div className={styles.notice}><strong>{member?'Reeks beheren':'Van dit evenement een reeks maken'}</strong><p>Horeca OS bewaart iedere uitvoering apart, met eigen kanaalkoppelingen. Opslaan hieronder publiceert niets. Facebook-evenementen blijven een handmatige vervolgstap.</p></div>
  <button type="button" className="secondaryButton" disabled={busy} onClick={()=>run('get')}>{busy?'Reeks wordt verwerkt…':'Bewaarde reeks laden'}</button>
  {notice&&<p role={failed?'alert':'status'} className={failed?styles.error:styles.notice}>{notice}</p>}
  {definition?.state==='preparing'?<div className={styles.notice}><p>De voorbereiding is nog niet afgerond. Hervatten maakt geen tweede reeks.</p><label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ik wil deze voorbereiding afmaken.</label><button type="button" className="secondaryButton" disabled={!confirmed||busy} onClick={()=>run('resume')}>Voorbereiding hervatten</button></div>:<>
  {!member&&<fieldset className={styles.fields} disabled={busy}><legend>Herhaling en periode</legend>
   <p>Maak en bewaar eerst de eerste uitvoering via ‘Evenement of campagne maken’. Dit bestaande evenement wordt de eerste datum van de reeks, met behoud van zijn koppelingen.</p>
   <div className={styles.grid}><label>Herhaling<select value={rule.type} onChange={e=>change(()=>setRule({...rule,type:e.target.value}))}><option value="weekly">Wekelijks</option><option value="monthly">Maandelijks op een weekdag</option></select></label><label>Iedere hoeveel {rule.type==='weekly'?'weken':'maanden'}?<input type="number" min="1" max="12" value={rule.interval} onChange={e=>change(()=>setRule({...rule,interval:Number(e.target.value)}))}/></label>
   {rule.type==='monthly'&&<label>Welke weekdag in de maand?<select value={rule.ordinal} onChange={e=>change(()=>setRule({...rule,ordinal:Number(e.target.value)}))}>{[[1,'Eerste'],[2,'Tweede'],[3,'Derde'],[4,'Vierde'],[-1,'Laatste']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>}
   <label>Weekdag<select value={rule.weekday} onChange={e=>change(()=>setRule({...rule,weekday:Number(e.target.value)}))}>{days.map((d,i)=><option key={i} value={i}>{d}</option>)}</select></label>
   <label>Vanaf<input type="date" value={rule.from} onChange={e=>change(()=>setRule({...rule,from:e.target.value}))}/></label><label>Tot en met<input type="date" value={rule.until} onChange={e=>change(()=>setRule({...rule,until:e.target.value}))}/></label></div>
   <details><summary>Datums overslaan — vakantie of uitzondering</summary><div className={styles.media}>{dates.map(d=><label key={d} className={styles.check}><input type="checkbox" checked={rule.exclude.includes(d)} onChange={e=>change(()=>setRule({...rule,exclude:e.target.checked?[...rule.exclude,d]:rule.exclude.filter(x=>x!==d)}))}/>{d} overslaan</label>)}</div></details>
  </fieldset>}
  {member&&<><div className={styles.tableWrap}><table><caption>Uitvoeringen en vervolgstappen per kanaal</caption><thead><tr><th>Datum</th><th>Uitvoering</th><th>Website</th><th>Facebook</th><th>Info-agenda</th><th>Actie</th></tr></thead><tbody>{rows.map(r=>{const d=dist(r);return <tr key={r.id}><td>{seriesInitial(r).date}</td><td>{d.common?.title}{d.series?.exception?' · Uitzondering':''}{d.series?.cancelled?' · Geannuleerd in Horeca OS':''}</td><td>{d.series_channel_tasks?.website||(d.eventin_event_id?'Gekoppeld · controleren':'Nog plaatsen')}</td><td>{d.series_channel_tasks?.facebook||'Handmatig controleren'}</td><td>{d.series_channel_tasks?.calendar||'Controleren'}</td><td><button type="button" className="secondaryButton" disabled={busy||r.id===item.id} onClick={()=>{if(!dirty||window.confirm('Je wijzigingsvoorstel is nog niet bewaard. Toch een andere uitvoering openen?'))onOpen?.(r);}}>Uitvoering openen</button></td></tr>;})}</tbody></table></div>
   <fieldset className={styles.fields} disabled={busy}><legend>Welke uitvoeringen wijzigen?</legend><select aria-label="Wijziging toepassen op" value={scope} onChange={e=>change(()=>{setScope(e.target.value);setFields(f=>e.target.value==='one'?f:f.filter(x=>x!=='date'));})}><option value="one">Alleen deze uitvoering</option><option value="following">Deze en alle volgende uitvoeringen</option><option value="all">De hele reeks</option></select>
   <label className={styles.check}><input type="checkbox" checked={includePast} onChange={e=>change(()=>setIncludePast(e.target.checked))}/>Ook eerdere uitvoeringen wijzigen</label><label className={styles.check}><input type="checkbox" checked={includeExceptions} onChange={e=>change(()=>setIncludeExceptions(e.target.checked))}/>Ook eerder gemaakte uitzonderingen wijzigen</label>
   <div className={styles.choices}>{[['title','Titel'],['description','Omschrijving'],['location','Locatie'],['times','Tijden'],...(scope==='one'?[['date','Datum verplaatsen']]:[]),['cancelled','Annuleren / herstellen']].map(([key,label])=><label key={key} className={styles.check}><input type="checkbox" checked={fields.includes(key)} onChange={e=>change(()=>setFields(e.target.checked?[...fields,key]:fields.filter(f=>f!==key)))}/>{label}</label>)}</div></fieldset></>}
  <fieldset className={styles.fields} disabled={busy}><legend>{member?'Nieuwe gegevens':'Tijden van de reeks'}</legend>
   {member&&fields.includes('title')&&<label>Titel<input value={values.title} onChange={e=>change(()=>setValues({...values,title:e.target.value}))}/></label>}
   {member&&fields.includes('description')&&<label>Omschrijving<textarea rows={5} value={values.description} onChange={e=>change(()=>setValues({...values,description:e.target.value}))}/></label>}
   {member&&fields.includes('location')&&<label>Locatie<input value={values.location} onChange={e=>change(()=>setValues({...values,location:e.target.value}))}/></label>}
   {(!member||fields.includes('times'))&&<div className={styles.grid}><label>Begintijd (Nederland)<input type="time" value={values.startTime} onChange={e=>change(()=>setValues({...values,startTime:e.target.value}))}/></label><label>Eindtijd (Nederland)<input type="time" value={values.endTime} onChange={e=>change(()=>setValues({...values,endTime:e.target.value}))}/></label><small>Een eindtijd vóór de begintijd valt op de volgende dag. De lokale tijd blijft gelijk bij zomer- en wintertijd.</small></div>}
   {member&&fields.includes('date')&&<label>Nieuwe datum<input type="date" value={values.date} onChange={e=>change(()=>setValues({...values,date:e.target.value}))}/></label>}
   {member&&fields.includes('cancelled')&&<label>Status<select value={values.cancelled?'cancelled':'active'} onChange={e=>change(()=>setValues({...values,cancelled:e.target.value==='cancelled'}))}><option value="active">Actief / herstellen</option><option value="cancelled">Annuleren in Horeca OS</option></select></label>}
   <button type="button" className="secondaryButton" disabled={!loaded} onClick={()=>run(member?'preview-change':'preview-create')}>Voorbeeld van {member?'wijzigingen':'alle datums'} bekijken</button>
  </fieldset>
  {preview&&<div className={styles.notice}><strong>{preview.occurrences?.length??preview.changes?.length??0} uitvoeringen {member?'wijzigen':'voorbereiden'}</strong><p>{preview.message}</p><div className={styles.tableWrap}><table><thead><tr><th>Datum</th><th>{member?'Voor → na':'Tijden'}</th></tr></thead><tbody>{(preview.occurrences||preview.changes||[]).map(p=><tr key={p.id||p.date}><td>{showDate(p.date)}</td><td>{p.after?<>{Object.keys(labels).filter(k=>p.before[k]!==p.after[k]).map(k=><div key={k}><strong>{labels[k]}</strong><p>Was: {k==="start"||k==="end"?showDate(p.before[k]):p.before[k]||"—"}</p><p>Wordt: {k==="start"||k==="end"?showDate(p.after[k]):p.after[k]||"—"}</p></div>)}{p.beforeCancelled!==p.cancelled&&<p>Status: {p.beforeCancelled?"geannuleerd":"actief"} → {p.cancelled?"geannuleerd":"actief"}</p>}</>: `${showDate(p.start)} – ${showDate(p.end)}`}</td></tr>)}</tbody></table></div>
   {preview.skipped?.length>0&&<p>{preview.skipped.length} overgeslagen: verleden of beschermde uitzonderingen.</p>}
   {preview.warnings?.map(w=><p key={w} role="alert">{w}</p>)}
   <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ik heb dit overzicht gecontroleerd. Bewaren wijzigt alleen Horeca OS; de kanalen moeten daarna worden bijgewerkt.</label>
   <button type="button" className="secondaryButton" disabled={!confirmed||busy||!(preview.occurrences?.length||preview.changes?.length)} onClick={()=>run(member?'change':'create')}>{member?'Deze wijzigingen bewaren':'Reeks bewaren in Horeca OS'}</button>
  </div>}
  </>}
 {member&&definition?.state==='ready'&&<section className={styles.notice} aria-label="Reeks op de website plaatsen"><h4>Vervolgstap: websiteplanning</h4><p>Bekijk alle toekomstige uitvoeringen die nog moeten worden geplaatst of gewijzigd. Nieuwe uitvoeringen worden openbaar gepubliceerd, zonder ticketverkoop. Bestaande website-evenementen behouden hun tickets, afbeelding en publicatiestatus. Afwijkende locaties en annuleringen handel je per uitvoering af.</p><p>Controleer ook de omschrijving en foto: een datum die daarin geschreven staat, verandert niet automatisch mee.</p><button type="button" className="secondaryButton" disabled={busy||dirty} onClick={()=>run('preview-website')}>Websiteplanning bekijken</button>{dirty&&<small>Bewaar eerst je wijzigingen of laad de pagina opnieuw om het voorstel te verwerpen.</small>}
 {websitePreview&&<><div className={styles.tableWrap}><table><thead><tr><th>Datum</th><th>Titel</th><th>Websiteactie</th></tr></thead><tbody>{websitePreview.changes.map(p=><tr key={p.id}><td>{showDate(p.start)}<br/>{showDate(p.end)}</td><td>{p.title}<br/>{p.location}</td><td>{p.blocked?'Eerdere plaatsing onzeker — eerst controleren':p.action}</td></tr>)}</tbody></table></div><p>{websitePreview.changes.length} uitvoeringen klaar voor controle. {websitePreview.skipped.length} eerdere of geannuleerde uitvoeringen worden overgeslagen.</p><label className={styles.check}><input type="checkbox" disabled={busy} checked={websiteConfirmed} onChange={e=>setWebsiteConfirmed(e.target.checked)}/>Ik heb datums, tekst en media gecontroleerd. Ik wil deze websiteacties nu uitvoeren; nieuwe uitvoeringen krijgen geen tickets.</label><button type="button" className="secondaryButton" disabled={busy||!websiteConfirmed||!websitePreview.changes.length||websitePreview.changes.some(p=>p.blocked)} onClick={publishWebsite}>Bevestigen en websiteplanning uitvoeren</button></>}
 {progress&&<p role="status">{progress}</p>}{batchBusy&&<button type="button" className="secondaryButton" onClick={()=>{stop.current=true;setProgress('Stop aangevraagd. De huidige uitvoering wordt eerst afgerond.');}}>Stop na deze uitvoering</button>}
 <p>Facebook: open de uitvoering om de tekst te kopiëren en het Facebook-evenement handmatig te controleren. Info-agenda: open de uitvoering en gebruik ‘Agenda info@leclubbbq.nl’. De lage zoekdrempel blijft alleen voor die agenda gelden.</p></section>}
 </section>;
}
