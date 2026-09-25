const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const Renderer = require('react-test-renderer');
const swc = require('next/dist/build/swc');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
async function load(file, mocks = {}) {
  await swc.loadBindings();
  function compile(relative) {
    const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
      filename: relative, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
    });
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(
      name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.startsWith('.') ? compile(path.join(path.dirname(relative), name) + '.js') : require(name), module, module.exports);
    return module.exports;
  }
  return compile(file);
}
const photo = { type: 'image', url: 'https://images.example.com/photo.jpg' };
const video = { type: 'video', url: 'https://images.example.com/video.mp4' };

test('Instagram formats validate media count, captions, URLs and native container fields', async () => {
  const { validateInstagramDraft: validate, instagramContainerValues: values } = await load('lib/instagram-publishing.js');
  for (const format of ['feed', 'story', 'carousel', 'reel']) {
    const draft = validate({ format, caption: 'Hello', shareToFeed: true, assets: format === 'carousel' ? [photo, video] : [format === 'reel' ? video : photo] });
    assert.equal(draft.format, format);
    assert.equal(values(draft, draft.assets[0]).media_type, format === 'reel' ? 'REELS' : format === 'story' ? 'STORIES' : undefined);
    if (format === 'story') { assert.equal(draft.caption, ''); assert.equal(values(draft, photo).caption, undefined); }
  }
  assert.equal(values({ format: 'carousel' }, video, true).media_type, 'VIDEO');
  assert.equal(values({ format: 'carousel' }, photo, true).is_carousel_item, 'true');
  for (const format of ['toString', '__proto__', 'invalid']) assert.throws(() => validate({ format, assets: [photo] }));
  assert.throws(() => validate({ format: 'feed', assets: [video] }));
  assert.throws(() => validate({ format: 'reel', assets: [photo] }));
  assert.throws(() => validate({ format: 'carousel', assets: [photo] }));
  assert.throws(() => validate({ format: 'feed', caption: 'x'.repeat(2201), assets: [photo] }));
  for (const url of ['http://example.com/a.jpg', 'https://user:pass@example.com/a.jpg', 'https://127.0.0.1/a.jpg']) assert.throws(() => validate({ format: 'feed', assets: [{ ...photo, url }] }));
});

