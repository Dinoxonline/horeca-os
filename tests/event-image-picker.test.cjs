const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../components/central-event-creator.js'), 'utf8');

function harness({ failed = false, busy = '' } = {}) {
  const fn = source.slice(source.indexOf('  async function uploadImageToAll('), source.indexOf('  async function removeImage('));
  let form = { title: 'Existing event', images: { square: { url: 'https://example.com/square.png' }, landscape: { url: 'https://example.com/landscape.png' } }, eventinImage: { url: 'https://example.com/old.png' } }, slot, notice, uploads = [];
  const client = { storage: { from(bucket) { assert.equal(bucket, 'marketing-assets'); return {
    async upload(key, file, options) { uploads.push({ key, file, options }); return { error: failed ? new Error('Upload mislukt') : null }; },
    getPublicUrl(key) { return { data: { publicUrl: 'https://example.com/' + key } }; },
  }; } } };
  const run = new Function('supabase', 'workspaceId', 'selectedBusiness', 'businessId', 'uploadingSlot', 'setUploadingSlot', 'setUploadMessage', 'setForm', 'setPreview', 'setResult', 'imageSlots', 'prepareImageForSlot', fn + '; return uploadImageToAll;')(
    client, 'workspace', { id: 'venue' }, 'venue', busy, v => { slot = v; }, v => { notice = v; }, update => { form = update(form); }, () => {}, () => {}, [{ key: 'square' }], () => { throw Error('Must not crop other formats'); },
  );
  return { run, get form() { return form; }, get slot() { return slot; }, get notice() { return notice; }, uploads };
}
const photo = { name: 'Mijn foto.png', type: 'image/png', size: 1024 };

test('Eventin can upload an original without replacing or cropping saved social images', async () => {
  const h = harness(), before = structuredClone(h.form.images);
  await h.run(photo, true);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].file, photo);
  assert.equal(h.uploads[0].options.upsert, false);
  assert.match(h.uploads[0].key, /^workspace\/venue\/eventin-/);
  assert.deepEqual(h.form.images, before);
  assert.equal(h.form.title, 'Existing event');
  assert.equal(h.form.eventinImage.name, photo.name);
  assert.equal(h.notice.ok, true); assert.equal(h.slot, '');
});
test('failed Eventin upload retains original and social images with a visible error', async () => {
  const h = harness({ failed: true }), before = structuredClone(h.form);
  await h.run(photo, true);
  assert.deepEqual(h.form, before); assert.equal(h.notice.ok, false);
  assert.match(h.notice.message, /Upload mislukt/); assert.equal(h.slot, '');
});
test('invalid, cancelled and busy image selections do not upload anything', async () => {
  for (const file of [null, { ...photo, type: 'text/html' }, { ...photo, size: 11 * 1024 * 1024 }]) {
    const h = harness(); await h.run(file, true); assert.equal(h.uploads.length, 0);
  }
  const h = harness({ busy: 'square' }); await h.run(photo, true); assert.equal(h.uploads.length, 0);
});
test('Eventin has a direct upload and a saved-image picker that keeps the other fields', () => {
  assert.match(source, /aria-label="Eventin-afbeelding uploaden"/);
  assert.match(source, /uploadImageToAll\(file, true\)/);
  assert.match(source, /aria-label="Opgeslagen afbeelding voor Eventin"/);
  assert.match(source, /setForm\(current => \(\{ \.\.\.current, eventinImage: \{ \.\.\.image \} \}\)\)/);
});
