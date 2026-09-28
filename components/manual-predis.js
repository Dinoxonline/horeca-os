"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { instagramEventMedia } from "../lib/instagram-event-media";
import { PREDIS_CHANNELS, PREDIS_STATES, PREDIS_DAYS, localToday, makeManualEntries, validateManualDraft, transferText, manualDistribution, retainedConfirmations } from "../lib/manual-predis";
import styles from "./manual-predis.module.css";

export default function ManualPredis({ item, workspaceId, session, businessName, enabled, linkedSources = [], onSaved, onUnsavedChange, generatedContent, onGeneratedContentApplied }) {
  const dist = manualDistribution(item) || {};
  const initial = () => ({ caption: dist.common?.description || item.body || dist.common?.title || "", assets: [], entries: [], timezone: "Europe/Amsterdam" });
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [planningFeedback, setPlanningFeedback] = useState(null);
  const [mode, setMode] = useState("single");
  const [start, setStart] = useState(localToday);
  const [end, setEnd] = useState(localToday);
  const [time, setTime] = useState("10:00");
  const [days, setDays] = useState([3]);
  const [channels, setChannels] = useState([]);
  const [entryKey, setEntryKey] = useState("");
  const [state, setState] = useState("scheduled");
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true), lock = useRef(false), requests = useRef(new Set());
  const usedContent = useRef(null);
  const tokenRef = useRef(session?.access_token); tokenRef.current = session?.access_token;
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const assets = instagramEventMedia(item, linkedSources);
  const availableAssets = [...assets, ...draft.assets.filter(a => !assets.some(x => x.url === a.url))];
  const hasToken = Boolean(session?.access_token);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.current.forEach(c => c.abort()); }; }, []);
  useEffect(() => { onUnsavedChange?.(dirty || Boolean(busy)); return () => onUnsavedChange?.(false); }, [dirty, busy, onUnsavedChange]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const warn = event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  async function request(action, extra = {}) {
    const context = { workspaceId, businessId: item.business_id, itemId: item.id };
    const controller = new AbortController(); requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/marketing/manual-predis${action ? "" : "?" + new URLSearchParams(context)}`, {
        method: action ? "POST" : "GET", signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${tokenRef.current || ""}`, "Content-Type": "application/json" },
        ...(action ? { body: JSON.stringify({ ...context, action, expectedRevision: saved?.revision || null, ...extra }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Deze actie is niet gelukt.");
      return data.saved;
    } finally { clearTimeout(timer); requests.current.delete(controller); }
  }
  async function run(label, fn) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setFailed(false); setMessage("");
    try { await fn(); }
    catch (e) { if (mounted.current) { setFailed(true); setMessage(e.name === "AbortError" ? "Geen bevestiging ontvangen. Je invoer blijft staan. Controleer de bewaarde versie voordat je opnieuw handelt." : e.message); } }
    finally { lock.current = false; if (mounted.current) setBusy(""); }
  }
  function accept(next) {
    if (!mounted.current) return;
    setSaved(next); setDraft(next?.draft || initial()); setLoaded(true); setDirty(false); setConfirmed(false); setPlanningFeedback(null); onSavedRef.current?.(next);
  }
  function load() { return run("Voorbereiding laden…", async () => { const next = await request(); accept(next); }); }
  useEffect(() => { if (enabled && hasToken && !loaded && !lock.current) load(); }, [enabled, hasToken]); // Token refresh must not discard input.
  useEffect(() => {
    if (!loaded || !generatedContent || usedContent.current === generatedContent.id) return;
    usedContent.current = generatedContent.id;
    setDraft(current => ({ ...current, caption: generatedContent.caption, assets: generatedContent.assets }));
    setDirty(true); setConfirmed(false); setMessage("Predis-content overgenomen in je voorbereiding. Bewaar hieronder; er is nog niets ingepland of gepubliceerd.");
    onGeneratedContentApplied?.();
  }, [loaded, generatedContent]);
  function change(next) { setDraft(next); setDirty(true); setConfirmed(false); setMessage(""); setPlanningFeedback(null); }
  let preview = [], previewError = "";
  try {
    preview = makeManualEntries({ start, end: mode === "single" ? start : end, time, weekdays: mode === "weekly" ? days : undefined, channels });
    if (!preview.length) previewError = "Geen gekozen weekdagen in deze periode.";
    if (new Set([...draft.entries, ...preview].map(e => e.key)).size > 160) previewError = "Maximaal 160 kanaalmomenten per evenement. Kies een kortere periode of minder kanalen.";
  } catch (e) { previewError = e.message; }
  const previewDates = [...new Set(preview.map(e => e.at))];
  const newMoments = preview.filter(e => !draft.entries.some(old => old.key === e.key)).length;
  const fullDays = { 1: "Maandag", 2: "Dinsdag", 3: "Woensdag", 4: "Donderdag", 5: "Vrijdag", 6: "Zaterdag", 0: "Zondag" };
  function addMoments() {
    try {
      const next = makeManualEntries({ start, end: mode === "single" ? start : end, time, weekdays: mode === "weekly" ? days : undefined, channels });
      if (!next.length) throw new Error("Geen gekozen weekdagen in deze periode.");
      const unique = new Map([...draft.entries, ...next].map(e => [e.key, e]));
      const added = unique.size - draft.entries.length;
      if (added) change(validateManualDraft({ ...draft, entries: [...unique.values()] }));
      setPlanningFeedback({ error: false, text: added ? `${added} kanaalmomenten toegevoegd aan je concept. Klik op ‘Concept bewaren’ om deze gewenste datums te bewaren; dit plant niets in Predis in.` : "Deze momenten staan al in de lijst hieronder. Er zijn geen dubbele momenten toegevoegd." });
    } catch (e) { setPlanningFeedback({ error: true, text: `Niet toegevoegd: ${e.message}` }); }
  }
  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setFailed(false); setMessage(`${label} gekopieerd. Er is niets ingepland of gepubliceerd.`); }
    catch { setFailed(true); setMessage("Kopiëren is geblokkeerd. Selecteer de tekst en gebruik Ctrl+C."); }
  }
  function save() {
    let normalized;
    try { normalized = validateManualDraft(draft); } catch (e) { setFailed(true); setMessage(e.message); return; }
    const kept = retainedConfirmations(saved, normalized);
    const reset = Object.keys(saved?.confirmations || {}).some(key => !kept[key]);
    if (reset && !window.confirm("Je wijzigt eerder bevestigde inhoud of momenten. De betrokken bevestigingen worden opnieuw ‘Nog overzetten’. Pas deze ook zelf in Predis aan. Doorgaan?")) return;
    return run("Concept bewaren…", async () => { const next = await request("save", { draft: normalized, acceptReset: reset }); accept(next); if (mounted.current) setMessage("Concept bewaard in Horeca OS. Er is niets naar Predis verstuurd. Ga verder bij stap 2; bevestig pas daarna de uitkomst bij stap 3."); });
  }
  const chosen = draft.entries.find(e => e.key === entryKey);
  if (!enabled && !loaded) return null;
  return <section className={styles.root} aria-label="Predis handmatig voorbereiden">
    <div className={styles.notice}><strong>Eigen foto en tekst · {businessName}</strong><p>Bereid hier je eigen beeld en bericht voor. Geen nieuw AI-ontwerp. In Predis zet je het bericht zelf klaar en kies je publiceren of inplannen.</p></div>
    {busy && <p role="status">{busy}</p>}
    {!loaded && message && <p role={failed ? "alert" : "status"} className={failed ? styles.error : styles.notice}>{message}</p>}
    {dirty && <small>Niet-bewaarde wijzigingen</small>}
    {!loaded && <p>Open of laad eerst de voorbereiding. Bij een laadfout blijft bewaren geblokkeerd.</p>}
    <fieldset disabled={!loaded || !!busy} className={styles.fields}>
      <legend>1. Bericht voorbereiden</legend>
      <strong>Kies je foto of video · {draft.assets.length}/10 gekozen</strong>
      <div className={styles.media} aria-label="Foto of video kiezen">{availableAssets.map(a => {
        const selectedIndex = draft.assets.findIndex(x => x.url === a.url);
        const selected = selectedIndex !== -1;
        return <div key={a.url} className={selected ? styles.selectedMedia : undefined}>
          <button type="button" className={styles.mediaChoice} aria-pressed={selected} aria-label={`${selected ? 'Deselecteer' : 'Kies'} ${a.label}`} disabled={!selected && draft.assets.length >= 10} onClick={() => change({ ...draft, assets: selected ? draft.assets.filter(x => x.url !== a.url) : [...draft.assets, { url: a.url, type: a.type, label: a.label }] })}>
            {a.type === "image" ? <Image unoptimized src={a.url} width={240} height={150} alt={a.label} /> : <video src={a.url} muted preload="metadata" />}
            <span>{selected ? `✓ Gekozen · ${selectedIndex + 1}` : "Kiezen"}</span><small>{a.label}</small>
          </button>
        </div>;
      })}</div>
      {!availableAssets.length && <p>Nog geen foto’s of video’s beschikbaar. Voeg eerst een bestand toe bij het evenement.</p>}
      <label>Je bericht<textarea rows={6} maxLength={10000} value={draft.caption} onChange={e => change({ ...draft, caption: e.target.value })} /></label>
      <small>Je bewerkt alleen dit bericht. Het evenement en bestaande publicaties blijven ongewijzigd.</small>
    </fieldset>
    <fieldset disabled={!loaded || !!busy} className={styles.fields} aria-label="Publicatiemomenten kiezen">
      <legend>Gewenste datums bij je concept (optioneel)</legend>
      <small>Wil je meteen publiceren? Je hoeft hier geen moment toe te voegen. Ga verder bij stap 2: je bericht maken en publiceren in Predis.</small>
      <div className={styles.choices} role="group" aria-label="Kanalen">{Object.entries(PREDIS_CHANNELS).map(([key, name]) => <label key={key}><input type="checkbox" checked={channels.includes(key)} onChange={() => setChannels(channels.includes(key) ? channels.filter(c => c !== key) : [...channels, key])} />{name}</label>)}</div>
      <div className={styles.grid}>
        <label>Planning kiezen<select value={mode} onChange={e => setMode(e.target.value)}><option value="single">Losse datum</option><option value="weekly">Elke week op vaste dagen</option></select></label>
        <label>{mode === "single" ? "Datum" : "Begindatum"}<input type="date" value={start} onChange={e => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></label>
        {mode === "weekly" && <label>Einddatum (inclusief)<input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>}
        <label>Tijd (Nederland)<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      </div>
      {mode === "weekly" && <><div className={styles.choices} role="group" aria-label="Weekdagen">{PREDIS_DAYS.map(([day]) => <label key={day}><input type="checkbox" checked={days.includes(day)} onChange={() => setDays(days.includes(day) ? days.filter(d => d !== day) : [...days, day])} />{fullDays[day]}</label>)}</div><small>Kies één of meer dagen, bijvoorbeeld maandag én woensdag. Het gekozen tijdstip geldt voor al deze dagen.</small></>}
      {mode === "single" && <small>Voeg een datum toe en kies daarna eventueel nog een losse datum of een ander tijdstip.</small>}
      <div className={styles.notice} role="status" aria-label="Voorbeeld publicatiedatums">
        {previewError ? <span>{previewError}</span> : <><strong>{previewDates.length} {previewDates.length === 1 ? "datum" : "datums"} · {newMoments} nieuwe kanaalmomenten</strong><span>{previewDates.slice(0, 8).map(at => `${at.slice(8,10)}-${at.slice(5,7)}-${at.slice(0,4)} ${at.slice(11)}`).join(" · ")}{previewDates.length > 8 ? ` · en nog ${previewDates.length - 8}` : ""}</span></>}
      </div>
      <button type="button" className="secondaryButton" disabled={!!previewError || !newMoments} onClick={addMoments}>Momenten toevoegen aan planning</button>
      {planningFeedback && <p role={planningFeedback.error ? "alert" : "status"} className={planningFeedback.error ? styles.error : styles.notice}>{planningFeedback.text}</p>}
      {!previewError && !newMoments && <small>Alle gekozen momenten staan al in je lijst. Kies een andere datum, tijd of kanaal om meer toe te voegen.</small>}
      {!!draft.entries.length && <section aria-label="Toegevoegde publicatiemomenten" className={styles.notice}>
        <strong>Gewenste datums · {dirty ? "nog niet bewaard" : "bewaard bij je concept"}</strong>
        <div className={styles.planningList}>{draft.entries.map(e => <div key={e.key} className={styles.planningRow}>
          <span>{e.at.slice(8, 10)}-{e.at.slice(5, 7)}-{e.at.slice(0, 4)} · {e.at.slice(11)} · {PREDIS_CHANNELS[e.channel]}</span>
          <button type="button" className="secondaryButton" aria-label={`Haal ${e.at} ${PREDIS_CHANNELS[e.channel]} uit planning`} onClick={() => change({ ...draft, entries: draft.entries.filter(x => x.key !== e.key) })}>Verwijderen</button>
        </div>)}</div>
        <small>Dit zijn gewenste publicatiemomenten, nog geen automatische opdrachten aan Predis.</small>
      </section>}
      <small>{draft.entries.length} kanaalmomenten in dit bericht. {dirty ? "Bewaar hieronder om je wijzigingen in de agenda te tonen." : "Bewaarde momenten staan in de marketingagenda."} Nederlandse kloktijd blijft behouden bij zomer- en wintertijd.</small>
    </fieldset>
    <div className={styles.step}>
      <strong>Tussentijds bewaren</strong>
      <p>Je kunt hier stoppen en later verdergaan. Alleen je concept en gewenste datums worden bewaard, niet een opdracht om te publiceren of in te plannen.</p>
      <div className={styles.actions}><button type="button" className="secondaryButton" disabled={!loaded || !!busy || (!dirty && !!saved)} onClick={save}>Concept bewaren</button>{saved && !dirty && <span>Concept bewaard in Horeca OS</span>}</div>
      {loaded && !chosen && message && <p role={failed ? "alert" : "status"} className={failed ? styles.error : styles.notice}>{message}</p>}
    </div>
    <div className={styles.step}>
      <strong>2. Bericht maken en publiceren in Predis</strong>
      <p>Open Predis en kies <b>{businessName}</b>. Staat je bericht daar al klaar? Open dat bericht en controleer de foto en tekst. Zo voorkom je een dubbel bericht.</p>
      <p>Voor een nieuw bericht met je eigen foto: kies ‘Heb je al een ontwerp? Uploaden en inplannen’, upload het bestand hieronder en plak je tekst.</p>
      {!!draft.assets.length && <div className={styles.downloads}>{draft.assets.map((a, i) => <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer">{i + 1}. {a.label} — openen / bewaren ↗</a>)}</div>}
      <div className={styles.actions}>
        <button type="button" className="secondaryButton" disabled={!loaded || !!busy || !draft.caption.trim()} onClick={() => copy(draft.caption, "Berichttekst")}>Tekst kopiëren</button>
        <a className="primaryButton" href="https://app.predis.ai/app/new_post/create" target="_blank" rel="noopener noreferrer">Predis openen ↗</a>
      </div>
      <p>Kies de juiste sociale kanalen en bevestig in Predis zelf: <b>nu publiceren</b> of <b>inplannen voor later</b>.</p>
      <small>Foto en tekst worden niet automatisch meegestuurd. Inplannen en publiceren doe je zelf in Predis.</small>
      <small>Heb je gepubliceerd of ingepland? Bevestig de uitkomst hieronder bij stap 3. Horeca OS verandert de status niet alleen doordat je Predis opent.</small>
    </div>
    <section className={styles.step} aria-label="Uitkomst in Predis bevestigen">
    <strong>3. Bevestigen na Predis</strong>
    <p>Voer deze stap alleen uit nadat je het bericht zelf in Predis hebt ingepland of gepubliceerd. Zonder jouw bevestiging blijft een nieuw moment ‘Concept — nog niet overgezet’.</p>
    <fieldset disabled={!loaded || !!busy} className={styles.fields}><legend>Planning en handmatige controle</legend>
      <div className={styles.tableWrap}><table><caption>Planning en voortgang per kanaal</caption><thead><tr><th>Gewenst moment</th><th>Kanaal</th><th>Status</th><th>Actie</th></tr></thead><tbody>{draft.entries.map(e => { const c = saved?.confirmations?.[e.key]; return <tr key={e.key}><td>{e.at.slice(8, 10)}-{e.at.slice(5, 7)}-{e.at.slice(0, 4)} · {e.at.slice(11)}</td><td>{PREDIS_CHANNELS[e.channel]}</td><td>{PREDIS_STATES[c?.state] || PREDIS_STATES.pending}{c && <small>Bevestigd op {new Date(c.at).toLocaleString("nl-NL")}{dirty ? " · inhoud gewijzigd; controleer opnieuw" : ""}</small>}</td><td><button type="button" className="secondaryButton" onClick={() => { setEntryKey(e.key); setConfirmed(false); }}>Controleren</button><button type="button" className="secondaryButton" aria-label={`Verwijder ${e.at} ${PREDIS_CHANNELS[e.channel]}`} onClick={() => change({ ...draft, entries: draft.entries.filter(x => x.key !== e.key) })}>×</button></td></tr>; })}</tbody></table></div>
      {!draft.entries.length && <p>Nog geen momenten om te bevestigen. Voeg bij je concept de werkelijke datum, tijd en kanalen uit Predis toe en bewaar het concept. Bevestig daarna per kanaal de uitkomst.</p>}
    </fieldset>
    <p>Stel je publicatiemomenten ook in Predis in. Gebruik hierboven ‘Controleren’ om per kanaal vast te leggen wat je zelf in Predis hebt gecontroleerd.</p>
    {chosen && <fieldset className={styles.fields} disabled={!!busy || dirty || !loaded}><legend>Status bevestigen</legend><strong>{chosen.at.replace("T", " ")} · {PREDIS_CHANNELS[chosen.channel]}</strong><label>Wat heb je gecontroleerd?<select value={state} onChange={e => { setState(e.target.value); setConfirmed(false); }}><option value="scheduled">Dit moment is ingepland in Predis</option><option value="published">Dit bericht is daadwerkelijk geplaatst</option><option value="pending">Terug naar ‘Nog overzetten’</option></select></label><label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Ik heb dit zelf gecontroleerd voor de juiste vestiging, datum en het juiste kanaal.</label><button type="button" className="secondaryButton" disabled={!confirmed || dirty} onClick={() => run("Status bewaren…", async () => { const next = await request("confirm", { entryKey: chosen.key, state, confirmed }); accept(next); if (mounted.current) setMessage("Je handmatige bevestiging is bewaard. Niet automatisch door Predis gecontroleerd."); })}>Handmatige bevestiging bewaren</button></fieldset>}
    {chosen && dirty && <p>Bewaar eerst de voorbereiding voordat je een status bevestigt.</p>}
    {loaded && chosen && message && <p role={failed ? "alert" : "status"} className={failed ? styles.error : styles.notice}>{message}</p>}
    <small>Verwijderen of aanpassen in Horeca OS wijzigt niets in Predis. Pas een reeds ingepland bericht daar ook zelf aan. Bevestigingen worden nooit automatisch ‘Geplaatst’ wanneer de tijd verstrijkt.</small>
    </section>
    <details className={styles.moreOptions}><summary>Meer opties</summary>
    <div className={styles.actions}><button type="button" className="secondaryButton" disabled={!!busy} onClick={() => { if (!dirty || window.confirm("Je hebt onbewaarde wijzigingen. Wil je de bewaarde versie laden en je invoer vervangen?")) load(); }}>Bewaarde versie laden</button><button type="button" className="secondaryButton" disabled={!loaded || !!busy} onClick={() => { if (window.confirm("Vervang deze berichttekst door de huidige tekst uit Horeca OS?")) change({ ...draft, caption: initial().caption }); }}>Horeca OS-tekst overnemen</button><button type="button" className="secondaryButton" disabled={!loaded || !!busy} onClick={() => copy(transferText(dist.common?.title || "Evenement", draft), "Tekst, media en planning")}>Alles kopiëren</button></div>
    </details>
  </section>;
}
