const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const swc = require('next/dist/build/swc');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')((name) => mocks[name] || (name.startsWith('.') ? load(path.join(path.dirname(file), name) + '.js', mocks) : require(name)), module, module.exports);
  return module.exports;
}
function db(handler) {
  return { from(table) {
    const calls = [];
    const q = new Proxy({}, { get: (_, key) => key === 'then' ? (ok, fail) => Promise.resolve(handler(table, calls)).then(ok, fail) : (...args) => { calls.push([key, ...args]); return q; } });
    return q;
  } };
}
function request(body, token = 'session') { return new Request('https://example.com/api/integrations/whatsapp/connect', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
const owner = [{ business_id: null, location_id: null, role: { role_key: 'owner' } }];

test('shared authorization requires workspace-wide scope; venue numbers stay separate', async () => {
  await swc.loadBindings();
  const { canManageWhatsapp, whatsappReplyWindow, whatsappConfiguration, parseWhatsappSignupEvent } = load('lib/whatsapp-business.js');
  assert.equal(canManageWhatsapp(owner), true);
  const venue = [{ business_id: 'cc', role: { role_key: 'custom' }, assignment_permissions: [{ permission: 'social:manage' }] }];
  assert.equal(canManageWhatsapp(venue), false); assert.equal(canManageWhatsapp(venue, 'cc'), true); assert.equal(canManageWhatsapp(venue, 'plein'), false);
  assert.equal(canManageWhatsapp([{ ...owner[0], location_id: 'location' }]), false);
  assert.equal(whatsappReplyWindow(new Date(Date.now() - 23 * 3600000).toISOString()), true);
  assert.equal(whatsappReplyWindow(new Date(Date.now() - 24 * 3600000).toISOString()), false);
  assert.equal(whatsappReplyWindow(null), false); assert.equal(whatsappReplyWindow('bad'), false);
  assert.equal(whatsappConfiguration({}, 'https://example.com').ready, false);
  const event = { origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '123' } }) };
  assert.deepEqual(parseWhatsappSignupEvent(event), { wabaId: '123', phoneNumberId: '' });
  assert.equal(parseWhatsappSignupEvent({ ...event, origin: 'https://www.facebook.com.evil.test' }), null);
  assert.equal(parseWhatsappSignupEvent({ ...event, data: event.data.replace('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH') }), null);
});

test('connect refuses unauthorized shared scope, migration and replacing an existing number; both scopes can save', async () => {
  await swc.loadBindings();
  const oldFetch = global.fetch;
  const envNames = ['META_APP_ID','META_APP_SECRET','META_TOKEN_ENCRYPTION_KEY','WHATSAPP_CONFIG_ID','WHATSAPP_VERIFY_TOKEN'];
  const oldEnv = Object.fromEntries(envNames.map(k => [k, process.env[k]])); envNames.forEach(k => process.env[k] = 'test');
  let assignments = owner, coexistence = true, existing = null, fetches = [], writes = [];
  const admin = db((table, calls) => {
    const write = calls.find(c => ['insert','update','upsert'].includes(c[0]));
    if (write) { writes.push({ table, value: write[1] }); return { data: { id: 'account' } }; }
    if (calls.some(c => c[0] === 'maybeSingle')) return { data: existing };
    return { data: [] };
  });
  const client = { ...db(table => ({ data: table === 'businesses' ? { id: 'plein' } : assignments })), auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } };
  const route = load('app/api/integrations/whatsapp/connect/route.js', {
    '../../../../../lib/server-supabase': { createUserSupabase: () => client, createAdminSupabase: () => admin },
    '../../../../../lib/meta-oauth': { encryptMetaToken: () => ({ ciphertext: 'encrypted', iv: 'iv', tag: 'tag' }) },
  });
  global.fetch = async (url, options) => {
    const str = String(url); fetches.push({ url: str, options });
    if (str.includes('oauth/access_token')) return Response.json({ access_token: 'private-token' });
    if (str.includes('me/permissions')) return Response.json({ data: ['whatsapp_business_management','whatsapp_business_messaging'].map(permission => ({ permission, status: 'granted' })) });
    if (str.includes('subscribed_apps')) return Response.json({ success: true });
    return Response.json({ id: '123', phone_numbers: { data: [{ id: '456', is_on_biz_app: coexistence, display_phone_number: '+31600000000' }] } });
  };
  const body = { workspaceId: 'workspace', shared: true, code: 'code', wabaId: '123', phoneNumberId: '456' };
  try {
    assert.equal((await route.POST(request(body, ''))).status, 401);
    assignments = [{ business_id: 'cc', role: { role_key: 'owner' } }];
    assert.equal((await route.POST(request(body))).status, 403); assert.equal(fetches.length, 0);
    assignments = owner; coexistence = false;
    assert.equal((await route.POST(request(body))).status, 502); assert.equal(writes.length, 0); assert.ok(!fetches.some(c => c.url.includes('subscribed_apps')));
    coexistence = true; existing = { id: 'account', external_account_id: '999' };
    assert.equal((await route.POST(request(body))).status, 409); assert.equal(writes.length, 0);
    existing = null;
    assert.equal((await route.POST(request(body))).status, 200);
    const credential = writes.find(w => w.table === 'integration_credentials').value;
    assert.equal(credential.business_id, null); assert.equal(credential.token_ciphertext, 'encrypted');
    assert.equal(writes[0].value.connection_status, 'pending'); assert.equal(writes.at(-1).value.connection_status, 'connected');
    writes = [];
    assert.equal((await route.POST(request({ ...body, shared: false, businessId: 'plein' }))).status, 200);
    assert.equal(writes.find(w => w.table === 'integration_credentials').value.business_id, 'plein');
    assert.ok(!fetches.some(c => /\/register/.test(c.url)), 'never migrates/registers the phone');
  } finally { global.fetch = oldFetch; for (const key of envNames) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; } }
});

