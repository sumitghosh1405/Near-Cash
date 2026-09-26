import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const worker = await fs.readFile(path.join(root, 'src/index.js'), 'utf8');
const app = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
const live = await fs.readFile(path.join(root, 'public/live.js'), 'utf8');
const sw = await fs.readFile(path.join(root, 'public/sw.js'), 'utf8');
const schema = await fs.readFile(path.join(root, 'schema.sql'), 'utf8');

const has = (s, pattern) => assert.match(s, pattern);

 test('no URL token authentication regression', () => {
  assert.doesNotMatch(worker, /searchParams\.get\(['"]token['"]\)/);
  assert.doesNotMatch(app, /\/api\/stream\?token=/);
  assert.doesNotMatch(live, /\/api\/stream\?token=/);
});

test('Bearer authentication remains required', () => {
  has(worker, /Authorization/);
  has(worker, /Bearer\\s\+\[\^\\s\]\+/);
});

test('security headers remain present', () => {
  for (const header of [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Strict-Transport-Security', 'Cache-Control'
  ]) has(worker, new RegExp(header));
});

test('request size and rate limiting protections remain present', () => {
  has(worker, /Request too large/);
  has(worker, /const rateLimit=/);
  has(worker, /userActionLimit/);
});

test('trust and safety tables exist', () => {
  for (const table of ['abuse_limits', 'reports', 'blocks']) {
    has(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test('critical marketplace operations use abuse limits', () => {
  has(worker, /"listing_create"/);
  has(worker, /"connect"/);
  has(worker, /"message"/);
  has(worker, /"pin_generate"/);
  has(worker, /"report"/);
  has(worker, /"block"/);
});

test('match claiming is conditional and race-safe', () => {
  has(worker, /UPDATE listings SET status='matched' WHERE id=\? AND status='open'/);
  has(worker, /changes\|\|0\)!==1/);
});

test('meetup PIN is hashed and expires', () => {
  has(worker, /sha\(code\+t\.id\)/);
  has(worker, /pin_exp/);
  has(worker, /pin_tries/);
});

test('service worker has a versioned cache', () => {
  has(sw, /const C=['"]near-cash-/);
});

test('frontend contains no obvious secret material', () => {
  for (const source of [app, live, sw]) {
    assert.doesNotMatch(source, /TWILIO_AUTH_TOKEN|ADMIN_KEY|SMS_WEBHOOK_TOKEN/);
  }
});


test('production observability remains present', () => {
  has(worker, /observability_events/);
  has(worker, /\/api\/admin\/observability/);
  has(worker, /recordObs/);
  has(worker, /kind:"server_error"/);
});

test('product analytics remains privacy-minimized', () => {
  has(worker, /analytics_events/);
  has(worker, /p==="analytics"/);
  has(worker, /const allowed=new Set/);
  has(worker, /clientId/);
});

test('privacy and account-data controls remain present', () => {
  has(worker, /p==="privacy\/export"/);
  has(worker, /p==="privacy\/location\/delete"/);
  has(worker, /p==="privacy\/delete"/);
  has(worker, /Type DELETE to permanently remove your Near Cash account/);
});

test('PWA offline/update assets exist', async () => {
  const offline = await fs.readFile(path.join(root, 'public/offline.html'), 'utf8');
  const manifest = await fs.readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8');
  has(offline, /offline/i);
  has(manifest, /name/);
  has(sw, /skipWaiting|clientsClaim/);
});

test('launch-readiness files exist', async () => {
  for (const file of ['privacy.html', 'terms.html', 'security.html', 'robots.txt']) {
    const value = await fs.readFile(path.join(root, 'public', file), 'utf8');
    assert.ok(value.length > 20, `${file} should not be empty`);
  }
});

test('schema includes consolidated analytics and observability tables', () => {
  has(schema, /CREATE TABLE IF NOT EXISTS analytics_events/);
  has(schema, /CREATE TABLE IF NOT EXISTS observability_events/);
});
