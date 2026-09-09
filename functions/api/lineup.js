/**
 * Lineup API — a Cloudflare Pages Function.
 *
 * One lineup sheet per game: who is here, the shape (how many backs, mids
 * and forwards, plus one in goal), and who is in which spot in each of the
 * four quarters. The page does the thinking -- who has played fewer than two
 * quarters, who is in two spots at once -- and this keeps the sheet so the
 * coach who wrote it on Friday and the coach holding the phone on Saturday
 * are looking at the same one.
 *
 * STORAGE SHAPE
 * A game is one KV key, `l:<id>`, where <id> is the date and the opponent
 * (`2026-09-13-blue-jays`). The key's METADATA holds what the games list
 * needs -- { date, opp, ts } -- so listing games is one list() call and no
 * get()s; the sheet itself is the key's VALUE, read one game at a time.
 *
 * Saving and deleting need the coach key. Reading is open, so a parent with
 * the link can see the sheet and no phone has to be the one that holds it.
 *
 * BINDING: same KV namespace as everything else. Keys do not collide:
 *          e:/adj:/pop:/meta: wall kicks, p: practice plans, t: sessions,
 *          l: these.
 */

const MAX_BODY = 16 * 1024;
const QUARTERS = 4;
const MAX_LINE = 6;            // backs, mids or forwards in one line
const MAX_ON = 11;             // on the field at once, keeper included

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

const store = (env) => env.PLANS || env.KICKS || null;

const clean = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);

const ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}$/;
const idOf = (v) => (ID.test(String(v || '')) ? String(v) : null);

const line = (v, n) => {
  const a = Array.isArray(v) ? v : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = clean(a[i], 30);
    out.push(PLAYERS.includes(p) ? p : '');
  }
  return out;
};

/** Everything unrecognised is dropped rather than stored; what comes back
 *  is a sheet the page can trust without checking it again. */
function checkGame(raw, id) {
  if (!raw || typeof raw !== 'object') return { error: 'no game' };

  const date = String(raw.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z'))) {
    return { error: 'bad date' };
  }
  if (!id.startsWith(date)) return { error: 'id does not match the date' };

  const s = raw.shape || {};
  const num = (v) => Math.floor(Number(v));
  const shape = { b: num(s.b), m: num(s.m), f: num(s.f) };
  for (const k of ['b', 'm', 'f']) {
    if (!Number.isFinite(shape[k]) || shape[k] < 0 || shape[k] > MAX_LINE) return { error: 'bad shape' };
  }
  if (shape.b + shape.m + shape.f + 1 > MAX_ON) return { error: 'too many on the field' };
  if (shape.b + shape.m + shape.f < 1) return { error: 'a keeper needs somebody in front of her' };

  const absent = [];
  for (const p of Array.isArray(raw.absent) ? raw.absent : []) {
    const n = clean(p, 30);
    if (PLAYERS.includes(n) && !absent.includes(n)) absent.push(n);
  }

  const q = [];
  const qs = Array.isArray(raw.q) ? raw.q : [];
  for (let i = 0; i < QUARTERS; i++) {
    const src = qs[i] && typeof qs[i] === 'object' ? qs[i] : {};
    const gk = clean(src.gk, 30);
    q.push({
      gk: PLAYERS.includes(gk) ? gk : '',
      b: line(src.b, shape.b),
      m: line(src.m, shape.m),
      f: line(src.f, shape.f)
    });
  }

  return {
    game: { id, date, opp: clean(raw.opp, 40), shape, absent, q, note: clean(raw.note, 300) }
  };
}

function summary(name, m) {
  return { id: name.slice(2), date: m.date || '', opp: m.opp || '', ts: Number(m.ts) || 0 };
}

async function listAll(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 'l:', limit: 1000, cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      if (idOf(k.name.slice(2)) && m.date) out.push(summary(k.name, m));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  return out;
}

async function readOne(kv, id) {
  const res = await kv.getWithMetadata('l:' + id);
  if (!res || res.value == null) return null;
  let game;
  try { game = JSON.parse(res.value); } catch { return null; }
  const m = res.metadata || {};
  return { ...game, ts: Number(m.ts) || 0 };
}

export async function onRequestGet({ request, env }) {
  const kv = store(env);
  if (!kv) return json({ ok: false, error: 'no KV binding named PLANS' }, 500);
  try {
    const one = idOf(new URL(request.url).searchParams.get('g'));
    if (one) return json({ ok: true, game: await readOne(kv, one) });
    return json({ ok: true, games: await listAll(kv) });
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
      const id = idOf(body.id);
      if (!id) return json({ ok: false, error: 'which game?' }, 400);
      await kv.delete('l:' + id);
      const games = (await listAll(kv)).filter((g) => g.id !== id);
      return json({ ok: true, games });
    }

    if (body.op !== 'save') return json({ ok: false, error: 'unknown operation' }, 400);

    const id = idOf(body.id || (body.game && body.game.id));
    if (!id) return json({ ok: false, error: 'bad game id' }, 400);
    const checked = checkGame(body.game, id);
    if (checked.error) return json({ ok: false, error: checked.error }, 400);

    const ts = Date.now();
    const game = { ...checked.game, ts };
    await kv.put('l:' + id, JSON.stringify(checked.game), {
      metadata: { date: game.date, opp: game.opp, ts }
    });

    /* KV list() lags its writes; put the game just saved into the reply by
       hand so the games list on the phone that saved it is not missing it. */
    const games = (await listAll(kv)).filter((g) => g.id !== id);
    games.push({ id, date: game.date, opp: game.opp, ts });
    games.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
    return json({ ok: true, game, games });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