test('webhook verifies signatures, preserves shared scope, handles duplicate/retry and business-app echoes', async () => {
  await swc.loadBindings();
  const oldSecret = process.env.WHATSAPP_APP_SECRET; process.env.WHATSAPP_APP_SECRET = 'test-secret';
  let insertError = null, inserted = [];
  const admin = db((table, calls) => {
    if (table === 'integration_accounts') return { data: { id: 'account', workspace_id: 'workspace', business_id: null } };
    const write = calls.find(c => c[0] === 'insert');
    if (write) { inserted.push(write[1]); return { error: insertError }; }
    return { data: null };
  });
  const route = load('app/api/integrations/whatsapp/webhook/route.js', { '../../../../../lib/server-supabase': { createAdminSupabase: () => admin } });
  const message = { id: 'wamid.1', from: '31600000000', to: '31611111111', timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: 'Test' } };
  function hook(echo = false, valid = true) {
    const body = JSON.stringify({ entry: [{ changes: [{ field: echo ? 'smb_message_echoes' : 'messages', value: { metadata: { phone_number_id: '456' }, [echo ? 'message_echoes' : 'messages']: [message] } }] }] });
    return new Request('https://example.com/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=' + (valid ? crypto.createHmac('sha256', 'test-secret').update(body).digest('hex') : 'bad') } });
  }
  try {
    assert.equal((await route.POST(hook(false, false))).status, 401); assert.equal(inserted.length, 0);
    assert.equal((await route.POST(hook())).status, 200); assert.equal(inserted[0].business_id, null); assert.equal(inserted[0].direction, 'inbound');
    insertError = { code: '23505' }; assert.equal((await route.POST(hook())).status, 200);
    insertError = { code: 'storage_failed' }; assert.equal((await route.POST(hook())).status, 503);
    insertError = null; assert.equal((await route.POST(hook(true))).status, 200); assert.equal(inserted.at(-1).direction, 'outbound'); assert.equal(inserted.at(-1).media[0].recipient_id, message.to);
  } finally { if (oldSecret === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = oldSecret; }
});