async function routeHarness({ denied = false, publishFailure = false, businessType = 'BUSINESS' } = {}) {
  const campaign = { id: 'c', business_id: 'b', media: [{ kind: 'image', url: 'keep' }, { kind: 'campaign_distribution', common: { title: 'Keep title' }, provider_delivery: { facebook: { status: 'confirmed' } } }] };
  const account = { id: 'a', external_account_id: 'ig', display_name: 'venue', connection_status: 'connected', granted_scopes: ['instagram_business_content_publish'] };
  const calls = [];
  function query(table) {
    const filters = {}; let patch;
    const result = () => {
      if (table === 'social_content_items') {
        if (filters.workspace_id !== 'w' || filters.business_id !== 'b' || filters.id !== 'c') return { data: null };
        if (patch) {
          if (filters.media !== JSON.stringify(campaign.media)) return { data: null };
          campaign.media = patch.media;
          return { data: { id: 'c' } };
        }
        return { data: structuredClone(campaign) };
      }
      if (table === 'integration_accounts') return { data: filters.workspace_id === 'w' && filters.business_id === 'b' ? account : null };
      if (table === 'integration_credentials') {
        assert.equal(filters.workspace_id, 'w'); assert.equal(filters.business_id, 'b'); assert.equal(filters.account_id, 'a');
        return { data: { token_ciphertext: 'secret' } };
      }
      if (table === 'user_role_assignments') return { data: [{ business_id: denied ? 'other' : 'b', role: { role_key: 'owner' } }] };
    };
    let builder;
    builder = new Proxy({}, { get: (_, key) => {
      if (key === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
      if (key === 'maybeSingle') return async () => result();
      if (key === 'eq') return (field, value) => { filters[field] = value; return builder; };
      if (key === 'update') return value => { patch = value; return builder; };
      return () => builder;
    } });
    return builder;
  }
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, values: options.body ? Object.fromEntries(options.body) : {} });
    let data = {};
    if (url.includes('account_type')) data = { account_type: businessType };
    else if (url.endsWith('/media_publish')) { if (publishFailure) throw new Error('network'); data = { id: 'published' }; }
    else if (url.endsWith('/media')) data = { id: 'container' + calls.length };
    else if (url.includes('status_code')) data = { status_code: 'FINISHED' };
    else if (url.includes('permalink')) data = { permalink: 'https://www.instagram.com/p/example/' };
    return { ok: true, json: async () => data };
  };
  const server = { from: query, auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } };
  const route = await load('app/api/integrations/meta/publish/route.js', {
    '../../../../../lib/server-supabase': { createUserSupabase: () => server, createAdminSupabase: () => server },
    '../../../../../lib/meta-oauth': { decryptMetaToken: () => 'private-token' },
  });
  async function post(action, extra = {}) {
    const response = await route.POST(new Request('https://app.example/api', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w', businessId: 'b', campaignId: 'c', format: 'feed', action, ...extra }) }));
    return { status: response.status, ...await response.json() };
  }
  return { post, calls, campaign, route };
}

test('prepare, readiness and explicit publication are separate; concurrent clicks publish once', async () => {
  const h = await routeHarness();
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo], caption: 'Text' } });
  assert.equal(prepared.job.status, 'processing');
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 0);
  const operationId = prepared.job.operation_id;
  assert.equal((await h.post('publish', { operationId })).status, 409);
  assert.equal((await h.post('status', { operationId })).job.status, 'ready');
  const results = await Promise.all([h.post('publish', { operationId, confirm: true }), h.post('publish', { operationId, confirm: true })]);
  assert.ok(results.some(result => result.job?.status === 'published'));
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
  assert.equal((await h.post('publish', { operationId, confirm: true })).job.status, 'published');
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
  assert.equal(h.campaign.media[0].url, 'keep');
  assert.equal(h.campaign.media[1].provider_delivery.facebook.status, 'confirmed');
  assert.equal(h.campaign.media[1].common.title, 'Keep title');
});

test('uncertain publish is persisted and cannot be reset or republished by retry', async () => {
  const h = await routeHarness({ publishFailure: true });
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } });
  const operationId = prepared.job.operation_id;
  await h.post('status', { operationId });
  assert.equal((await h.post('publish', { operationId, confirm: true })).job.status, 'unknown');
  assert.equal((await h.post('status', { operationId })).job.status, 'unknown');
  await h.post('publish', { operationId, confirm: true });
  assert.equal((await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } })).status, 409);
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
});

test('other venue, stale destination, missing confirmation and creator Story are rejected', async () => {
  const denied = await routeHarness({ denied: true });
  assert.equal((await denied.post('prepare')).status, 403);
  assert.equal(denied.calls.length, 0);
  const h = await routeHarness({ businessType: 'MEDIA_CREATOR' });
  assert.equal((await h.post('prepare', { accountId: 'wrong', draft: { assets: [photo] } })).status, 409);
  assert.equal((await h.post('prepare', { accountId: 'a', format: 'story', draft: { assets: [photo] } })).status, 409);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal((await h.post('prepare', { businessId: 'other' })).status, 403);
});

