const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function google(fetch) {
  const exports = {};
  vm.runInNewContext(compile('lib/google-calendar.ts'), { exports, fetch, URL, URLSearchParams, Response, Buffer, crypto: require('node:crypto').webcrypto,
    process: { env: { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'http://test/callback', SUPABASE_SERVICE_ROLE_KEY: 'test-service' } },
    require: name => require(name),
  });
  return exports;
}

test('Google calendar list reads all pages and requests the list-only additional scope', async () => {
  const calls = [];
  const api = google(async input => {
    const url = new URL(input); calls.push(url);
    return Response.json(url.searchParams.get('pageToken') ? { items: [{ id: 'shared@example.test', summary: 'Comercial', accessRole: 'reader' }] } : { items: [{ id: 'me@example.test', summary: 'Pessoal', accessRole: 'owner', primary: true }], nextPageToken: 'page2' });
  });
  const calendars = await api.listGoogleCalendars('test-access');
  assert.equal(calendars.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('minAccessRole'), 'reader');
  const scopes = new URL(api.buildGoogleAuthUrl('actor')).searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.calendarlist.readonly'));
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/calendar'));
});

test('events are paginated and keep their calendar identity, including duplicate IDs across calendars', async () => {
  const calls = [];
  const api = google(async input => {
    const url = new URL(input); calls.push(url);
    return Response.json(url.searchParams.get('pageToken') ? { items: [{ id: 'second' }] } : { items: [{ id: 'same-id' }], nextPageToken: 'next' });
  });
  const rows = await api.listGoogleCalendarEvents('access', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'shared+calendar@example.test');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].calendarId, 'shared+calendar@example.test');
  assert.ok(calls[0].pathname.includes('shared%2Bcalendar%40example.test'));
  assert.equal(calls[0].searchParams.get('timeZone'), 'America/Fortaleza');
});

test('creating/deleting Google events targets the chosen calendar rather than primary', async () => {
  const calls = [];
  const api = google(async (url, options) => { calls.push({ url: String(url), options }); return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 'new-event' }); });
  await api.createGoogleCalendarEvent('access', { title: 'Evento', date: '2026-11-04', endDate: '2026-11-06', time: '09:00', motive: '', assignedTo: 'actor', sector: 'Geral' }, 'comercial@example.test');
  await api.deleteGoogleCalendarEvent('access', 'event/id', 'comercial@example.test');
  assert.ok(calls.every(call => call.url.includes('/comercial%40example.test/events')));
  assert.ok(calls[1].url.endsWith('/event%2Fid'));
  assert.equal(JSON.parse(calls[0].options.body).end.dateTime, '2026-11-06T23:59:00');
});

test('additional permission errors require consent without deleting a working Google connection', async () => {
  const api = google(async () => Response.json({ error: { message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } }, { status: 403 }));
  let error;
  try { await api.listGoogleCalendars('access'); } catch (caught) { error = caught; }
  assert.ok(error instanceof api.GoogleCalendarScopeRequiredError);
  let databaseCalls = 0;
  const server = {};
  vm.runInNewContext(compile('lib/google-calendar-server.ts'), { exports: server, Response, require(name) {
    if (name === '@/lib/google-calendar') return api;
    if (name === '@/lib/supabase-admin') return { getSupabaseAdmin() { databaseCalls++; throw new Error('Must not delete connection for missing list scope'); } };
    throw new Error(name);
  } });
  const response = await server.googleCalendarErrorResponse(error, 'actor');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).permissionRequired, true);
  assert.equal(databaseCalls, 0);
});

