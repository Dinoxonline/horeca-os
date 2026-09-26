// Run with @electric-sql/pglite available on NODE_PATH. Uses an isolated in-memory PostgreSQL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); } catch { /* Optional isolated database test runtime. */ }
test('quote migration: owner/MFA RLS, tenant foreign keys, atomic immutable versions, no deletes', { skip: !PGlite }, async () => {
  const db = new PGlite();
  const w = '10000000-0000-4000-8000-000000000001', b = '10000000-0000-4000-8000-000000000002', g = '10000000-0000-4000-8000-000000000003', q = '10000000-0000-4000-8000-000000000004', other = '20000000-0000-4000-8000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true)) $$;
      grant usage on schema auth, private, public to authenticated;
      create table public.workspaces(id uuid primary key);
      create table public.businesses(id uuid primary key, workspace_id uuid references workspaces, unique(id,workspace_id));
      create table public.workspace_members(workspace_id uuid, user_id uuid, role text);
      insert into workspaces values ('${w}'),('${other}');
      insert into businesses values ('${b}','${w}'),('${other}','${other}');
      insert into workspace_members values ('${w}','${g}','owner');`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260926114439_guests_quote_drafts.sql'), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${g}'; set request.jwt.claim.aal='aal1';`);
    await assert.rejects(db.exec(`insert into crm_guests(id,workspace_id,name) values ('${g}','${w}','Test')`), /row-level security/);
    await db.exec(`set request.jwt.claim.aal='aal2'; insert into crm_guests(id,workspace_id,name) values ('${g}','${w}','Test');`);
    await assert.rejects(db.exec(`insert into crm_guests(id,workspace_id,name) values ('${q}','${other}','Forbidden')`), /row-level security/);
    await assert.rejects(db.exec(`insert into quote_drafts(id,workspace_id,business_id,guest_id,guest_snapshot,content) values ('${q}','${w}','${other}','${g}','{}','{}')`), /foreign key/);
    await db.exec(`insert into quote_drafts(id,workspace_id,business_id,guest_id,guest_snapshot,content) values ('${q}','${w}','${b}','${g}','{"name":"Test"}','{"title":"V1"}');`);
    await db.exec(`update quote_drafts set content='{"title":"V2"}' where id='${q}' and version=1; update quote_drafts set content='{"title":"Stale"}' where id='${q}' and version=1;`);
    const versions = (await db.query('select version,snapshot from quote_versions order by version')).rows;
    assert.equal(versions.length, 2); assert.equal(versions[0].snapshot.content.title, 'V1'); assert.equal(versions[1].snapshot.content.title, 'V2');
    await assert.rejects(db.exec('delete from quote_drafts'), /permission denied/);
    await assert.rejects(db.exec("update quote_versions set snapshot='{}'"), /permission denied/);
    await assert.rejects(db.exec(`update quote_drafts set workspace_id='${other}'`), /permission denied/);
    await assert.rejects(db.exec('update crm_guests set version=500'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select * from crm_guests')).rows.length, 0); assert.equal((await db.query('select * from quote_versions')).rows.length, 0);
    await db.exec(`set request.jwt.claim.sub='${g}'; set request.jwt.claim.aal='aal1';`);
    assert.equal((await db.query('select * from quote_drafts')).rows.length, 0);
  } finally { await db.close(); }
});
