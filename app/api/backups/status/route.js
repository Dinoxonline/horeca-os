import { NextResponse } from 'next/server';
import { createUserSupabase, createAdminSupabase } from '../../../../lib/server-supabase';
import { BACKUP_WORKSPACE } from '../../../../lib/backup-status.mjs';

export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization' } });

export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: 'Log opnieuw in om de back-ups te bekijken.' }, 401);
    const userClient = createUserSupabase(token);
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data?.user) return json({ error: 'Je sessie is verlopen.' }, 401);
    let aal;
    try { aal = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).aal; } catch { /* fail closed */ }
    if (aal !== 'aal2') return json({ error: 'Bevestig eerst je tweestapsverificatie bij Beveiliging.' }, 403);
    if (request.nextUrl.searchParams.get('workspaceId') !== BACKUP_WORKSPACE) return json({ error: 'Geen toegang tot deze back-ups.' }, 403);
    const { data: member, error: memberError } = await userClient.from('workspace_members')
      .select('role').eq('workspace_id', BACKUP_WORKSPACE).eq('user_id', data.user.id).maybeSingle();
    if (memberError || member?.role !== 'owner') return json({ error: 'Alleen de eigenaar kan dit back-upoverzicht bekijken.' }, 403);
    const { data: overview, error: statusError } = await createAdminSupabase().rpc('backup_overview_status');
    if (statusError || !overview) return json({ error: 'Back-upstatus kon niet worden opgehaald. Probeer opnieuw; dit zegt niet dat de back-ups geslaagd zijn.' }, 503);
    return json(overview);
  } catch {
    return json({ error: 'Back-upstatus is tijdelijk niet beschikbaar.' }, 503);
  }
}
