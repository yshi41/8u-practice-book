/**
 * Wall Kicks API — a Cloudflare Pages Function.
 *
 * Lives at /api/entries on the same origin as the page, so the browser makes
 * an ordinary same-origin fetch: no CORS, no preflight, no JSONP.
 *
 * STORAGE SHAPE
 * Every entry is its own KV key, `e:<id>`, where <id> is an idempotency key
 * the browser generates once when the parent presses Save. Two consequences
 * worth knowing:
 *
 *   - Concurrent writes cannot clobber each other. There is no read-modify-
 *     write of a shared blob, so two parents saving at the same instant is a
 *     non-event.
 *   - Re-sending the same entry is harmless. A queued entry that actually
 *     did reach the server the first time overwrites its own key rather than
 *     creating a duplicate.
 *
 * The entry itself is held in the key's METADATA, not its value. That means
 * one `list()` call returns every entry at once, instead of a `get()` per key.
 *
 * A coach correction lives apart from the entries, at `adj:<player>`, holding
 * the number that has to be added to that player's total to make it what the
 * coach says it is. Keeping it separate means fixing a total never rewrites
 * what a parent actually logged, and "times logged" stays honest.
 *
 * Adding an entry is open, because that is what parents do. Correcting a total
 * and resetting the record need the coach key, which is env.COACH_KEY and
 * nothing else -- no default, so a server without one refuses those operations
 * rather than falling back to something anybody could read. The key never
 * appears in the page: the coach types it, and it is checked here.
 *
 * BINDING: Cloudflare Pages -> Settings -> Functions -> KV namespace bindings
 *          Variable name  KICKS   ->  your namespace
 */

