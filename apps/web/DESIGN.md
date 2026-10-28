# Design language

The web app follows one calm design language. It should feel like a quiet, well-made room
for practising out loud, never like a template: a cool grey ground, type doing the work,
the interviewer and the transcript at the centre, a single teal accent. These rules are the
contract for every page.

## Foundations

| Token | Use |
| --- | --- |
| `font-display` (Bricolage Grotesque, 600 to 700, tracking -0.02em) | Page titles, the home greeting, report scores, section headings in settings and admin |
| `font-sans` (Hanken Grotesk) | Everything else. Body and feedback text 15.5px at line height 1.7, meta 13px, labels 12.5px |
| `ink` | Text and the one solid call to action per screen (Start interview, Join, `Button variant="primary"`) |
| `primary` / `brand` | Links, focus rings, the active underline, the interviewer orb, small accents. Never large fills |
| `background` / `ground-2` | Page ground; the sidebar and the candidate's transcript lines sit on `ground-2` |
| `card` + `shadow-card` + `rounded-card` | Only surfaces that float: menus, dialogs, sheets, the code editor |
| `border` | 1px hairlines between list rows and sections |

Widths: reading columns (interview detail, report, new interview) `max-w-[780px]`, settings
`max-w-[860px]`, admin `max-w-[1200px]`, gutters `px-4 sm:px-6`. Light and dark mode are a
token swap: never hard-code a colour (`bg-white`, `#fff`, `text-gray-*`).

## Rules

1. **No box inside a box.** A surface never contains another bordered or tinted panel.
   Lists inside a surface are rows separated by hairlines.
2. **Feedback is not cards.** Strengths, weaknesses and suggestions are plain prose and
   lists on the page ground under each question. In the transcript only the candidate's own
   lines get a soft tint, so the two voices read apart at a glance.
3. **Forms are not wrapped in cards.** A settings page is a column of sections: heading,
   one line of help, fields, a save button.
4. **Choices are words, not pills.** Tabs and filters are plain words in a row; the active
   one is ink with a 2px underline as wide as the word. Use
   `components/common/underline-tabs.tsx`.
5. **Facts are type.** "Round 2 of 4 · System Design · 12 min" is one line of 13px meta
   text joined by middle dots, not chips. Proctoring notes ("Left the tab twice") are one
   muted line each, never a coloured panel.
6. **One lit action per screen.** One `primary` button; secondary actions are `outline`,
   `ghost` or a text link. Destructive actions confirm in a dialog that names the thing.
7. **Buttons are 10px-corner bars**, never capsules. Icon-only buttons are round
   (`IconButton`) and always have a label (tooltip and `aria-label`). Hover-only actions
   stay reachable by keyboard: they fade in on `focus-visible` too.
8. **The room is calm.** Transcript lines appear as they are spoken with no typing
   animation and no bouncing dots; the panel scrolls only while the reader is already at
   the bottom. Next question and Leave are always one click away.
9. **Instant UI.** Renames, plan edits and deletes are optimistic; skeletons match the
   final layout; never a bare spinner on a blank page. Errors say what happened and what to
   do, with the API `code` mapped in `lib/errors.ts`; a connection problem in the room keeps
   the transcript and offers a retry.
10. **No filler.** No "Welcome back!", no icon-in-a-tinted-circle feature grids, no gradient
    blobs, no invented numbers (usage and scores are shown only when they are real). No em
    dashes in any copy.
11. **Accessible by default.** Every interactive element is reachable and labelled; focus
    rings are visible; colour is never the only signal; contrast passes WCAG AA in both
    themes. New transcript lines and status changes are announced politely.

## Patterns

- **Shell**: a left sidebar (new interview, then recent interviews) that collapses on
  desktop and becomes a sheet on phones; the page fills the rest.
- **Home**: the greeting in display type, the two ways to start (upload a resume, paste a
  job description) as plain rows, this month's allowance when a limit is set, and recent
  interviews.
- **Interview**: the plan as rounds and questions in rows, editable before the first live
  session, with one primary action to start or continue.
- **Room**: full screen, no sidebar. The interviewer orb and the candidate's camera tile,
  a round progress header, the live transcript panel, a countdown for the session, the code
  editor for code questions, a typed-answer fallback, and a one-line proctoring notice when
  proctoring is on.
- **Report**: overall and per-round scores in display type, then every question with its
  ratings, feedback and (for the owner) the transcript or code.
- **Admin**: a left sidebar of areas, a page header with the title and the primary action,
  then tables with hairline rows, filters as underline tabs plus one search field, and
  detail in a right-side sheet.
- **Empty states**: one sentence of what this is and one action, using `EmptyState`.
- **Dates**: `lib/time.ts` helpers; relative for recent activity, absolute in the audit log.
