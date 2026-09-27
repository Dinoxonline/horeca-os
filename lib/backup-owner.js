import { createUserSupabase } from './server-supabase';
import { BACKUP_WORKSPACE } from './backup-status.mjs';

export async function requireBackupOwner(request, workspaceId) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401, error: 'Log opnieuw in.' };
  const client = createUserSupabase(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return { status: 401, error: 'Je sessie is verlopen.' };
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return { status: 401, error: 'Ongeldige sessie.' }; }
  if (claims.aal !== 'aal2' || workspaceId !== BACKUP_WORKSPACE) return { status: 403, error: 'Eigenaarstoegang met tweestapsverificatie is vereist.' };
  const member = await client.from('workspace_members').select('role').eq('workspace_id', BACKUP_WORKSPACE).eq('user_id', data.user.id).maybeSingle();
  if (member.error || member.data?.role !== 'owner') return { status: 403, error: 'Alleen de eigenaar kan herstellen.' };
  return { userId: data.user.id };
}