test('reply checks the actual inbox and latest inbound window before sending via its own number', async () => {
  await swc.loadBindings();
  const oldFetch = global.fetch; let sends = 0, assignments = owner, recent = new Date().toISOString(), writes = [];
  const client = { ...db((table, calls) => {
    if (table === 'user_role_assignments') return { data: assignments };
    if (calls.some(c => c[0] === 'contains')) return { data: { published_at: recent } };
    assert.ok(calls.some(c => c[0] === 'is' && c[1] === 'business_id' && c[2] === null));
    return { data: { id: 'item', account_id: 'account', external_id: 'wamid.in', media: [{ sender_id: '31600000000' }] } };
  }), auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } };
  const admin = db((table, calls) => {
    const write = calls.find(c => ['insert','update'].includes(c[0])); if (write) { writes.push(write); return {}; }
    return { data: table === 'integration_accounts' ? { id: 'account', external_account_id: '456', display_name: 'Shared' } : { token_ciphertext: 'encrypted' } };
  });
  const route = load('app/api/integrations/whatsapp/reply/route.js', { '../../../../../lib/server-supabase': { createUserSupabase: () => client, createAdminSupabase: () => admin }, '../../../../../lib/meta-oauth': { decryptMetaToken: () => 'token' } });
  global.fetch = async (url, options) => { sends++; assert.ok(url.endsWith('/456/messages')); assert.equal(JSON.parse(options.body).to, '31600000000'); return Response.json({ messages: [{ id: 'wamid.out' }] }); };
  const body = { workspaceId: 'workspace', businessId: null, itemId: 'item', message: 'Antwoord' };
  try {
    assignments = [{ business_id: 'cc', role: { role_key: 'owner' } }];
    assert.equal((await route.POST(request(body))).status, 403); assert.equal(sends, 0);
    assignments = owner; recent = '2020-01-01'; assert.equal((await route.POST(request(body))).status, 409); assert.equal(sends, 0);
    recent = new Date().toISOString(); assert.equal((await route.POST(request(body))).status, 200); assert.equal(sends, 1); assert.equal(writes[0][1].business_id, null);
  } finally { global.fetch = oldFetch; }
});

test('connection UI offers shared and two individual numbers and accepts both callback orders', async () => {
  await swc.loadBindings(); const React = require('react'), Renderer = require('react-test-renderer'); global.IS_REACT_ACT_ENVIRONMENT = true;
  const Script = () => null;
  const Component = load('components/whatsapp-business-connection.js', { 'next/script': { __esModule: true, default: Script } }).default;
  const oldWindow = global.window, oldFetch = global.fetch; let listener, loginCallback, posted = [], refreshed = 0, renderer;
  global.window = { addEventListener: (_, fn) => { listener = fn; }, removeEventListener() {}, confirm: () => true, FB: { init() {}, login(cb, config) { loginCallback = cb; assert.equal(config.extras.featureType, 'whatsapp_business_app_onboarding'); } } };
  global.fetch = async (_, options) => { posted.push(JSON.parse(options.body)); return Response.json({ account: { displayName: 'Shared' } }); };
  const props = { workspaceId: 'workspace', session: { access_token: 'session' }, configuration: { ready: true, canManageShared: true, embeddedSignup: { ready: true, appId: '123', configId: '456' } }, accounts: [], businesses: [{ id: 'cc', name: 'Caribbean Corner' }, { id: 'plein', name: 'Grandcafé Het Plein' }], onConnected: async () => { refreshed++; } };
  const button = text => renderer.root.findAllByType('button').find(n => n.props.children === text);
  const finish = { origin: 'https://www.facebook.com', data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '123' } } };
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
    assert.equal(renderer.root.findAllByType('option').length, 3); assert.equal(posted.length, 0);
    await React.act(async () => button('WhatsApp Business-koppeling openen').props.onClick());
    await React.act(async () => renderer.root.findByType(Script).props.onReady());
    await React.act(async () => button('Verbinden via Meta').props.onClick());
    await React.act(async () => { loginCallback({ authResponse: { code: 'code' } }); }); assert.equal(posted.length, 0);
    await React.act(async () => { listener(finish); }); assert.equal(posted[0].shared, true);
    await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'plein' } }));
    await React.act(async () => button('Verbinden via Meta').props.onClick());
    await React.act(async () => { listener(finish); }); assert.equal(posted.length, 1);
    await React.act(async () => { loginCallback({ authResponse: { code: 'next-code' } }); }); assert.equal(posted[1].businessId, 'plein'); assert.equal(refreshed, 2);
    await React.act(async () => renderer.update(React.createElement(Component, { ...props, configuration: { ready: false, missing: ['WHATSAPP_CONFIG_ID'] } })));
    assert.equal(button('Verbinden via Meta').props.disabled, true);
  } finally { if (renderer) await React.act(async () => renderer.unmount()); global.window = oldWindow; global.fetch = oldFetch; }
});
