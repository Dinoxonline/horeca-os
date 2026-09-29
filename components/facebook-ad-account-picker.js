"use client";

import { useEffect, useState } from "react";

export default function FacebookAdAccountPicker({ workspaceId, businessId, businessName, session, account, onSaved }) {
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = account?.connection_status === "pending";

  async function request(values) {
    if (!session?.access_token) throw new Error("Log opnieuw in bij Horeca OS.");
    const response = await fetch("/api/integrations/facebook", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId, ...values }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "De Meta-koppeling kon niet worden bijgewerkt.");
    return result;
  }

  async function load() {
    setBusy(true); setError(""); setSelected("");
    try { setCandidates((await request({ action: "list_ad_accounts" })).candidates || []); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    setCandidates(null); setSelected(""); setError("");
    if (pending && session?.access_token) load();
  }, [account?.id, pending, workspaceId, businessId, session?.access_token]);

  async function connect() {
    setBusy(true); setError("");
    try {
      const result = await request({ purpose: "ads" });
      if (!result.authorizationUrl) throw new Error("Meta gaf geen koppellink terug.");
      window.location.assign(result.authorizationUrl);
    } catch (failure) { setError(failure.message); setBusy(false); }
  }

  async function save() {
    setBusy(true); setError("");
    try { await request({ action: "select_ad_account", adAccountId: selected }); await onSaved?.(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  if (account?.connection_status === "connected") return <div><strong>{businessName}</strong><p>Advertentieaccount verbonden: {account.display_name}.</p><a className="secondaryButton" href="/marketing">Naar campagnes</a></div>;
  return <section aria-label={`Advertentieaccount ${businessName || "vestiging"}`}>
    {businessName && <h3>{businessName}</h3>}
    {pending ? <>
      <p>Meta-toestemming ontvangen. Kies nu het advertentieaccount voor deze vestiging. Hiermee start je geen campagne.</p>
      {candidates && <label>Advertentieaccount<select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
        <option value="">Kies een advertentieaccount</option>
        {candidates.map(item => <option key={item.id} value={item.id} disabled={!item.active}>{item.name} · {item.id}{item.businessName ? ` · ${item.businessName}` : ""}{item.active ? "" : " · niet actief"}</option>)}
      </select></label>}
      {candidates && !candidates.some(item => item.active) && <p role="status">Meta geeft geen actief advertentieaccount terug. Controleer in Meta Business of jouw gebruiker toegang heeft tot het juiste advertentieaccount en of dat account actief is. Alleen toegang tot een Facebookpagina is niet voldoende.</p>}
      <button type="button" className="secondaryButton" disabled={busy} onClick={load}>{busy ? "Even geduld…" : "Accounts opnieuw ophalen"}</button>
      <button type="button" className="primaryButton" disabled={busy || !selected} onClick={save}>Dit advertentieaccount gebruiken</button>
      {error && <button type="button" className="secondaryButton" disabled={busy} onClick={connect}>Meta-toestemming vernieuwen</button>}
    </> : <><p>Verbind apart het advertentieaccount om betaalde campagnes te kunnen voorbereiden.</p><button type="button" className="secondaryButton" disabled={busy} onClick={connect}>{busy ? "Meta openen…" : "Advertentieaccount koppelen"}</button></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
