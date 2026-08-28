/**
 * Sessions API — a Cloudflare Pages Function.
 *
 * Sessions 1 and 2 are written pages in the repository: prose, ramps, the
 * coach's voice. This is for the ones added during the season from the field,
 * which start life as a blank template and get filled in from the library.
 *
 * A session record is one KV key, `t:s<n>`, holding nothing but who it is:
 *
 *     { title, focus, created }
 *
 * Its plan is NOT here -- that stays at `p:s<n>`, owned by /api/practice, and
 * the two are deliberately kept apart. A plan is retired when the page it was
 * built against changes edition, and retiring a plan must never delete the
 * session it belongs to.
 *
 * Creating and deleting need the coach key. Reading is open, because the book
 * is meant to be read.
 *
 * BINDING: same KV namespace as everything else. Keys do not collide:
 *          e:/adj:/meta: wall kicks, p: practice plans, t: these.
 */

const MAX_BODY = 8 * 1024;
const WRITTEN = 2;          // session-1.html and session-2.html live in the repo
const MAX_SESSION = 99;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const store = (env) => env.PLANS || env.KICKS || null;

const clean = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);

function numberOf(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > WRITTEN && n <= MAX_SESSION ? n : null;
}

async function listAll(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 't:', limit: 1000, cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      const n = Math.floor(Number(String(k.name).slice(3)));
      if (Number.isFinite(n) && m.title) {
        out.push({ n, title: m.title, focus: m.focus || '', created: Number(m.created) || 0 });
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => a.n - b.n);
  return out;
}

export async function onRequestGet({ env }) {
  const kv = store(env);
  if (!kv) return json({ ok: false, error: 'no KV binding named PLANS' }, 500);
  try {
    return json({ ok: true, written: WRITTEN, sessions: await listAll(kv) });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const kv = store(env);
  if (!kv) return json({ ok: false, error: 'no KV binding named PLANS' }, 500);

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ ok: false, error: 'too big' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }

  const key = String(env.COACH_KEY || '');
  if (!key) return json({ ok: false, error: 'no coach key is set on the server' }, 503);
  if (String(body.key || '') !== key) return json({ ok: false, error: 'wrong coach key' }, 403);

  try {
    if (body.op === 'delete') {
      const n = numberOf(body.n);
      if (!n) return json({ ok: false, error: 'which session?' }, 400);
      await kv.delete('t:s' + n);
      await kv.delete('p:s' + n);   // its plan goes with it
      return json({ ok: true, written: WRITTEN, sessions: await listAll(kv) });
    }

    if (body.op !== 'create') return json({ ok: false, error: 'unknown operation' }, 400);

    const title = clean(body.title, 60);
    if (!title) return json({ ok: false, error: 'a session needs a name' }, 400);

    /* The number is worked out here rather than trusted from the page, so two
       coaches adding a session at the same moment cannot both claim it. */
    const existing = await listAll(kv);
    const taken = new Set(existing.map((s) => s.n));
    let n = numberOf(body.n);
    if (!n || taken.has(n)) {
      n = WRITTEN + 1;
      while (taken.has(n) && n <= MAX_SESSION) n++;
    }
    if (n > MAX_SESSION) return json({ ok: false, error: 'that is a lot of sessions' }, 400);

    const record = {
      title,
      focus: clean(body.focus, 400) ||
        'Written from the field. Swap any block for something from the library, ' +
        'set the minutes, and it saves itself for the team.',
      created: Date.now()
    };
    await kv.put('t:s' + n, '', { metadata: record });

    return json({ ok: true, n, session: { n, ...record }, written: WRITTEN,
                  sessions: await listAll(kv) });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
