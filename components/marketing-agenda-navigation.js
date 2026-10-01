"use client";

import { useMemo, useState } from "react";

export default function MarketingAgendaNavigation({ businessId, businesses, renderAgenda, renderCreator, renderFoodMachine }) {
  const [view, setView] = useState("agenda");
  const [creatorVisited, setCreatorVisited] = useState(false);
  const [chosenBusiness, setChosenBusiness] = useState("");
  const [newEventRequest, setNewEventRequest] = useState(null);
  const [agendaRefreshToken, setAgendaRefreshToken] = useState(0);
  const agendaBusinesses = useMemo(() => businessId === "all" ? businesses : businesses.filter(business => business.id === businessId), [businessId, businesses]);
  const requestedBusiness = businessId === "all" ? chosenBusiness : businessId;
  const creatorBusiness = businesses.some(business => business.id === requestedBusiness) ? requestedBusiness : "";

  function openCreator() { setCreatorVisited(true); setView("create"); }
  function planEventOnDate(date, requestedBusinessId = "") {
    const dateValue = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    if (businessId === "all" && businesses.some((business) => business.id === requestedBusinessId)) setChosenBusiness(requestedBusinessId);
    setNewEventRequest({ date: dateValue, id: `${dateValue}-${Date.now()}` });
    setCreatorVisited(true);
    setView("create");
  }
  return <>
    <nav aria-label="Marketingnavigatie" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", flexWrap: "wrap", gap: 10, padding: "12px 0", marginBottom: 12, background: "#edf6f8", borderBottom: "1px solid #c8dce5" }}>
      <button type="button" className="secondaryButton" style={view === "agenda" ? { background: "#176d7f", color: "white" } : undefined} aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>Agenda</button>
      <button type="button" className="secondaryButton" style={view === "food" ? { background: "#176d7f", color: "white" } : undefined} aria-pressed={view === "food"} onClick={() => setView("food")}>Food Marketing Machine</button>
      <button type="button" className="secondaryButton" style={view === "create" ? { background: "#176d7f", color: "white" } : undefined} aria-pressed={view === "create"} onClick={openCreator}>Evenement of campagne maken</button>
    </nav>
    {/* Keep visited screens mounted: returning must not discard a form or reset the calendar month. */}
    <div hidden={view !== "agenda"} aria-label="Marketingagenda" style={view !== "agenda" ? { display: "none" } : undefined}>
      {renderAgenda(agendaBusinesses, planEventOnDate, agendaRefreshToken)}
    </div>
    {view === "food" && <div aria-label="Food Marketing Machine">{renderFoodMachine?.()}</div>}
    {creatorVisited && <div hidden={view !== "create"} aria-label="Evenement of campagne maken" style={view !== "create" ? { display: "none" } : undefined}>
      {businessId === "all" && <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ display: "grid", gap: 8, maxWidth: 420 }}>Voor welke vestiging wil je iets maken?
          <select value={creatorBusiness} onChange={event => setChosenBusiness(event.target.value)} style={{ padding: 10, border: "1px solid #b6cfd9", borderRadius: 7, font: "inherit" }}>
            <option value="">Kies een vestiging</option>
            {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
          </select>
        </label>
        <p>De knop Agenda brengt je altijd terug naar het overzicht.</p>
      </section>}
      {creatorBusiness ? <div key={creatorBusiness}>{renderCreator(creatorBusiness, newEventRequest, () => setAgendaRefreshToken((current) => current + 1))}</div> : <p>Kies eerst een vestiging om een evenement, gerecht of campagne te maken.</p>}
    </div>}
  </>;
}
