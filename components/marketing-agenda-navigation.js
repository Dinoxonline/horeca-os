"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function MarketingAgendaNavigation({ businessId, businesses, renderAgenda, renderCreator, renderFoodMachine }) {
  const [view, setView] = useState("agenda");
  const saveBeforeLeave = useRef(null);
  const viewRef = useRef(view);
  const dossierHistoryRef = useRef(null);
  const [openEventRequest, setOpenEventRequest] = useState(null);
  const [resumeEvent, setResumeEvent] = useState(null);
  const [savedEvent, setSavedEvent] = useState(null);
  useEffect(() => { viewRef.current = view; }, [view]);
  const registerSave = save => { saveBeforeLeave.current = save; };

  function addDossierHistory(item, step) {
    if (typeof window === "undefined" || window.location.pathname !== "/marketing") return;
    const url = new URL(window.location.href);
    url.searchParams.set("marketingDossier", String(item.id));
    window.history.pushState({ ...(window.history.state || {}), horecaOsMarketingDossier: { id: String(item.id), step } }, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function clearDossierHistory(item) {
    const current = dossierHistoryRef.current;
    dossierHistoryRef.current = null;
    if (typeof window === "undefined" || !current || String(current.item.id) !== String(item?.id)) return;
    const marker = window.history.state?.horecaOsMarketingDossier;
    if (marker && String(marker.id) === String(item.id)) window.history.back();
  }
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function returnWithBrowserBack() {
      const openDossier = dossierHistoryRef.current;
      if (!openDossier || viewRef.current !== "create") return;
      (async () => {
        let canLeave = true;
        try { if (saveBeforeLeave.current) canLeave = await saveBeforeLeave.current(); } catch { canLeave = false; }
        if (!canLeave) {
          addDossierHistory(openDossier.item, openDossier.step);
          return;
        }
        dossierHistoryRef.current = null;
        setResumeEvent({ ...openDossier.item, requestedChannel: "horeca_os", requestId: Date.now() });
        setAgendaRefreshToken(value => value + 1);
        setView("agenda");
      })();
    }
    window.addEventListener("popstate", returnWithBrowserBack);
    return () => window.removeEventListener("popstate", returnWithBrowserBack);
  }, []);
  async function leaveFor(next) {
    if (view === "create" && saveBeforeLeave.current && !(await saveBeforeLeave.current())) return false;
    if (view === "create" && next !== "create") clearDossierHistory(dossierHistoryRef.current?.item);
    setView(next); return true;
  }
  async function openDossier(item, requestedStep) {
    if (view === "create" && saveBeforeLeave.current && !(await saveBeforeLeave.current())) return;
    if (!businesses.some(business => business.id === item.business_id)) return;
    const previousStep = (item.media || []).find(entry => entry?.kind === 'campaign_distribution')?.event_workflow?.step;
    const step = requestedStep || (previousStep === 'website' ? 'website' : 'horeca_os');
    dossierHistoryRef.current = { item, step };
    addDossierHistory(item, step);
    setChosenBusiness(item.business_id);
    setOpenEventRequest({ item, step, id: item.id + ':' + Date.now() });
    setCreatorVisited(true); setView('create');
  }
  function continueEvent(item, channel) {
    clearDossierHistory(item);
    setResumeEvent({ ...item, requestedChannel: channel, requestId: Date.now() });
    setAgendaRefreshToken(value => value + 1); setView('agenda');
  }
  const [creatorVisited, setCreatorVisited] = useState(false);
  const [chosenBusiness, setChosenBusiness] = useState("");
  const [newEventRequest, setNewEventRequest] = useState(null);
  const [agendaRefreshToken, setAgendaRefreshToken] = useState(0);
  const agendaBusinesses = useMemo(() => businessId === "all" ? businesses : businesses.filter(business => business.id === businessId), [businessId, businesses]);
  const requestedBusiness = businessId === "all" ? chosenBusiness : businessId;
  const creatorBusiness = businesses.some(business => business.id === requestedBusiness) ? requestedBusiness : "";

  function openCreator() { setCreatorVisited(true); setView("create"); }
  async function planEventOnDate(date, requestedBusinessId = "") {
    if (saveBeforeLeave.current && !(await saveBeforeLeave.current())) return;
    setOpenEventRequest(null);
    const dateValue = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    if (businessId === "all" && businesses.some((business) => business.id === requestedBusinessId)) setChosenBusiness(requestedBusinessId);
    setNewEventRequest({ date: dateValue, id: `${dateValue}-${Date.now()}` });
    setCreatorVisited(true);
    setView("create");
  }
  return <>
    <nav aria-label="Marketingnavigatie" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", flexWrap: "wrap", gap: 10, padding: "12px 0", marginBottom: 12, background: "#edf6f8", borderBottom: "1px solid #c8dce5" }}>
      <button type="button" className="secondaryButton" style={view === "agenda" ? { background: "#176d7f", color: "white" } : undefined} aria-pressed={view === "agenda"} onClick={() => leaveFor("agenda")}>Agenda</button>
      <button type="button" className="secondaryButton" style={view === "food" ? { background: "#176d7f", color: "white" } : undefined} aria-pressed={view === "food"} onClick={() => leaveFor("food")}>Food Marketing Machine</button>
      <button type="button" className="secondaryButton" style={view === "create" ? { background: "#176d7f", color: "white" } : undefined} aria-pressed={view === "create"} onClick={openCreator}>Evenement of campagne maken</button>
    </nav>
    {/* Keep visited screens mounted: returning must not discard a form or reset the calendar month. */}
    <div hidden={view !== "agenda"} aria-label="Marketingagenda" style={view !== "agenda" ? { display: "none" } : undefined}>
      {renderAgenda(agendaBusinesses, planEventOnDate, agendaRefreshToken, openDossier, resumeEvent, savedEvent)}
    </div>
    {view === "food" && <div aria-label="Food Marketing Machine">{renderFoodMachine?.()}</div>}
    {creatorVisited && <div hidden={view !== "create"} aria-label="Evenement of campagne maken" style={view !== "create" ? { display: "none" } : undefined}>
      {businessId === "all" && <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ display: "grid", gap: 8, maxWidth: 420 }}>Voor welke vestiging wil je iets maken?
          <select value={creatorBusiness} onChange={async event => { const id = event.target.value; if (saveBeforeLeave.current && !(await saveBeforeLeave.current())) return; setChosenBusiness(id); }} style={{ padding: 10, border: "1px solid #b6cfd9", borderRadius: 7, font: "inherit" }}>
            <option value="">Kies een vestiging</option>
            {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
          </select>
        </label>
        <p>De knop Agenda brengt je altijd terug naar het overzicht.</p>
      </section>}
      {creatorBusiness ? <div key={creatorBusiness}>{renderCreator(creatorBusiness, newEventRequest, row => row?.id ? setSavedEvent(row) : setAgendaRefreshToken(current => current + 1), openEventRequest, registerSave, continueEvent)}</div> : <p>Kies eerst een vestiging om een evenement, gerecht of campagne te maken.</p>}
    </div>}
  </>;
}
