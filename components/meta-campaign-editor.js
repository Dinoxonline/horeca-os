"use client";

import { useEffect, useState } from "react";
import FacebookAdAccountPicker from "./facebook-ad-account-picker";
import MetaCampaignComposer from "./meta-campaign-composer";
import MetaAccountBudget from "./meta-account-budget";
import { campaignBudgetSummary } from "../lib/meta-campaign-settings";

export default function MetaCampaignEditor({ workspaceId, session, item, distribution, business, enabled, onSaved, onDirty, onBeforeConnect, initialDraft, onDraftChange }) {
  const [adAccount, setAdAccount] = useState(undefined);
  const [pageAccount, setPageAccount] = useState(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [adsConfiguration, setAdsConfiguration] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paidCampaign = distribution.facebook_paid_campaign || {};
  const created = ["active", "paused"].includes(paidCampaign.status);
  const budgetContext = { workspaceId, businessId: item.business_id, session, enabled, accountId: adAccount?.external_account_id || paidCampaign.ad_account_id };

  async function loadAdAccount() {
    if (!session?.access_token) return;
    setLoadingAccount(true); setError("");
    try {
      const response = await fetch(`/api/integrations/facebook?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json();
      if (!response.ok || result.accountsWarning) throw new Error(result.error || result.accountsWarning || "De Meta-koppeling kon niet worden gecontroleerd.");
      setAdsConfiguration(result.adsConfiguration || null);
      setAdAccount((result.adAccounts || []).find(account => String(account.business_id) === String(item.business_id)) || null);
      setPageAccount((result.accounts || []).find(account => String(account.business_id) === String(item.business_id)) || null);
    } catch (failure) { setError(failure.message); setAdAccount(null); }
    finally { setLoadingAccount(false); }
  }
  useEffect(() => { if (enabled && adAccount === undefined) loadAdAccount(); }, [enabled, adAccount]);

  async function connectAdAccount() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/integrations/facebook", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, businessId: item.business_id, purpose: "ads" }) });
      const result = await response.json();
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "Het Meta-advertentieaccount kon niet worden gekoppeld.");
      onBeforeConnect?.();
      window.location.assign(result.authorizationUrl);
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  async function searchMeta(resource, q, country) {
    const params = new URLSearchParams({ workspaceId, businessId: item.business_id, resource, q, country });
    const response = await fetch(`/api/integrations/facebook/ads?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Meta kon geen zoekresultaten ophalen.");
    return result.options || [];
  }
  async function createCampaign(settings) {
    const budget = campaignBudgetSummary(settings);
    const budgetText = settings.budgetType === "lifetime" ? `Totaalbudget: € ${budget.amount.toFixed(2)}` : `Dagbudget: € ${budget.amount.toFixed(2)}\nBudgetindicatie looptijd: € ${budget.estimate?.toFixed(2)} (geen harde limiet)`;
    if (!window.confirm(`Maak “${settings.campaignName}” als gepauzeerd concept aan?\n\n${budgetText}\nAfzender: ${pageAccount?.display_name || business?.name}\n\nEr wordt nog niets gestart. Controleer en activeer het concept zelf in Meta.`)) return;
    setBusy(true); setError(""); onDirty?.(true);
    try {
      const response = await fetch("/api/integrations/facebook/ads", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: item.business_id, campaignId: item.id, settings: { ...settings, launchStatus: "paused" } }),
      });
      const result = await response.json();
      if (!response.ok || !result.paidCampaign) throw new Error(result.error || "Meta heeft geen campagnebevestiging teruggegeven.");
      onSaved({ ...item, media: (item.media || []).map(entry => entry?.kind === "campaign_distribution" ? { ...entry, facebook_paid_campaign: result.paidCampaign } : entry) });
      onDirty?.(false);
    } catch (failure) { setError(failure.message || "Meta kon het concept niet maken."); }
    finally { setBusy(false); }
  }

  if (created) return <section className="marketingMetaCampaign" aria-label="Meta-campagne"><p><strong>{paidCampaign.status === "active" ? "Meta-campagne is actief." : "Meta-campagne staat gepauzeerd."}</strong> {paidCampaign.name}</p><p>Controleer en bewerk het bestaande concept in Meta. Er wordt geen dubbele campagne aangemaakt.</p>{paidCampaign.manage_url && <a className="secondaryButton" href={paidCampaign.manage_url} target="_blank" rel="noreferrer">In Meta bekijken ↗</a>}<MetaAccountBudget {...budgetContext} /></section>;
  if (loadingAccount || adAccount === undefined) return <p className="marketingMetaCampaign"><strong>Meta-advertentieaccount wordt gecontroleerd…</strong></p>;
  if (adAccount?.connection_status === "pending") return <FacebookAdAccountPicker workspaceId={workspaceId} businessId={item.business_id} businessName={business?.name} session={session} account={adAccount} onSaved={loadAdAccount} />;
  if (!adAccount || adAccount.connection_status !== "connected" || !adAccount.granted_scopes?.includes("ads_management")) return <section className="marketingMetaCampaign">{adsConfiguration?.ready ? <><p>Verbind het Meta-advertentieaccount van <strong>{business?.name || "deze vestiging"}</strong> met toestemming voor betaalde campagnes.</p><button type="button" className="primaryButton" disabled={busy} onClick={connectAdAccount}>{busy ? "Koppelen…" : "Advertentieaccount koppelen"}</button></> : <><p>{adsConfiguration?.message || "De advertentiekoppeling kon niet worden gecontroleerd."}</p>{adsConfiguration?.setupUrl && <a className="secondaryButton" href={adsConfiguration.setupUrl} target="_blank" rel="noreferrer">Meta-appinstellingen openen ↗</a>}</>}<button type="button" className="secondaryButton" onClick={loadAdAccount}>Koppeling opnieuw controleren</button>{error && <p role="alert">{error}</p>}</section>;
  return <MetaCampaignComposer key={item.id} item={item} distribution={distribution} businessName={business?.name || "Deze vestiging"} pageName={pageAccount?.display_name} adAccountName={adAccount.display_name} onCreate={createCampaign} onSearch={searchMeta} onDirty={onDirty} busy={busy} error={error} initialDraft={initialDraft} onDraftChange={onDraftChange} budgetContext={budgetContext} />;
}

export function SavedMetaCampaignEditor(props) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return <details className="savedMetaCampaignEditor" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Meta-campagne — Facebook en Instagram</summary>
    <p>Stel doel, budget, doelgroep en advertentie in, met een meeveranderend voorbeeld. Een Facebookbericht of Facebook-evenement is hiervoor niet verplicht.</p>
    {dirty && <p role="status">Je advertentie-instellingen zijn nog niet opgeslagen. Maak het concept aan voordat je dit dossier verlaat.</p>}
    <MetaCampaignEditor {...props} enabled={open} onDirty={setDirty} />
  </details>;
}
