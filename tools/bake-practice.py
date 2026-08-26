# -*- coding: utf-8 -*-
"""Bake an edit made on the website into the published practice book.

The site is static, so the page itself cannot write to the book. Instead the
coach taps "Copy it for Claude" on an adjusted practice, which copies a block
of text ending in a CODE line. Feed that here and the session page is rewritten
so her version IS the written session — on every device, for good.

    python tools/bake-practice.py --code "s1.1.eyJ..."
    python tools/bake-practice.py --paste paste.txt      # the whole copied block
    python tools/bake-practice.py --url  "https://.../session-1.html?p=eyJ..."
    ...anything of the above, plus --dry-run to see the outline first.

Each bake bumps data-edition on the card, which retires the stale copies
sitting in everybody's browser so the newly published version wins.
"""

import argparse
import base64
import html as htmllib
import io
import json
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):          # em dashes on a Windows console
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BLOCK_RE = re.compile(
    r'\s*<div class="blk"(?P<attrs>[^>]*)>'
    r'<div class="clock"><span class="t">[^<]*</span>'
    r'<span class="d">(?P<dur>[^<]*)</span></div>'
    r'<div class="body">(?P<body>.*?)\s*</div></div>',
    re.S)

KIND_RE = re.compile(r'data-kind="([^"]*)"')


# ---------------------------------------------------------------- reading in

def b64dec(s):
    s = s.replace('-', '+').replace('_', '/')
    s += '=' * (-len(s) % 4)
    return base64.b64decode(s.encode('ascii')).decode('utf-8')


def parse_input(args):
    """-> (session number or None, edition or None, plan list)"""
    text = args.code or args.url or ''
    if args.paste:
        text = io.open(args.paste, encoding='utf-8').read()

    m = re.search(r'CODE\s+s(\d+)\.(\d+)\.([A-Za-z0-9_-]+)', text)
    if m:
        return int(m.group(1)), int(m.group(2)), json.loads(b64dec(m.group(3)))

    m = re.fullmatch(r'\s*s(\d+)\.(\d+)\.([A-Za-z0-9_-]+)\s*', text)
    if m:
        return int(m.group(1)), int(m.group(2)), json.loads(b64dec(m.group(3)))

    m = re.search(r'session-(\d+)\.html\?p=([A-Za-z0-9_%-]+)', text)
    if m:
        raw = m.group(2).replace('%3D', '').replace('%3d', '')
        return int(m.group(1)), None, json.loads(b64dec(raw))

    m = re.fullmatch(r'\s*([A-Za-z0-9_-]{16,})\s*', text)
    if m:
        return None, None, json.loads(b64dec(m.group(1)))

    sys.exit('Could not find a practice code in that. Expected a "CODE s1.2.eyJ..." line, '
             'a session URL with ?p=, or a bare code.')


def read_page(num):
    path = os.path.join(ROOT, 'session-%d.html' % num)
    if not os.path.exists(path):
        sys.exit('No such session page: %s' % path)
    return path, io.open(path, encoding='utf-8').read()


def read_lib(html):
    m = re.search(r'^var LIB = (\[.*?\]);$', html, re.M)
    if not m:
        sys.exit('Could not find the library data in the page.')
    return {a['id']: a for a in json.loads(m.group(1))}


def read_blocks(html):
    """The written blocks, in page order: (attrs, minutes, body html)."""
    start = html.index('<div class="blocks">')
    end = html.index('</article>', start)
    chunk = html[start:end]
    out = []
    for m in BLOCK_RE.finditer(chunk):
        mins = re.search(r'(\d+)', m.group('dur'))
        out.append({
            'kind': (KIND_RE.search(m.group('attrs')).group(1)
                     if KIND_RE.search(m.group('attrs')) else ''),
            'dur': int(mins.group(1)) if mins else 0,
            'body': m.group('body'),
        })
    if not out:
        sys.exit('Could not read any blocks out of that page.')
    return out, start, end


def read_edition(html):
    m = re.search(r'<article class="card" id="s\d+"([^>]*)>', html)
    e = re.search(r'data-edition="(\d+)"', m.group(1)) if m else None
    return int(e.group(1)) if e else 1


# ---------------------------------------------------------------- rendering out

def esc(t):
    return (t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def title_of(item, base, lib):
    if item['k'] == 'o':
        b = base[item['i']]
        m = re.search(r'<h4>(.*?)</h4>', b['body'], re.S)
        if not m:
            return 'Activity'
        return htmllib.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.group(1)))).strip()
    if item['k'] == 'l':
        a = lib.get(item['r'])
        return a['n'] if a else 'Activity'
    return item.get('t') or ('Water' if item['k'] == 'w' else 'Custom activity')


