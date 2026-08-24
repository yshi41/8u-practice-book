# The 8U Practice Book

Sixteen 75-minute practice plans for a **9v9 SBMSA 8U girls' season** — eight weeks, two sessions a week, for a **12-player roster** spanning complete beginners to experienced players.

**Live:** https://yshi41.github.io/8u-practice-book/

## Two documents, two jobs

| File | What it is | When you use it |
| --- | --- | --- |
| [`index.html`](index.html) | **Contents** — the season at a glance, linking to each session | Finding the session you want. |
| `session-1.html` … `session-16.html` | **One practice per page** — its own URL, with previous/next links | Working from a single session, or sending one to someone. |
| [`library.html`](library.html) | **The Coaching Library** — the season plan and every activity explained | At home, the night before. |

Every activity name on a session card is a **link** into its library entry. Tap "The Toy Box" on Session 1 and you land on the diagram, the setup steps, and what it teaches.

## Sharing and adjusting a practice

Every session card carries its own controls.

**Share this practice**
- **Email it** — opens your mail client with the subject, the focus, the full block-by-block plan and the total length already written, plus a link to that practice. If you have adjusted the practice, the email carries your version.
- **Copy practice link** — the URL of that session's own page, e.g. `…/session-7.html`. A real page, not the whole book scrolled to an anchor.
- **Copy link with my changes** — appears once you have adjusted something. The URL carries your adjustments, so the person you send it to sees your version, not the original.

**Adjust this practice**
- Change the **minutes** on any block; every later start time and the total recompute as you type. The total turns amber if it is no longer 75 minutes.
- **Reorder** or **remove** any block.
- **Add an activity** — pick any of the 52 activities from the library, or write a custom one with your own notes. Library additions carry their own "you need" line and a link back to the full entry.
- **Reset to original** puts the session back as written.

Adjustments are saved in your browser, so they survive a reload. They are per-device — sharing them is what the link and email are for.

All of it is hidden when printing.

## Printing

Open a session page and press **Ctrl+P** — it prints to a single sheet, with the navigation, share buttons and adjust controls dropped out and the background white.

There is no print-all page: every practice lives on its own page, so printing the whole season means printing sixteen pages. If you want a single printable sheet-per-session document, ask and it can be generated.

## What's in the library

**The season plan** — seven sections that used to sit at the front of the practice book:

| Section | Contents |
| --- | --- |
| How this book works | The weekly loop and the fixed 75-minute template |
| Coaching a roster this wide | The mixed-ability method — seven moves that actually work |
| What 9v9 changes | Why nine-a-side is a harder problem at this age, and the 3–3–2 shape |
| The 12-player plan | Game-day rotation grid, keeper rotation, attendance fallbacks, and how 12 divides at practice |
| Your league rules | Checked against the SBMSA rulebook: 9v9, 4 × 12-minute quarters, minimum two quarters per player, substitutions at quarter breaks only, size 4 ball, build-out line on goal kicks, offside in effect. Plus two rules the league enforces that the rulebook never states: no punting, and any head contact stops play. |
| Houston heat | Operational requirements, not cautions |
| The eight-week arc | Theme, sessions, and move of the week |

**The drill library** — all 35 activities, each with an overhead diagram, numbered setup and run steps, what it teaches, and how to scale it up or down:

- **Soccer words** — every coaching term in plain English (gate, grid, endzone, numbers-up, goal-side…)
- **Diagram key** — how to read the pictures
- **Arrival games** (6) · **Ball moves** (8) · **Skill blocks** (14) · **Small-sided games** (15) · **Team challenges** (8)
- **Running a session** — odd attendance, and what to hand your assistant coaches

All distances are given in **adult walking steps**. Nothing needs measuring.

## The rhythm

The schedule is unstable by design — a game can land on a practice day and eat it — so it is always obvious which session carries new material.

- **Odd-numbered sessions teach.** Every new concept and every move of the week. Protect these.
- **Even-numbered sessions sharpen.** Rehearse and apply. Safe to lose.
- **Game day → play.** Two instructions for the whole match, maximum.

If a game cancels a practice, slide that session rather than skipping it. If the season runs short, cut from the middle — never the end.

## The season arc

Individual → individual against an opponent → scoring → with a teammate → team shape → winning it back → play.

1. Belonging & ball comfort
2. Dribbling to escape
3. 1v1, both ways
4. Scoring
5. Playing with a friend
6. Making the field big
7. Winning it back
8. Play

## Editing

Eighteen self-contained HTML files — no build step, no dependencies, no external fonts or CDN, and every diagram is inline SVG. Edit, commit, push; Pages redeploys in about a minute. Each file carries its own copy of the stylesheet, so either one still works opened straight off disk.

## Assumptions

A shared half-field, two pop-up goals, pinnies in two colours, roughly 24 discs, and a ball per girl (12 balls). Games are four 12-minute quarters — a 48-minute match — per Rule 6.07, which is what the rotation grid is built on. Every activity works smaller — adjust grid sizes to the space you actually get.
