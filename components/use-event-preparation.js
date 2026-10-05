"use client";
import { useEffect, useRef, useState } from 'react';
import { eventDistribution } from '../lib/event-dossier';
import { saveEventContent } from '../lib/manual-event-content';

// Debounced central storage, with an explicit flush for Next/Close.
export default function useEventPreparation({ client, item, workspaceId, channel, value, enabled, onSaved, registerSave }) {
  const base = useRef(item), pending = useRef(null), latest = useRef(value);
  const persisted = useRef(JSON.stringify(value));
  const [notice, setNotice] = useState('');
  latest.current = value;
  const signature = JSON.stringify(value);
  useEffect(() => { if (persisted.current === signature && !pending.current) base.current = item; }, [item]);
  async function flush() {
    while (pending.current) await pending.current;
    const desired = latest.current, key = JSON.stringify(desired);
    if (persisted.current === key || !enabled || !workspaceId || !client) return;
    const operation = (async () => {
      setNotice('Voorbereiding opslaan…');
      try {
        const d = eventDistribution(base.current);
        const saved = await saveEventContent(client, workspaceId, base.current, {
          ...d, channel_drafts: { ...d.channel_drafts, [channel]: desired },
        });
        base.current = saved; persisted.current = key;
        onSaved?.(saved); setNotice('Voorbereiding opgeslagen in Horeca OS.');
      } catch (error) { setNotice('Niet opgeslagen: ' + error.message); throw error; }
    })();
    pending.current = operation;
    try { await operation; } finally { if (pending.current === operation) pending.current = null; }
  }
  useEffect(() => {
    if (!enabled || !client || signature === persisted.current) return;
    const timer = setTimeout(() => flush().catch(() => {}), 700);
    return () => clearTimeout(timer);
  }, [signature, enabled]);
  useEffect(() => {
    registerSave?.(channel, async () => { await flush(); await flush(); });
    return () => registerSave?.(channel, null);
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    if (enabled && signature !== persisted.current) window.addEventListener?.('beforeunload', warn);
    return () => window.removeEventListener?.('beforeunload', warn);
  }, [signature, enabled, notice]);
  return { notice, flush };
}
