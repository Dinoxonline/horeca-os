"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ActivateAccountPage() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage("De activatielink kon niet worden verwerkt. Vraag een nieuwe uitnodiging aan.");
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function setPassword(formData) {
    const password = String(formData.get("password") || "");
    const confirmation = String(formData.get("confirmation") || "");
    setMessage("");
    if (password.length < 6) {
      setMessage("Gebruik een wachtwoord van minimaal 6 tekens.");
      return;
    }
    if (password !== confirmation) {
      setMessage("De wachtwoorden zijn niet gelijk.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    window.location.assign("/dashboard");
  }

  if (loading) return <main className="center">Activatielink controleren...</main>;

  return <main className="authPage"><section className="authCard">
    <div className="brand dark">Horeca OS</div>
    <h1>Account activeren</h1>
    <p>Stel je persoonlijke wachtwoord in om toegang te krijgen.</p>
    {message && <div className="notice">{message}</div>}
    {!session ? <div className="notice">Deze activatielink is ongeldig of verlopen. Vraag je beheerder om een nieuwe uitnodiging.</div> :
      <form action={setPassword} className="stack">
        <label>Nieuw wachtwoord<input name="password" type="password" minLength="6" required autoComplete="new-password" /></label>
        <label>Herhaal wachtwoord<input name="confirmation" type="password" minLength="6" required autoComplete="new-password" /></label>
        <button className="primary" disabled={saving}>{saving ? "Opslaan..." : "Account activeren"}</button>
      </form>}
  </section></main>;
}