test('Instagram composer exposes all four formats without automatic network or publication', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected'); };
  const Component = (await load('components/instagram-event-publisher.js', { '../lib/supabase': { supabase: {} } })).default;
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: 'c', media: [] }, businessName: 'Venue' })); });
  try {
    const selector = renderer.root.findAllByType('select')[0];
    assert.deepEqual(selector.findAllByType('option').map(option => option.props.value), ['feed', 'carousel', 'story', 'reel']);
    assert.equal(calls, 0);
    const prepare = renderer.root.findAllByType('button').find(button => String(button.props.children).startsWith('Voorbeeld klaarzetten'));
    assert.equal(prepare.props.disabled, true, 'account must be checked before prepare');
    await React.act(async () => selector.props.onChange({ target: { value: 'reel' } }));
    assert.equal(calls, 0, 'format changes do not publish');
    assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 0, 'unsupported local video upload is not offered');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('event media includes stored image profiles, videos and linked sources without duplicates or other venues', async () => {
  const { instagramEventMedia } = await load('lib/instagram-event-media.js');
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'campaign_distribution',
    common: { images: { portrait: { url: photo.url, label: 'Poster' }, square: { url: 'https://images.example.com/square.jpg' } }, video_url: video.url },
    campaign_assets: [{ url: photo.url }, { url: 'https://images.example.com/clip', content_type: 'video/mp4' }, { url: 'https://images.example.com/picture.png', content_type: 'image/png' }],
  }, { kind: 'image', url: 'https://images.example.com/extra.jpg' }, { kind: 'image', url: 'javascript:alert(1)' }] };
  const linked = (businessId, url) => ({ label: 'Facebook', item: { business_id: businessId, media: [{ kind: 'campaign_distribution', common: { image_url: url } }] } });
  const media = instagramEventMedia(item, [linked('b', 'https://images.example.com/linked.jpg'), linked('other', 'https://images.example.com/private.jpg')]);
  assert.equal(media.filter(asset => asset.url === photo.url).length, 1);
  assert.equal(media.find(asset => asset.url === video.url).type, 'video');
  assert.equal(media.find(asset => asset.url.endsWith('/clip')).type, 'video');
  assert.equal(media.find(asset => asset.url.endsWith('.png')).issue, '');
  assert.equal(media.find(asset => asset.url.endsWith('.png')).needsJpeg, true);
  assert.ok(media.some(asset => asset.label.includes('Gekoppeld Facebook')));
  assert.ok(media.every(asset => !asset.url.includes('private') && asset.url.startsWith('https://')));
  assert.equal(media.length, 7);
});

