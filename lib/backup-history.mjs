export function historySummary(check) {
  if (!check) return 'Wijzigingen niet vastgelegd';
  if (!check.compared_to) return 'Eerste inhoudsmeting — geen eerdere vergelijking';
  if (!check.changes.length) return 'Geen wijziging in de vergeleken tabelinhoud';
  if (check.changes.every(c => /^(public\.backup_|supabase_migrations\.)/.test(c.table))) return 'Alleen technische gegevens gewijzigd';
  return `${check.changes.length} tabel${check.changes.length === 1 ? '' : 'len'} met gewijzigde inhoud`;
}

export function tableLabel(name) {
 const labels = { 'public.backup_database_runs':'Registratie databaseback-ups', 'public.backup_file_jobs':'Registratie bestandskopieën', 'public.backup_file_settings':'Instellingen bestandskopie', 'public.backup_content_checks':'Wijzigingscontroles back-ups', 'public.backup_restore_checks':'Proefherstelcontroles', 'supabase_migrations.schema_migrations':'Databaseversies', 'public.guests':'Gasten', 'public.quote_drafts':'Offertes', 'public.marketing_events':'Marketingevenementen' };
 return labels[name] || name.replace(/^public\./,'').replaceAll('_',' ');
}

export function restoreSummary(check) {
  if (!check) return 'Nog geen proefherstel voor deze kopie';
  if (!check.local_server_stopped) return 'Aandacht nodig: stoppen van de testdatabase niet bevestigd';
  if (check.archive_restored) return 'Databasearchief getest; volledig herstel met bestanden nog niet vrijgegeven';
  if (check.category === 'MANAGED_SCHEMA_MISSING') return 'Proefherstel geblokkeerd: Supabase-onderdelen ontbreken in de testdatabase';
  return 'Proefherstel niet geslaagd — technische controle nodig';
}

export function validateDetail(value, now = Date.now()) {
  const run = v => typeof v === 'string' && /^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(v);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
  if (!exact(value,['type','data'])) throw Error('INVALID_DETAIL');
  const d=value.data;
  if (!run(d?.run_id) || !Number.isFinite(Date.parse(d.checked_at)) || Date.parse(d.checked_at)>now+300000) throw Error('INVALID_DETAIL');
  if (value.type==='content') {
    if (!exact(d,['run_id','compared_to','checked_at','table_count','changes','schema_compared']) || !(d.compared_to===null || (run(d.compared_to) && d.compared_to<d.run_id)) || !integer(d.table_count) || d.table_count>10000 || d.schema_compared!==false || !Array.isArray(d.changes) || d.changes.length>1000) throw Error('INVALID_CONTENT');
    const names=new Set();
    for(const c of d.changes) {
      if(!exact(c,['table','before','after','state']) || !/^(public|private|supabase_migrations)\.[a-z_][a-z_0-9]*$/.test(c.table) || names.has(c.table) || !['changed','added','removed'].includes(c.state) || ![c.before,c.after].every(v=>v===null||integer(v))) throw Error('INVALID_CHANGE');
      if((c.state==='changed'&&(c.before===null||c.after===null)) || (c.state==='added'&&(c.before!==null||c.after===null)) || (c.state==='removed'&&(c.after!==null||c.before===null)))throw Error('INVALID_CHANGE');
      names.add(c.table);
    }
    if(d.compared_to===null && d.changes.length)throw Error('INVALID_BASELINE');
    return {table:'backup_content_checks',conflict:'run_id',data:d};
  }
  if(value.type==='restore') {
    if(!exact(d,['run_id','checked_at','archive_sha256','archive_restored','local_server_stopped','production_touched','category']) || !/^[a-f0-9]{64}$/.test(d.archive_sha256) || typeof d.archive_restored!=='boolean' || typeof d.local_server_stopped!=='boolean' || d.production_touched!==false || !['MANAGED_SCHEMA_MISSING','REQUIRED_ROLE_MISSING','REQUIRED_EXTENSION_MISSING','LOCAL_RESTORE_FAILED','EXISTING_OBJECT_CONFLICT','APPLICATION_ARCHIVE_RESTORED'].includes(d.category) || (d.archive_restored && (!d.local_server_stopped||d.category!=='APPLICATION_ARCHIVE_RESTORED')))throw Error('INVALID_RESTORE');
    return {table:'backup_restore_checks',conflict:'run_id,checked_at',data:d};
  }
  throw Error('INVALID_TYPE');
}
