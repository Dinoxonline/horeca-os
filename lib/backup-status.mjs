export const BACKUP_WORKSPACE = '24dfa725-127b-40fa-a278-b744ccb4a1ba';

export function databaseHealth(database, now = Date.now()) {
  if (!database?.latest) return { tone: 'warning', label: 'Nog geen status ontvangen' };
  if (!database.latest.ok || !database.latest.copy_verified) return { tone: 'danger', label: 'Laatste poging mislukt' };
  const time = Date.parse(database.latest.completed_at);
  if (!Number.isFinite(time) || time > now + 300000 || now - time > 2 * 3600000) return { tone: 'warning', label: 'Nieuwe controle nodig' };
  return { tone: 'success', label: 'Lokale kopie gecontroleerd' };
}

export function filesHealth(files) {
  if (typeof files?.enabled !== 'boolean') return { tone: 'warning', label: 'Status onbekend' };
  if (!files.enabled) return { tone: 'danger', label: 'Bestandskopie staat uit' };
  if (files.failed || files.overdue || files.wakeError) return { tone: 'danger', label: 'Aandacht nodig' };
  if (files.pending || files.processing) return { tone: 'warning', label: 'Bestanden worden gekopieerd' };
  return { tone: 'success', label: 'Actief — geen openstaande kopieën' };
}

// Keep the reporting contract deliberately small. Ignore all local paths/errors.
export function sanitizeRunResult(result) {
  if (result?.mode !== 'Hourly' || !/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(result.runId || '')) throw new Error('INVALID_RUN');
  const start = Date.parse(result.startedAt), end = Date.parse(result.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > Date.now() + 300000) throw new Error('INVALID_TIME');
  const dump = result.components?.find(c => c.component === 'application-database-core' && c.file?.endsWith('.dump.age'));
  const verified = dump?.copyVerified === true;
  const bytes = Number.isSafeInteger(dump?.bytes) && dump.bytes > 0 ? dump.bytes : 0;
  if (typeof result.ok !== 'boolean' || (result.ok && (!verified || !bytes))) throw new Error('INVALID_RESULT');
  return { run_id: result.runId, started_at: new Date(start).toISOString(), completed_at: new Date(end).toISOString(), ok: result.ok, copy_verified: verified, bytes };
}
