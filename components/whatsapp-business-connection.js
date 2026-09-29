"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { parseWhatsappSignupEvent } from "../lib/whatsapp-business";

export default function WhatsappBusinessConnection({ workspaceId, session, configuration, accounts, businesses, onConnected }) {
  const [scope, setScope] = useState("shared");
  const [sdkRequested, setSdkRequested] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const attempt = useRef(null);
  const signup = configuration.embeddedSignup || {};
  const canManage = scope === "shared" ? configuration.canManageShared : configuration.canManageShared || configuration.manageableBusinessIds?.includes(scope);
  const ready = configuration.ready && signup.ready && canManage;

  function stop(message) {
    clearTimeout(attempt.current?.timer);
    attempt.current = null;
    setBusy(false);
    setNotice(message);
  }

  async function complete(current) {
    if (attempt.current !== current || current.saving || !current.code || !current.wabaId) return;
    current.saving = true;
    clearTimeout(current.timer);
    setNotice("Meta-toestemming controleren en nummer veilig koppelen…");
    try {
      const response = await fetch("/api/integrations/whatsapp/connect", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ workspaceId, shared: current.scope === "shared", businessId: current.scope === "shared" ? null : current.scope, code: current.code, wabaId: current.wabaId, phoneNumberId: current.phoneNumberId }),
        signal: AbortSignal.timeout(120000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Koppelen mislukt.");
      if (attempt.current !== current) return;
      stop(`Verbonden: ${result.account.displayName}. Er is geen testbericht verstuurd. Controleer de ontvangst met een bericht dat je zelf verstuurt.`);
      await onConnected();
    } catch (error) {
      if (attempt.current === current) stop(`${error.message || "Koppelen mislukt."} Controleer de koppelstatus voordat je opnieuw probeert.`);
    }
  }

  useEffect(() => {
    function receive(event) {
      const current = attempt.current;
      if (!current || current.saving) return;
      const data = parseWhatsappSignupEvent(event);
      if (!data) return;
      if (data.cancelled) { stop("Koppelen afgebroken in Meta. Er is geen verbinding bevestigd."); return; }
      Object.assign(current, data);
      void complete(current);
    }
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); clearTimeout(attempt.current?.timer); attempt.current = null; };
  }, [workspaceId, session?.access_token]);

  function initializeSdk() {
    if (!window.FB || !signup.appId) return;
    window.FB.init({ appId: signup.appId, version: "v25.0", xfbml: false, cookie: false });
    setSdkReady(true);
  }

  function connect() {
    if (!ready || busy) return;
    if (!sdkReady) {
      setSdkRequested(true);
      setNotice("Meta wordt geladen. Klik daarna op ‘Verbinden via Meta’.");
      return;
    }
    const target = scope === "shared" ? "de gezamenlijke inbox" : businesses.find(b => b.id === scope)?.name;
    if (!window.confirm(`WhatsApp Business verbinden voor ${target}?\n\nKies in Meta je bestaande Business-app. Stop als Meta vraagt het nummer te verwijderen of te migreren. Groepsgesprekken worden niet gekoppeld.`)) return;
    const current = { scope, saving: false };
    attempt.current = current;
    current.timer = setTimeout(() => { if (attempt.current === current) stop("Meta heeft de koppeling nog niet afgerond. Controleer het Meta-venster en probeer daarna opnieuw."); }, 300000);
    setBusy(true); setNotice("Rond de toestemming af in het Meta-venster. Je telefoonnummer vul je daar in.");
    try {
      // Synchronous call in the click handler keeps browser popup activation.
      window.FB.login(response => {
        if (attempt.current !== current) return;
        if (!response.authResponse?.code) { stop("Geen Meta-toestemming ontvangen. Er is geen verbinding bevestigd."); return; }
        current.code = response.authResponse.code;
        void complete(current);
      }, {
        config_id: signup.configId, response_type: "code", override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      });
    } catch { stop("Het Meta-venster kon niet worden geopend. Sta pop-ups toe voor Horeca OS en probeer opnieuw."); }
  }

  const shared = accounts.find(account => !account.business_id);
  return <section className="integrationGrid" id="whatsapp-business">
    {sdkRequested && <Script id="whatsapp-facebook-sdk" src="https://connect.facebook.net/nl_NL/sdk.js" strategy="afterInteractive" onReady={initializeSdk} onError={() => setNotice("Meta kon niet geladen worden. Controleer je verbinding of inhoudsblokkeerder.")} />}
    <article className="panel integrationSetup">
      <div className="integrationBrand"><div className="integrationLogo">WA</div><div><h2>WhatsApp Business koppelen</h2><p>Klantberichten ontvangen en beantwoorden in Horeca OS</p></div></div>
      <div className="scopeBanner"><strong>Samen of per vestiging</strong><span>Nu één gezamenlijk nummer; later een eigen nummer per vestiging. Bestaande koppelingen en berichten worden niet automatisch vervangen.</span></div>
      <label>Nummer koppelen voor<select value={scope} disabled={busy} onChange={event => setScope(event.target.value)}><option value="shared">Gezamenlijk — beide vestigingen</option>{businesses.map(business => <option key={business.id} value={business.id}>{business.name} — eigen nummer</option>)}</select></label>
      {!canManage && <p className="notice">Voor deze koppeling zijn beheerrechten nodig. De gezamenlijke inbox vereist rechten voor de hele organisatie.</p>}
      {!configuration.ready && <div className="notice"><strong>Meta-inrichting nog niet compleet.</strong><p>De koppelknop wordt beschikbaar zodra de ontbrekende serverinstellingen zijn ingevuld.</p><details><summary>Wat ontbreekt?</summary>{(configuration.missing || []).join(", ") || "De configuratie wordt nog opgehaald."}</details></div>}
      <button type="button" className="primary" disabled={!ready || busy} onClick={connect}>{busy ? "Koppelen…" : sdkReady ? "Verbinden via Meta" : "WhatsApp Business-koppeling openen"}</button>
      {busy && !attempt.current?.saving && <button type="button" className="secondaryButton" onClick={() => stop("Koppelvenster losgelaten. Er is geen verbinding bevestigd.")}>Annuleren</button>}
      <p>Gebruik je bestaande WhatsApp Business-app naast Horeca OS, als Meta dit voor jouw nummer toestaat. Horeca OS registreert of migreert je nummer niet.</p>
      <p>Deze koppeling is voor individuele klantgesprekken. Bestaande groepen en oude chatgeschiedenis worden hiermee niet geïmporteerd.</p>
      {notice && <div className="notice" role="status">{notice}</div>}
      <button type="button" className="secondaryButton" disabled={busy} onClick={onConnected}>Koppelstatus opnieuw controleren</button>
    </article>
    <article className="panel">
      <h2>Verbonden nummers</h2>
      {[{ id: null, name: "Gezamenlijke inbox", account: shared }, ...businesses.map(b => ({ ...b, account: accounts.find(a => a.business_id === b.id) }))].map(row => <div className="connectionRow" key={row.id || "shared"}><div><strong>{row.name}</strong><span>{row.account?.display_name || "Nog geen nummer gekoppeld"}</span><small>{row.account?.last_synced_at ? `Laatste ontvangstcontrole: ${new Date(row.account.last_synced_at).toLocaleString("nl-NL")}` : "Ontvangst nog niet bevestigd"}</small></div><span className="status">{row.account?.connection_status === "connected" ? "Verbonden" : row.account ? "Controle nodig" : "Niet ingesteld"}</span></div>)}
      <p>Een eigen nummer blijft afgeschermd per vestiging. De gezamenlijke inbox is alleen toegankelijk met organisatiebrede rechten.</p>
      <a className="secondaryButton" href="/social-inbox">Naar Social inbox</a>
    </article>
  </section>;
}
