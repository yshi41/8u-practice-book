/**
 * Practice API — a Cloudflare Pages Function.
 *
 * Lives at /api/practice on the same origin as the session pages, so the
 * browser makes an ordinary same-origin fetch: no CORS, no preflight.
 *
 * WHAT IT HOLDS
 * One adjusted plan per session, at KV key `p:<sid>` (e.g. `p:s1`). The value
 * is the plan itself; the metadata carries `{ ts, edition }` so the "which
 * sessions are adjusted" listing costs one list() and no get()s.
 *
 * A plan is a list of blocks, exactly as the page builds it:
 *   { k:'o', i:<index into the written blocks>, d:<minutes> }
 *   { k:'l', r:<library activity id>,           d:<minutes> }
 *   { k:'w', t:<title>, x:<note>,               d:<minutes> }
 *   { k:'c', t:<title>, x:<note>,               d:<minutes> }
 *
 * EDITIONS
 * An 'o' block is a pointer into the written blocks of a particular version
 * of a session page, so a stored plan is only meaningful against the edition
 * it was built from. Every record carries that edition, and a GET names it.
 * When a practice is baked into the book the page's edition goes up, and the
 * page then ignores — and clears — the record stored against the old one.
 * Baking into the book always wins over a plan saved here.
 *
 * WRITES
 * Guarded by a shared key, checked against env.COACH_KEY if you set one and
 * against 'coach8u' if you have not. The page ships holding that key, so this
 * stops a passer-by editing Tuesday's practice; it is not a secret and is not
 * meant to be one. If you set COACH_KEY in Cloudflare, change KEY in the
 * session pages to match or writes will start failing.
 *
 * BINDING: Cloudflare Pages -> Settings -> Functions -> KV namespace bindings
 *          Variable name  PLANS  ->  your namespace
 *          (the wall-kicks namespace is fine; the keys do not collide. If you
 *          bind it as KICKS only, this picks that up too.)
 */

const MAX_BLOCKS = 40;
const MAX_BODY = 24 * 1024;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const store = (env) => env.PLANS || env.KICKS || null;

const sidOf = (s) => (/^s\d{1,3}$/.test(String(s || '')) ? String(s) : null);

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+$/, '').slice(0, max);

/** Returns a sanitised plan, or a string describing why it is not one. */
function checkPlan(plan) {
  if (!Array.isArray(plan)) return 'plan is not a list';
  if (!plan.length) return 'plan is empty';
  if (plan.length > MAX_BLOCKS) return 'too many blocks';

  const out = [];
  for (const raw of plan) {
    if (!raw || typeof raw !== 'object') return 'a block is not an object';

    const d = Math.floor(Number(raw.d));
    if (!Number.isFinite(d) || d < 0 || d > 120) return 'a block has impossible minutes';

    if (raw.k === 'o') {
      const i = Math.floor(Number(raw.i));
      if (!Number.isFinite(i) || i < 0 || i > 199) return 'a written block is out of range';
      out.push({ k: 'o', i, d });
    } else if (raw.k === 'l') {
      const r = String(raw.r || '');
      if (!/^[a-z0-9]{1,32}$/.test(r)) return 'a library id looks wrong';
      out.push({ k: 'l', r, d });
    } else if (raw.k === 'w' || raw.k === 'c') {
      const t = clean(raw.t, 80);
      if (raw.k === 'c' && !t) return 'a custom block has no name';
      const block = { k: raw.k, t: t || 'Water', d };
      const x = clean(raw.x, 1200);
      if (x) block.x = x;
      out.push(block);
    } else {
      return 'unknown block type';
    }
  }
  return out;
}

async function readOne(kv, sid) {
  const res = await kv.getWithMetadata('p:' + sid, { type: 'json' });
  if (!res || !res.value) return null;
  const m = res.metadata || {};
  return { plan: res.value, edition: Number(m.edition) || 1, ts: Number(m.ts) || 0 };
}

async function listAll(kv) {
  const out = {};
  let cursor;
  do {
    const page = await kv.list({ prefix: 'p:', limit: 1000, cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      out[k.name.slice(2)] = { edition: Number(m.edition) || 1, ts: Number(m.ts) || 0 };
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

export async function onRequestGet({ request, env }) {
  const kv = store(env);
  if (!kv) return json({ ok: false, error: 'no KV binding named PLANS' }, 500);

  const sid = sidOf(new URL(request.url).searchParams.get('s'));
  try {
    if (!sid) return json({ ok: true, sessions: await listAll(kv) });
    return json({ ok: true, s: sid, saved: await readOne(kv, sid) });
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

  if (String(body.key || '') !== String(env.COACH_KEY || 'coach8u')) {
    return json({ ok: false, error: 'wrong coach key' }, 403);
  }

  const sid = sidOf(body.s);
  if (!sid) return json({ ok: false, error: 'which session?' }, 400);

  const edition = Math.floor(Number(body.edition));
  if (!Number.isFinite(edition) || edition < 1 || edition > 999) {
    return json({ ok: false, error: 'bad edition' }, 400);
  }

  try {
    /* Putting the session back as written is a clear, not an empty plan: the
       team should fall through to the book rather than to a blank page. */
    if (body.clear) {
      await kv.delete('p:' + sid);
      return json({ ok: true, s: sid, saved: null });
    }

    const plan = checkPlan(body.plan);
    if (typeof plan === 'string') return json({ ok: false, error: plan }, 400);

    const ts = Date.now();
    await kv.put('p:' + sid, JSON.stringify(plan), { metadata: { ts, edition } });
    return json({ ok: true, s: sid, saved: { plan, edition, ts } });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