test('local event adapter preserves range/completion and calendar identities never collide', () => {
  const helpers = {};
  vm.runInNewContext(compile('lib/meeting-calendars.ts'), { exports: helpers });
  const task = helpers.calendarEventTask({ id: 'event', calendar_id: 'calendar', title: 'Férias', start_date: '2026-11-04', end_date: '2026-11-15', time: '09:00', notes: 'Pessoal', assigned_to: 'actor', completed: true, created_at: '2026-11-04T00:00:00Z' }, { id: 'calendar', sector: 'Geral' });
  assert.equal(task.id, 'calendar:event');
  assert.equal(task.isDoneToday, true);
  assert.match(task.notes, /Data final: 2026-11-15/);
  assert.notEqual(helpers.googleEventKey('one', 'same'), helpers.googleEventKey('two', 'same'));
  assert.equal(helpers.calendarForeground('#ffffff'), '#111827');
  assert.equal(helpers.calendarForeground('#111111'), '#ffffff');
});

test('Google calendar listing authorizes only the connected user, never admin impersonation', async () => {
  const exports = {}; let tokenCalls = 0;
  vm.runInNewContext(compile('app/api/google-calendar/calendars/route.ts'), { exports, Response, URL, require(name) {
    if (name === '@/lib/google-calendar') return { getGoogleCalendarConfig: () => ({ isConfigured: true }), listGoogleCalendars: async () => [] };
    if (name === '@/lib/google-calendar-server') return { getConnectionAccessToken: async () => { tokenCalls++; return 'test'; } };
    if (name === '@/lib/server-auth') return { requireSelfOrRole: async (request, target, roles) => { assert.equal(roles.length, 0); return target === 'actor' ? { ok: true } : { ok: false, response: new Response('', { status: 403 }) }; } };
    throw new Error(name);
  } });
  assert.equal((await exports.GET(new Request('http://test/calendars?userId=other'))).status, 403);
  assert.equal(tokenCalls, 0);
  assert.equal((await exports.GET(new Request('http://test/calendars?userId=actor'))).status, 200);
});

function clientHelpers() {
  const exports = {};
  vm.runInNewContext(compile('lib/google-calendar-client.ts'), { exports, Error });
  return exports;
}

test('reconnect action is absent for a working connection and for temporary network failures', () => {
  const client = clientHelpers();
  assert.equal(client.showGoogleConnectAction(true, true, false), false);
  assert.equal(client.showGoogleConnectAction(false, false, false), false);
  assert.equal(client.showGoogleConnectAction(true, false, false), true);
  for (const payload of [{ reconnectRequired: true }, { permissionRequired: true }]) {
    const error = client.googleCalendarRequestError(payload, 'Falha');
    assert.equal(client.needsGoogleReconnect(error), true);
    assert.equal(client.showGoogleConnectAction(true, true, client.needsGoogleReconnect(error)), true);
  }
  assert.equal(client.needsGoogleReconnect(client.googleCalendarRequestError({ error: 'Falha temporária' }, 'Falha')), false);
  assert.equal(client.needsGoogleReconnect(new TypeError('Failed to fetch')), false);
});

test('sidebar renders reconnect only when authorization is actually required', () => {
  const client = clientHelpers(), exports = {}, helpers = {};
  vm.runInNewContext(compile('lib/meeting-calendars.ts'), { exports: helpers });
  vm.runInNewContext(compile('app/components/meeting-calendar-sidebar.tsx'), { exports, require(name) {
    if (name === '@/lib/google-calendar-client') return client;
    if (name === '@/lib/meeting-calendars') return helpers;
    return require(name);
  } });
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const render = changes => renderToStaticMarkup(React.createElement(exports.MeetingCalendarSidebar, {
    userId: 'actor', sector: 'Geral', calendars: [], googleCalendars: [], hidden: [], loading: false,
    googleConnected: true, googleConfigured: true, googleReconnectRequired: false, googleError: '', ...changes,
  }));
  assert.doesNotMatch(render({}), /Autorizar \/ reconectar Google/);
  assert.doesNotMatch(render({ googleError: 'Falha temporária' }), /Autorizar \/ reconectar Google/);
  assert.match(render({ googleReconnectRequired: true }), /Autorizar \/ reconectar Google/);
  assert.match(render({ googleConnected: false }), />Conectar Google</);
});
