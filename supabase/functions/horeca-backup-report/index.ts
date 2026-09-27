import { timingSafeEqual } from 'node:crypto';

// A separate write-only credential accepts sanitized receipts, never backup data.
Deno.serve(async (request: Request) => {
  const reply = (status: number) => new Response(JSON.stringify({ ok: status === 200 }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply(405);
  const expected = Deno.env.get('BACKUP_REPORT_TOKEN') || '';
  const supplied = request.headers.get('x-backup-report-token') || '';
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(supplied))) return reply(401);
  try {
    // Bounded stream, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 2048) { await reader.cancel(); return reply(413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    const keys = ['run_id', 'started_at', 'completed_at', 'ok', 'copy_verified', 'bytes'];
    if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k))) return reply(400);
    const start = Date.parse(value.started_at), end = Date.parse(value.completed_at);
    if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(value.run_id) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end > Date.now() + 300000 || typeof value.ok !== 'boolean' || typeof value.copy_verified !== 'boolean' || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || (value.ok && (!value.copy_verified || !value.bytes))) return reply(400);
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/backup_database_runs?on_conflict=run_id`, {
      method: 'POST', headers: {
        apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal',
      }, body: JSON.stringify(value), signal: AbortSignal.timeout(10000),
    });
    return reply(response.ok ? 200 : 503);
  } catch { return reply(400); }
});
