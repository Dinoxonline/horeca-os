"use client";

import { useEffect, useState } from "react";
import styles from "./meta-account-budget.module.css";

const money = value => value === null || value === undefined ? "Niet beschikbaar" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
const statuses = { 1: "Actief", 2: "Uitgeschakeld", 3: "Betalingsprobleem", 7: "Wordt gecontroleerd", 8: "In behandeling", 9: "Uitstelperiode", 100: "Sluiting in behandeling", 101: "Gesloten", 201: "Activering in behandeling", 202: "Nog niet actief" };

export default function MetaAccountBudget({ workspaceId, businessId, session, enabled = true, plannedBudget, accountId }) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ loading: true, budget: null, error: "", paymentWarning: "" });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    setState({ loading: true, budget: null, error: "", paymentWarning: "" });
    async function read() {
      try {
        if (!session?.access_token) throw new Error("Log opnieuw in om budget en betalingen te bekijken.");
        const params = new URLSearchParams({ workspaceId, businessId, resource: "budget" });
        const response = await fetch("/api/integrations/facebook/ads?" + params, { headers: { Authorization: "Bearer " + session.access_token }, cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.budget) throw new Error(result.error || "Meta heeft geen budgetgegevens teruggegeven.");
        if (active) setState({ loading: false, budget: result.budget, error: "", paymentWarning: result.paymentWarning || "" });
      } catch (error) {
        if (active) setState({ loading: false, budget: null, error: error.message || "Budgetgegevens ophalen is niet gelukt.", paymentWarning: "" });
      }
    }
    read();
    return () => { active = false; controller.abort(); };
  }, [workspaceId, businessId, session?.access_token, enabled, reload]);
  const budget = state.budget;
  const fallbackId = String(accountId || "").replace(/^act_/, "");
  const fallbackBillingUrl = /^\d+$/.test(fallbackId) ? "https://www.facebook.com/ads/manager/billing/?act=" + fallbackId : null;
  const exceeds = budget?.remaining != null && Number.isFinite(plannedBudget) && plannedBudget > budget.remaining;
  return <section className={styles.panel} aria-label="Accountbudget en facturatie">
    <div className={styles.heading}><div><h4>Beschikbaar budget en betalingen</h4><p>Live gegevens van het gekoppelde Meta-advertentieaccount</p></div><button type="button" disabled={state.loading} onClick={() => setReload(value => value + 1)}>Verversen</button></div>
    {state.loading && <p role="status">Budget en betaalgegevens ophalen…</p>}
    {state.error && <p role="alert">Niet beschikbaar: {state.error} Je kunt je advertentie wel verder voorbereiden.</p>}
    {state.error && fallbackBillingUrl && <a href={fallbackBillingUrl} target="_blank" rel="noopener noreferrer">Facturen en betalingen openen in Meta ↗</a>}
    {budget && <>
      <p><strong>{budget.name || "Advertentieaccount"}</strong> · {budget.accountId}</p>
      <p className={styles.notice}>Accounttotaal, niet per vestiging. Alle vestigingen en campagnes die dit advertentieaccount gebruiken, delen deze bestedingsruimte.</p>
      <div className={styles.cards}>
        <div><span>Resterende bestedingsruimte</span><strong>{money(budget.remaining)}</strong><small>{budget.hasLimit === false ? "Geen accountlimiet ingesteld; dit betekent niet onbeperkt budget." : budget.hasLimit ? "Accountlimiet min bestedingen volgens Meta. Geen banksaldo of tegoed." : "Meta geeft geen bruikbare accountlimiet terug."}</small></div>
        <div><span>Accountbestedingslimiet</span><strong>{budget.hasLimit === false ? "Niet ingesteld" : money(budget.limit)}</strong><small>Geldt voor het hele advertentieaccount.</small></div>
        <div><span>Bestedingen volgens Meta</span><strong>{money(budget.spent)}</strong><small>Accountteller bij de bestedingslimiet; niet alleen deze campagne of deze maand.</small></div>
        <div><span>Openstaand bedrag</span><strong>{money(budget.outstanding)}</strong><small>{budget.prepaid === true ? "Vooraf betaald account: bekijk het actuele tegoed in Meta." : "Nog te verrekenen kosten, geen beschikbaar advertentiebudget."}</small></div>
      </div>
      {exceeds && <p className={styles.warning}>De budgetindicatie van deze campagne ({money(plannedBudget)}) is hoger dan de resterende accountbestedingsruimte. Andere campagnes gebruiken deze ruimte ook. Controleer dit in Meta vóór activeren.</p>}
      {budget.status !== null && budget.status !== 1 && <p className={styles.warning}>Het account is niet actief. Controleer de accountstatus en betaling in Meta voordat je de campagne activeert.</p>}
      {budget.currency !== "EUR" && <p className={styles.warning}>Deze editor rekent in EUR. De rekeningvaluta is {budget.currency || "onbekend"}; bedragen worden hier niet omgerekend.</p>}
      <details className={styles.details} open><summary>Betaalgegevens en facturatie</summary>
        <dl>
          <dt>Betaalmethode</dt><dd>{budget.paymentMethod || "Niet vrijgegeven door Meta"}</dd>
          <dt>Betaalwijze</dt><dd>{budget.prepaid === true ? "Vooraf betalen" : budget.prepaid === false ? "Niet vooraf betaald" : "Niet beschikbaar"}</dd>
          <dt>Bedrijfsnaam bij Meta</dt><dd>{budget.billingName || "Niet vrijgegeven door Meta"}</dd>
          <dt>Accountstatus</dt><dd>{statuses[budget.status] || "Niet beschikbaar"}</dd>
          <dt>Valuta</dt><dd>{budget.currency || "Niet beschikbaar"}</dd>
          <dt>Tijdzone account</dt><dd>{budget.timezone || "Niet beschikbaar"}</dd>
        </dl>
        {state.paymentWarning && <p>{state.paymentWarning}</p>}
        <p>Facturen, betaalbewijzen, transactiehistorie, btw-gegevens en de volgende afschrijving bekijk je in Meta. Horeca OS haalt hier geen factuurbestanden op en wijzigt niets aan je betalingen.</p>
        {budget.billingUrl && <a href={budget.billingUrl} target="_blank" rel="noopener noreferrer">Facturen en betalingen openen in Meta ↗</a>}
      </details>
      <p className={styles.footnote}>Opgehaald: {new Date(budget.checkedAt).toLocaleString("nl-NL")}. Meta kan vertraagd bijwerken. Dit is geen gereserveerd budget of garantie dat advertenties kunnen starten.</p>
    </>}
  </section>;
}