test('stored event media can be selected when sources arrive, without upload, duplicate selection or publication', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected'); };
  const Component = (await load('components/instagram-event-publisher.js')).default;
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'campaign_distribution', common: { video_url: video.url } }] };
  const linkedSources = [{ label: 'Eventin', item: { business_id: 'b', media: [{ kind: 'campaign_distribution', common: { image_url: photo.url } }] } }];
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item, mediaLoading: true })); });
  try {
    assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 0, 'no computer file picker');
    await React.act(async () => renderer.update(React.createElement(Component, { item, linkedSources })));
    const choices = () => renderer.root.findAllByType('button').filter(button => button.props['aria-label']?.startsWith('Kies '));
    const photoChoice = () => choices().find(button => button.props['aria-label'].startsWith('Kies foto'));
    const videoChoice = () => choices().find(button => button.props['aria-label'].startsWith('Kies video'));
    assert.equal(videoChoice().props.disabled, true, 'feed requires a photo');
    await React.act(async () => photoChoice().props.onClick());
    assert.equal(photoChoice().props.children, 'Gekozen');
    await React.act(async () => photoChoice().props.onClick());
    assert.equal(renderer.root.findAllByProps({ className: 'instagramAsset' }).length, 1);
    assert.equal(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('img').props.src, photo.url);
    await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'reel' } }));
    assert.equal(photoChoice().props.disabled, true, 'reel requires a video');
    await React.act(async () => videoChoice().props.onClick());
    assert.equal(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('video').props.src, video.url);
    assert.equal(calls, 0, 'selection does not upload, query or publish');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('PNG selection makes a local JPEG preview, saves only on prepare, never publishes and deduplicates retries', async () => {
  const calls = []; let conversions = 0, uploads = 0, renderer;
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
  const Component = (await load('components/instagram-event-publisher.js', {
    '../lib/instagram-photo': {
      prepareInstagramPhoto: async () => { conversions++; return { blob: jpeg, width: 1080, height: 1350 }; },
      uploadInstagramPhoto: async (blob, scope) => { uploads++; assert.equal(blob, jpeg); assert.deepEqual(scope, { workspaceId: 'w', businessId: 'b', campaignId: 'c' }); return photo.url; },
    },
  })).default;
  global.fetch = async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.action || 'status');
    if (body) { assert.equal(body.draft.assets[0].url, photo.url); return { ok: false, json: async () => ({ error: 'Test: preparation failed before publication' }) }; }
    return { ok: true, json: async () => ({ account: { id: 'a', name: 'venue' }, publications: {} }) };
  };
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'image', url: 'https://images.example.com/poster.png' }] };
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item, workspaceId: 'w' })); });
  const button = text => renderer.root.findAllByType('button').find(b => b.props.children === text);
  try {
    assert.equal(button('Deze foto gebruiken').props.disabled, false);
    await React.act(async () => button('Deze foto gebruiken').props.onClick());
    assert.equal(conversions, 1); assert.equal(uploads, 0); assert.deepEqual(calls, []);
    assert.ok(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('img').props.src.startsWith('blob:'));
    assert.equal(button('Gekozen').props.disabled, true);
    await React.act(async () => button('Gekozen').props.onClick());
    assert.equal(conversions, 1);
    await React.act(async () => button('Instagram-account controleren').props.onClick());
    await React.act(async () => button('Voorbeeld klaarzetten — nog niet publiceren').props.onClick());
    await React.act(async () => button('Voorbeeld klaarzetten — nog niet publiceren').props.onClick());
    assert.equal(uploads, 1, 'reuse the saved JPEG after a failed preparation');
    assert.deepEqual(calls, ['status', 'prepare', 'prepare']);
    for (const format of ['feed', 'carousel', 'story', 'reel']) {
      await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: format } }));
      const help = renderer.root.findByProps({ className: 'instagramFormatHelp' });
      const text = n => typeof n === 'string' ? n : (n.children || []).map(text).join(' ');
      assert.match(text(help), format === 'feed' || format === 'carousel' ? /1080 × 1350/ : /1080 × 1920/);
    }
    assert.equal(button('Deze foto gebruiken').props.disabled, true, 'a photo cannot become a reel');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('failed PNG conversion displays an error and leaves no selected photo or upload', async () => {
  let renderer, uploads = 0;
  const Component = (await load('components/instagram-event-publisher.js', {
    '../lib/instagram-photo': { prepareInstagramPhoto: async () => { throw new Error('Foto niet leesbaar'); }, uploadInstagramPhoto: async () => { uploads++; } },
  })).default;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: 'c', media: [{ kind: 'image', url: 'https://images.example.com/a.webp' }] } })); });
  try {
    const choice = () => renderer.root.findAllByType('button').find(b => b.props.children === 'Deze foto gebruiken');
    await React.act(async () => choice().props.onClick());
    assert.equal(renderer.root.findByProps({ role: 'alert' }).props.children, 'Foto niet leesbaar');
    assert.equal(renderer.root.findAllByProps({ className: 'instagramAsset' }).length, 0);
    assert.equal(choice().props.disabled, false); assert.equal(uploads, 0);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('JPEG conversion preserves the complete image, paints transparency white and rejects unsupported/oversize sources', async () => {
  const originalWindow = global.window, originalDocument = global.document;
  const drawn = [], revoked = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = value => { revoked.push(value); originalRevoke.call(URL, value); };
  const { prepareInstagramPhoto: convert } = await load('lib/instagram-photo.js');
  const source = { type: 'image/png' };
  global.fetch = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.mode, 'cors');
    return { ok: true, headers: new Headers(), blob: async () => new Blob(['image'], { type: source.type }) };
  };
  global.window = { Image: class { naturalWidth = 2160; naturalHeight = 2700; set src(value) { if (value) queueMicrotask(() => this.onload?.()); } } };
  const context = { fillRect: (...args) => drawn.push(['background', context.fillStyle, ...args]), drawImage: (...args) => drawn.push(['draw', ...args.slice(1)]) };
  global.document = { createElement: () => ({ getContext: () => context, toBlob: (callback, type) => callback(new Blob(['jpeg'], { type })) }) };
  try {
    const result = await convert({ url: photo.url });
    assert.equal(result.blob.type, 'image/jpeg'); assert.equal(result.width, 1440); assert.equal(result.height, 1800);
    assert.deepEqual(drawn, [['background', '#ffffff', 0, 0, 1440, 1800], ['draw', 0, 0, 1440, 1800]]);
    assert.equal(revoked.length, 1);
    source.type = 'image/gif'; await assert.rejects(() => convert({ url: photo.url }), /ondersteunde foto/);
    global.fetch = async () => ({ ok: true, headers: new Headers({ 'content-length': String(11 * 1024 * 1024) }) });
    await assert.rejects(() => convert({ url: photo.url }), /10 MB/);
    global.fetch = async () => { throw new Error('CORS'); };
    await assert.rejects(() => convert({ url: photo.url }), /niet bereikbaar/);
  } finally { global.window = originalWindow; global.document = originalDocument; URL.revokeObjectURL = originalRevoke; }
});

