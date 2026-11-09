const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) throw new Error('Missing local Supabase configuration');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, options);
  const anon = createClient(url, anonKey, options);
  const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('role', 'admin').eq('account_status', 'approved').eq('is_active', true).limit(1).single();
  if (profileError) throw profileError;
  const id = randomUUID();
  const path = `${profile.id}/${id}/qa-empty.zip`;
  // Valid empty ZIP; never downloaded to disk, launched, or shown to members.
  const zip = Buffer.alloc(22); zip.writeUInt32LE(0x06054b50);
  const browserFile = new File([zip], 'qa-empty.zip', { type: 'application/x-zip-compressed' });
  const originalPath = `${profile.id}/${id}/qa-original.zip`;
  let originalUploaded = false;
  let uploaded = false;
  let inserted = false;
  try {
    const rejected = await admin.storage.from('app-tools').upload(originalPath, browserFile, { contentType: 'application/octet-stream', upsert: false });
    originalUploaded = !rejected.error;
    assert.ok(rejected.error, 'original browser ZIP MIME must reproduce the rejection');
    assert.match(rejected.error.message, /mime|type/i);
    console.log('Reproduced browser ZIP rejection:', rejected.error.message);
    const body = browserFile.slice(0, browserFile.size, 'application/octet-stream');
    assert.deepEqual(Buffer.from(await body.arrayBuffer()), zip, 'changing MIME must preserve all file bytes');
    const upload = await admin.storage.from('app-tools').upload(path, body, { contentType: 'application/octet-stream', upsert: false });
    if (upload.error) throw upload.error;
    uploaded = true;
    const insert = await admin.from('app_tools').insert({ id, name: 'QA temporária de download', file_name: 'qa-empty.zip', file_path: path, file_size: zip.length, created_by: profile.id, is_active: false });
    if (insert.error) throw insert.error;
    inserted = true;
    const denied = await anon.storage.from('app-tools').createSignedUrl(path, 60);
    assert.ok(denied.error, 'anonymous signed download must be denied');
    const publicResponse = await fetch(`${url}/storage/v1/object/public/app-tools/${path}`);
    assert.ok(!publicResponse.ok, 'bucket must not be public');
    const signed = await admin.storage.from('app-tools').createSignedUrl(path, 60, { download: 'qa-empty.zip' });
    if (signed.error) throw signed.error;
    const response = await fetch(signed.data.signedUrl);
    assert.ok(response.ok, 'signed download must work');
    assert.match(response.headers.get('content-disposition') || '', /attachment.*qa-empty\.zip/i);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), zip);
    console.log('Storage smoke passed: private upload, denied anonymous/public access, signed attachment and matching bytes.');
  } finally {
    if (inserted) {
      const cleanup = await admin.from('app_tools').delete().eq('id', id);
      if (cleanup.error) throw cleanup.error;
    }
    if (uploaded) {
      const cleanup = await admin.storage.from('app-tools').remove([path]);
      if (cleanup.error) throw cleanup.error;
    }
    if (originalUploaded) {
      const cleanup = await admin.storage.from('app-tools').remove([originalPath]);
      if (cleanup.error) throw cleanup.error;
    }
    console.log('Temporary QA file and metadata cleaned up.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
