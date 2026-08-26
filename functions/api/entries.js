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

async function listAll(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 'e:', limit: 1000, cursor });
    for (const k of page.keys) {
      const m = k.metadata;
      if (m && m.p) out.push({ p: m.p, d: m.d, k: Number(m.k) || 0, ts: Number(m.ts) || 0 });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return out;
}

export async function onRequestGet({ env }) {
  if (!env.KICKS) return json({ ok: false, error: 'no KV binding named KICKS' }, 500);
  try {
    return json({ ok: true, entries: await listAll(env.KICKS) });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.KICKS) return json({ ok: false, error: 'no KV binding named KICKS' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
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
    return json({ ok: true, entries: await listAll(env.KICKS) });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}