test('JPEG storage uses event-scoped paths, insert-only uploads and never bypasses denied access', async () => {
  const calls = []; let denied = false;
  const { uploadInstagramPhoto: upload } = await load('lib/instagram-photo.js', {
    './supabase': { supabase: { storage: { from: bucket => {
      assert.equal(bucket, 'marketing-assets');
      return { upload: async (path, blob, options) => { calls.push({ path, blob, options }); return { error: denied ? { message: 'Permission denied' } : null }; }, getPublicUrl: path => ({ data: { publicUrl: `https://images.example.com/${path}` } }) };
    } } } },
  });
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  const scope = { workspaceId: 'workspace', businessId: 'venue', campaignId: 'event' };
  assert.match(await upload(blob, scope), /^https:\/\/images.example.com\/workspace\/venue\/instagram-event-.*\.jpg$/);
  assert.equal(calls[0].options.upsert, false); assert.equal(calls[0].options.contentType, 'image/jpeg');
  await assert.rejects(() => upload(blob, { ...scope, businessId: '../other' }), /ontbreekt/);
  await assert.rejects(() => upload(new Blob(['png'], { type: 'image/png' }), scope), /niet geschikt/);
  assert.equal(calls.length, 1);
  denied = true; await assert.rejects(() => upload(blob, scope), /Permission denied/);
  assert.equal(calls.length, 2, 'no privileged fallback or automatic retry');
});

test('all publication formats create the correct containers, without publishing', async () => {
  for (const format of ['feed', 'carousel', 'story', 'reel']) {
    const h = await routeHarness();
    const assets = format === 'carousel' ? [photo, video] : [format === 'reel' ? video : photo];
    const result = await h.post('prepare', { format, accountId: 'a', draft: { assets, caption: 'Text', shareToFeed: true } });
    assert.equal(result.job.status, 'processing', format);
    const containers = h.calls.filter(call => call.url.endsWith('/media'));
    assert.equal(containers.length, format === 'carousel' ? 3 : 1);
    assert.equal(containers.at(-1).values.media_type, ({ carousel: 'CAROUSEL', story: 'STORIES', reel: 'REELS' })[format]);
    if (format === 'story') assert.equal(containers[0].values.caption, undefined);
    if (format === 'reel') assert.equal(containers[0].values.share_to_feed, 'true');
    assert.equal(h.calls.filter(call => call.url.endsWith('/media_publish')).length, 0);
  }
});

test('unpublished preparations can be edited; started publications cannot be reset', async () => {
  const h = await routeHarness();
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } });
  const discarded = await h.post('discard', { operationId: prepared.job.operation_id });
  assert.equal(discarded.job.status, 'draft');
  assert.equal(discarded.job.container_id, null);
  assert.equal((await h.post('publish', { operationId: prepared.job.operation_id, confirm: true })).status, 409);
  const again = await h.post('prepare', { accountId: 'a', draft: { assets: [photo], caption: 'Updated text' } });
  assert.equal(again.job.draft.caption, 'Updated text');
  await h.post('status', { operationId: again.job.operation_id });
  await h.post('publish', { operationId: again.job.operation_id, confirm: true });
  assert.equal((await h.post('discard', { operationId: again.job.operation_id })).status, 502);
  assert.equal(h.campaign.media[1].instagram_publications.feed.status, 'published');
});
