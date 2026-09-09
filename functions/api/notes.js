/**
 * Player notes API — a Cloudflare Pages Function.
 *
 * A running set of notes on each girl: what she is working on, what clicked
 * at practice, what to say to her parents on Saturday. The coach writes them
 * on a phone between drills, and any device with the key sees the same ones.
 *
 * READING NEEDS THE COACH KEY TOO, which is what makes this page different
 * from the lineup and the Kicking Club. Those are open on purpose -- a parent
 * with the link should see the sheet. Notes about somebody's eight-year-old
 * are not that, so every operation here, reads included, checks the key.
 *
 * That is also why there is no GET that returns anything. A key in a query
 * string ends up in logs, browser history and anything sitting in front of
 * this origin, so the key travels in a POST body and reads are POSTs.
 * The GET below exists only to answer the deploy check, and says nothing.
 *
 * STORAGE SHAPE
 * One key per girl, `n:<slug>`, holding a JSON array of her notes, newest
 * last:  { id, ts, d, t }  -- id, when it was written, the day it is about,
 * and the text. `d` comes from the phone, not the server, because a note
 * typed at 8pm on a field belongs to that evening and Workers run in UTC.
 *
 * A write is read-modify-write on one key, so two coaches adding a note to
 * the same girl in the same second could lose one. With a roster of twelve
 * and one or two phones that is a fair trade for keeping this simple; the
 * alternative is a Durable Object for something written a few times a week.
 *
 * BINDING: same KV namespace as everything else. Keys do not collide:
 *          e:/adj:/pop:/meta: wall kicks, p: practice plans, t: sessions,
 *          l: lineups, n: these.
 */

const MAX_BODY = 8 * 1024;
const MAX_NOTE = 800;          // characters in one note
const MAX_NOTES = 200;         // notes kept per girl, oldest dropped first

const PLAYERS = [
  'Abigael', 'Annabel', 'Annie', 'Catherine', 'Dafne', 'Davy',
  'Helen', 'Louise', 'Madeline C.', 'Madeline S.', 'Riley W.', 'Riley Y.'
];

/* Roster name -> key slug. Injective over the roster above: the two
   Madelines and the two Rileys keep their initial. */
const slugOf = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const BY_SLUG = new Map(PLAYERS.map((n) => [slugOf(n), n]));

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const store = (env) => env.PLANS || env.KICKS || null;

/** Notes keep their line breaks; everything else is squeezed and trimmed. */
const cleanText = (v) =>
  String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTE);

const whoOf = (v) => (BY_SLUG.has(String(v || '')) ? String(v) : null);
const dayOf = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(v + 'T12:00:00Z'))
    ? String(v)
    : new Date().toISOString().slice(0, 10);
const idOf = (v) => (/^[a-z0-9]{4,24}$/.test(String(v || '')) ? String(v) : null);

const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function readNotes(kv, who) {
  const raw = await kv.get('n:' + who);
  let list;
  try { list = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === 'object' && idOf(x.id) && typeof x.t === 'string')
    .map((x) => ({ id: String(x.id), ts: Number(x.ts) || 0, d: dayOf(x.d), t: cleanText(x.t) }))
    .filter((x) => x.t);
}

async function writeNotes(kv, who, list) {
  const keep = list.slice(-MAX_NOTES);
  if (keep.length) await kv.put('n:' + who, JSON.stringify(keep));
  else await kv.delete('n:' + who);
  return keep;
}

/** Every girl's notes in one reply -- twelve gets, run together. */
async function readAll(kv) {
  const slugs = [...BY_SLUG.keys()];
  const lists = await Promise.all(slugs.map((s) => readNotes(kv, s)));
  const notes = {};
  slugs.forEach((s, i) => { notes[s] = lists[i]; });
  return notes;
}

/* Says nothing at all: it is here so the deploy check gets a 200 from this
   route like every other, and so a curious GET is answered honestly. */
export async function onRequestGet() {
  return json({ ok: true, notes: null, need: 'the coach key, by POST' });
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

  /* No default key, so a deployment without one locks rather than opens.
     503 unconfigured, 403 wrong, 200 right -- the same three answers the
     rest of the book gives. */
  const key = String(env.COACH_KEY || '');
  if (!key) return json({ ok: false, error: 'no coach key is set on the server' }, 503);
  if (String(body.key || '') !== key) return json({ ok: false, error: 'wrong coach key' }, 403);

  try {
    if (body.op === 'load') {
      return json({ ok: true, roster: PLAYERS, notes: await readAll(kv) });
    }

    const who = whoOf(body.who);
    if (!who) return json({ ok: false, error: 'who is the note about?' }, 400);
    const list = await readNotes(kv, who);

    if (body.op === 'add') {
      const t = cleanText(body.text);
      if (!t) return json({ ok: false, error: 'the note is empty' }, 400);
      list.push({ id: newId(), ts: Date.now(), d: dayOf(body.d), t });
    } else if (body.op === 'edit') {
      const id = idOf(body.id);
      const t = cleanText(body.text);
      if (!id) return json({ ok: false, error: 'which note?' }, 400);
      if (!t) return json({ ok: false, error: 'the note is empty' }, 400);
      const at = list.findIndex((x) => x.id === id);
      if (at < 0) return json({ ok: false, error: 'that note is gone' }, 404);
      list[at] = { ...list[at], t, ts: Date.now() };
    } else if (body.op === 'remove') {
      const id = idOf(body.id);
      if (!id) return json({ ok: false, error: 'which note?' }, 400);
      const at = list.findIndex((x) => x.id === id);
      if (at < 0) return json({ ok: true, who, notes: list });   /* already gone */
      list.splice(at, 1);
    } else {
      return json({ ok: false, error: 'unknown operation' }, 400);
    }

    /* KV can be a beat behind its own writes, so the girl's list goes back
       in this reply rather than being read again. */
    const kept = await writeNotes(kv, who, list);
    return json({ ok: true, who, notes: kept });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
