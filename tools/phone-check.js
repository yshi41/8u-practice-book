/**
 * Does anything overflow a phone?
 *
 * Paste into the console of a page, or run it through a browser tool, with the
 * viewport at a phone width. It reports every element wider than the screen and
 * every one clipped by an ancestor that hides its overflow -- which is the way
 * a table goes missing rather than merely looking cramped.
 *
 *     phoneCheck()            // the page as it stands
 *     phoneCheck(360)         // pretend the screen is 360 wide
 *
 * Returns { ok, width, problems: [...] }. Nothing to install; it is here so the
 * next person checks the same things rather than eyeballing it.
 */
function phoneCheck(assumeWidth) {
  var W = assumeWidth || window.innerWidth;
  var problems = [];

  function name(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  }

  /* 1. the page itself must not scroll sideways */
  if (document.documentElement.scrollWidth > W + 1) {
    problems.push({
      what: 'the page scrolls sideways',
      el: 'document',
      is: document.documentElement.scrollWidth + 'px',
      fits: W + 'px'
    });
  }

  function inScroller(el) {
    for (var p = el.parentElement; p; p = p.parentElement) {
      var o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  }

  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var box = el.getBoundingClientRect();
    if (!box.width && !box.height) continue;              // not shown
    var style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (style.position === 'fixed') continue;             // its own coordinate space

    /* 2. anything sticking out past the right edge -- unless it is inside
       something built to scroll sideways, which is the right answer for a
       dense reference table and not a fault. */
    if (box.right > W + 1) {
      if (!inScroller(el)) {
        problems.push({ what: 'sticks out past the screen', el: name(el),
                        is: Math.round(box.right) + 'px', fits: W + 'px' });
      }
      continue;
    }

    /* 3. anything wider than the box it is in, where that box hides the
       overflow -- content silently cut off, which is worse than a scrollbar */
    var parent = el.parentElement;
    if (!parent) continue;
    var pStyle = getComputedStyle(parent);
    var hidden = pStyle.overflowX === 'hidden' || pStyle.overflow === 'hidden';
    if (hidden && el.scrollWidth > parent.clientWidth + 1) {
      problems.push({ what: 'clipped by its container', el: name(el),
                      is: el.scrollWidth + 'px', fits: parent.clientWidth + 'px',
                      inside: name(parent) });
    }
  }

  /* 4. tap targets that are too small to hit with a thumb.
     A link inside a sentence is exempt: the rule is for things that stand on
     their own as controls, and padding a word in the middle of a paragraph to
     28px wrecks the line spacing without making anything easier to hit. */
  function inlineInProse(el) {
    if (el.tagName !== 'A') return false;
    var d = getComputedStyle(el).display;
    if (d !== 'inline' && d !== 'inline-block') return false;
    var p = el.parentElement;
    if (!p) return false;
    if (!/^(P|LI|SPAN|EM|B|STRONG|DIV|H1|H2|H3|H4|TD)$/.test(p.tagName)) return false;
    return (p.textContent || '').trim().length > (el.textContent || '').trim().length + 3;
  }

  var tappable = document.querySelectorAll('button, a, input, select, textarea');
  for (var j = 0; j < tappable.length; j++) {
    var t = tappable[j];
    var r = t.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (getComputedStyle(t).display === 'none') continue;
    if (inlineInProse(t)) continue;
    if (r.height < 28) {
      problems.push({ what: 'too small to tap', el: name(t),
                      is: Math.round(r.height) + 'px tall', fits: '28px or more' });
    }
  }

  return { ok: problems.length === 0, width: W, problems: problems };
}

if (typeof module !== 'undefined') module.exports = phoneCheck;