def kind_of(item, base, lib):
    if item['k'] == 'w':
        return 'water'
    if item['k'] == 'l':
        c = lib.get(item['r'], {}).get('c', '')
        if c in ('Arrival games', 'Team challenges'):
            return 'warm'
        if c == 'Small-sided games':
            return 'game'
        return 'drill'
    if item['k'] == 'o' and base[item['i']]['kind']:
        return base[item['i']]['kind']
    t = title_of(item, base, lib).lower()
    if 'water' in t:
        return 'water'
    if re.search(r'huddle|team name|award|showcase|talk|the last thing', t):
        return 'talk'
    if re.search(r'scrimmage|small-sided|world cup|coaches vs|shootout|shape', t):
        return 'game'
    if re.search(r'arrival|traffic light|sharks|number freeze|rescue tag|follow the leader|body part', t):
        return 'warm'
    return 'drill'


def body_of(item, base, lib):
    """Mirrors itemBodyHTML() in the page, so a baked block reads the same."""
    if item['k'] == 'o':
        return base[item['i']]['body']

    if item['k'] == 'l':
        a = lib.get(item['r'])
        if not a:
            sys.exit('The code refers to a library activity that is gone: %s' % item['r'])
        h = ['\n      <h4><a href="library.html#%s"><em>%s</em></a></h4>' % (a['id'], esc(a['n']))]
        if a.get('b'):
            h.append('\n      <p>%s</p>' % esc(a['b']))
        if a.get('k'):
            h.append('\n      <p class="fromlib"><b>You need</b> &mdash; %s</p>' % esc(a['k']))
        h.append('\n      <p class="fromlib">From the library: '
                 '<a href="library.html#%s">%s</a> &middot; %s</p>' % (a['id'], esc(a['n']), esc(a['c'])))
        return ''.join(h)

    if item['k'] == 'w':
        note = item.get('x') or 'Everybody drinks. Move them into shade even if it costs thirty seconds.'
        return ('\n      <h4>%s <em>&mdash; in shade</em></h4>\n      <p>%s</p>'
                % (esc(item.get('t') or 'Water'), esc(note)))

    out = ['\n      <h4>%s</h4>' % esc(item.get('t') or 'Custom activity')]
    if item.get('x'):
        out.append('\n      <p>%s</p>' % esc(item['x']).replace('\n', '<br>'))
    return ''.join(out)


def clock(m):
    return '%d:%02d' % (m // 60, m % 60)


def render_blocks(plan, base, lib):
    at, out = 0, ['<div class="blocks">\n']
    for item in plan:
        d = int(item.get('d') or 0)
        out.append(
            '\n    <div class="blk" data-kind="%s"><div class="clock">'
            '<span class="t">%s</span><span class="d">%s</span></div><div class="body">%s\n'
            '    </div></div>\n'
            % (kind_of(item, base, lib), clock(at),
               ('%d min' % d) if d else '&mdash;',
               body_of(item, base, lib)))
        at += d
    out.append('\n  ')
    return ''.join(out), at


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--code', help='a "s1.2.eyJ..." code, or the whole copied block')
    src.add_argument('--paste', help='file holding the copied block')
    src.add_argument('--url', help='a session URL carrying ?p=')
    ap.add_argument('--session', type=int, help='session number, if the code does not say')
    ap.add_argument('--force', action='store_true',
                    help='bake even though the code was built from an older edition')
    ap.add_argument('--dry-run', action='store_true', help='show the result, write nothing')
    args = ap.parse_args()

    num, edition, plan = parse_input(args)
    num = args.session or num
    if not num:
        sys.exit('Which session is this? Pass --session N.')
    if not isinstance(plan, list) or not plan:
        sys.exit('That code carries an empty practice; nothing to publish.')

    path, html = read_page(num)
    lib = read_lib(html)
    base, start, end = read_blocks(html)
    current = read_edition(html)

    for item in plan:
        if item.get('k') == 'o' and not (0 <= item.get('i', -1) < len(base)):
            sys.exit('That code points at written block %s, but session %d only has %d. '
                     'It was almost certainly built from an older edition of the page.'
                     % (item.get('i'), num, len(base)))

    if edition is not None and edition != current and not args.force:
        sys.exit('That code was built from edition %d of session %d, which is now on edition %d. '
                 'Ask for a fresh copy from the site, or pass --force if you are sure.'
                 % (edition, num, current))

    blocks_html, total = render_blocks(plan, base, lib)

    print('Session %d — edition %d -> %d, %d blocks, %d min'
          % (num, current, current + 1, len(plan), total))
    at = 0
    for item in plan:
        d = int(item.get('d') or 0)
        print('  %5s (%2d min)  %-46s %s'
              % (clock(at), d, title_of(item, base, lib), kind_of(item, base, lib)))
        at += d
    if total != 75:
        print('  note: %d minutes, not the usual 75.' % total)

    if args.dry_run:
        print('\n--dry-run: nothing written.')
        return

    out = html[:start] + blocks_html + html[end:]
    out = re.sub(r'(<article class="card" id="s%d")(?:\s+data-edition="\d+")?' % num,
                 r'\1 data-edition="%d"' % (current + 1), out, count=1)

    io.open(path, 'w', encoding='utf-8', newline='\r\n').write(out)
    print('\nWrote %s. Commit and push, and Pages publishes it.' % os.path.basename(path))


if __name__ == '__main__':
    main()