const PLAYERS = [
  'Abigael', 'Annabel', 'Annie', 'Catherine', 'Dafne', 'Davy',
  'Helen', 'Louise', 'Madeline C.', 'Madeline S.', 'Riley W.', 'Riley Y.'
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

async function keysUnder(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, limit: 1000, cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

/* Deleting a key is eventually consistent too, so a wiped record can keep
   listing its old rows for a while. The wipe therefore also writes down when
   it happened, and anything older than that is ignored: Reset the record means
   gone, immediately and on every phone, rather than gone-ish for a minute. */
async function clearedAt(kv) {
  const res = await kv.getWithMetadata('meta:cleared');
  return Number(res && res.metadata && res.metadata.ts) || 0;
}

async function listAll(kv, cut = 0) {
  const out = [];
  for (const k of await keysUnder(kv, 'e:')) {
    const m = k.metadata;
    if (m && m.p && (Number(m.ts) || 0) > cut) {
      out.push({ p: m.p, d: m.d, k: Number(m.k) || 0, ts: Number(m.ts) || 0 });
    }
  }
  out.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  /* The same kicks arriving twice -- a parent tapping Save again, or a queued
     entry that did reach us the first time and came back on a new id -- is one
     session, not two. The page has always shown it that way; counting it twice
     here would quietly inflate the number a coach's correction is measured
     against, and her corrected total would come out wrong. */
  const seen = new Set();
  return out.filter((e) => {
    const id = e.p + '|' + e.d + '|' + e.k;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function listAdjust(kv, cut = 0) {
  const out = {};
  for (const k of await keysUnder(kv, 'adj:')) {
    const m = k.metadata || {};
    const n = Number(m.k);
    if (Number.isFinite(n) && n !== 0 && (Number(m.ts) || 0) > cut) out[k.name.slice(4)] = n;
  }
  return out;
}

async function everything(kv) {
  const cut = await clearedAt(kv);
  return { entries: await listAll(kv, cut), adjust: await listAdjust(kv, cut) };
}

export async function onRequestGet({ env }) {
  if (!env.KICKS) return json({ ok: false, error: 'no KV binding named KICKS' }, 500);
  try {
    return json({ ok: true, ...(await everything(env.KICKS)) });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

/** Coach-only: make a player's total exactly what the coach says, and wipe
 *  the record. Both need the key; adding an entry does not. */
async function coachOp(body, env) {
  const kv = env.KICKS;

  const key = String(env.COACH_KEY || '');
  if (!key) {
    return json({ ok: false, error: 'no coach key is set on the server' }, 503);
  }
  if (String(body.key || '') !== key) {
    return json({ ok: false, error: 'wrong coach key' }, 403);
  }

  /* Just asking whether this key is any good, so the coach screen can let her
     in -- or not -- without changing anything. */
  if (body.op === 'check') return json({ ok: true, ...(await everything(kv)) });

  if (body.op === 'reset') {
    await kv.put('meta:cleared', '', { metadata: { ts: Date.now() } });
    for (const k of await keysUnder(kv, 'e:')) await kv.delete(k.name);
    for (const k of await keysUnder(kv, 'adj:')) await kv.delete(k.name);
    return json({ ok: true, entries: [], adjust: {} });
  }

  const p = String(body.p || '').trim();
  if (!PLAYERS.includes(p)) return json({ ok: false, error: 'unknown player' }, 400);

  const target = Math.floor(Number(body.k));
  if (!Number.isFinite(target) || target < 0 || target > 1000000) {
    return json({ ok: false, error: 'bad total' }, 400);
  }

  /* The correction is the gap between what was logged and what it should be,
     so the entries themselves are left exactly as the parents wrote them. */
  const logged = (await everything(kv)).entries
    .filter((e) => e.p === p)
    .reduce((n, e) => n + e.k, 0);
  const delta = target - logged;

  if (delta === 0) await kv.delete('adj:' + p);
  else await kv.put('adj:' + p, '', { metadata: { k: delta, ts: Date.now() } });

  /* Same eventual consistency, and it matters more here: if the correction
     were missing from the reply the coach would see the old number, set it
     again, and the second correction would be measured against stale ground. */
  const data = await everything(kv);
  if (delta === 0) delete data.adjust[p];
  else data.adjust[p] = delta;
  return json({ ok: true, ...data });
}

export async function onRequestPost({ request, env }) {
  if (!env.KICKS) return json({ ok: false, error: 'no KV binding named KICKS' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }

  if (body.op === 'reset' || body.op === 'set' || body.op === 'check') {
    try {
      return await coachOp(body, env);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500);
    }
  }

  const id = String(body.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const p = String(body.p || '').trim();
  const d = String(body.d || '').trim();
  const k = Math.floor(Number(body.k));

  if (!id) return json({ ok: false, error: 'missing id' }, 400);
  if (!PLAYERS.includes(p)) return json({ ok: false, error: 'unknown player' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ ok: false, error: 'bad date' }, 400);
  if (!(k > 0) || k > 5000) return json({ ok: false, error: 'bad count' }, 400);

  // A date in the future, or wildly in the past, is a mis-tap rather than a session.
  const when = Date.parse(d + 'T12:00:00Z');
  const now = Date.now();
  if (!Number.isFinite(when)) return json({ ok: false, error: 'bad date' }, 400);
  if (when > now + 36 * 3600 * 1000) return json({ ok: false, error: 'date is in the future' }, 400);
  if (now - when > 400 * 24 * 3600 * 1000) return json({ ok: false, error: 'date is too old' }, 400);

  try {
    await env.KICKS.put('e:' + id, '', { metadata: { p, d, k, ts: now } });

    /* KV list() is eventually consistent: the row just written is often not in
       it for a few seconds. Put it into this reply by hand, or the parent taps
       Save and watches the total not move -- which looks exactly like losing
       it. Everybody else picks it up on their next read. */
    const data = await everything(env.KICKS);
    if (!data.entries.some((e) => e.p === p && e.d === d && e.k === k)) {
      data.entries.push({ p, d, k, ts: now });
      data.entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }
    return json({ ok: true, ...data });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}
