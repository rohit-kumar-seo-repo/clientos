# ClientOS — Visual Design Reference (source of truth)

Subagents implementing UI tasks cannot see the reference screenshot Rohit
provided at the start of this project — this document is the written
substitute. **Do not deviate toward a generic Tailwind admin-dashboard
look** (bright gradient cards, heavy shadows, colorful icon tiles, dense
chart-heavy layouts). The reference is calm, white, restrained, and
precise — closer to Linear/Stripe/Notion than to a typical open-source
admin template.

## Overall structure

Three-column layout on desktop:
1. **Left sidebar** (fixed width, ~240px) — white background, thin right
   border, logo + product name top-left, grouped navigation below.
2. **Main content** (flexible width) — off-white/light-gray page
   background (`bg-neutral-50`), white cards with subtle borders float on
   top of it, generous padding (`p-8` on the main content area).
3. **Right sidebar** (fixed width, ~320px, dashboard pages only) — stacked
   white panels: "This Month Overview," "Upcoming Reminders," "Calendar,"
   "Quick Actions." Not present on non-dashboard pages (e.g. the client
   detail page uses the full content width for its two-column grid).

## Sidebar

- Logo mark (small rounded square, dark) + "ClientOS" wordmark, bold,
  top-left, in its own padded row.
- Primary nav (flat list, no headers): Overview, Clients, Work, Payments,
  Calendar, Reports.
- A "MANAGEMENT" section header (small, uppercase, muted gray, letter-
  spaced) above: Services, Reminder Rules, Team, Integrations.
- A "SETTINGS" section header above: Organization, Razorpay,
  Notifications, Preferences.
- Nav items: small rounded-corner hover background
  (`hover:bg-neutral-100`), no icons required (the reference has icons,
  but text-only nav is an acceptable simplification — do not invent
  colorful icon tiles to compensate).
- Active route gets a slightly stronger background/text weight than hover
  (not yet specced further — a reasonable subtle treatment is fine, avoid
  a loud colored pill).

## Header (top of main content)

- Large "Good [morning/afternoon/evening], [Name]" greeting, semibold,
  near-black.
- Date below it, smaller, muted gray, full format ("Thursday, 3 September
  2026" style — a locale-formatted long date, not "9/3/26").
- On dashboard-type pages only (not required for the Foundation plan): a
  search bar, "+ New" button, notification bell, profile avatar sit to
  the right of the greeting in the same header row. Foundation plan pages
  don't need these yet — don't fabricate them just to match the picture;
  add them when the features they open actually exist.

## Cards & panels

- White background, `1px` neutral-200 border, **no heavy drop shadow** —
  at most a very soft `shadow-sm`. Border radius ~12px (`rounded-xl`).
- Padding inside cards is generous (`p-6` for panel-style cards).
- Section headings inside a card: small (`text-sm`), medium weight, dark
  gray — not oversized, not colorful.

## Tables (e.g. a future "Clients Requiring Attention" table)

- Sits inside a white bordered card (`rounded-xl border border-neutral-200
  overflow-hidden`).
- Header row: light bottom border, muted gray label text, left-aligned,
  medium weight — no background fill, no uppercase unless matching a
  section-header treatment already in use.
- Row separators: hairline borders between rows, none on the last row.
- Row hover: subtle background tint at most — nothing jarring.
- A row's primary identifier (client name, invoice number, etc.) is the
  only bold/linked text in the row; everything else is regular weight,
  neutral-600/700.

## Status badges (future — billing/reminder phases, but keep the palette
consistent from the start)

Small rounded-full or rounded-md pill, colored background at ~10-15%
opacity of the accent with matching darker text, never a solid loud fill:
- **Red** (overdue/problem) — e.g. `bg-red-50 text-red-600` with a
  `border-red-200`-ish hairline if a border is used at all.
- **Orange/amber** (due soon) — `bg-amber-50 text-amber-700`.
- **Green** (paid/completed) — `bg-emerald-50 text-emerald-700`.
- **Blue/purple** (informational/upcoming) — `bg-indigo-50 text-indigo-600`
  or `bg-blue-50 text-blue-600`.
- **Neutral** (inactive/no action, e.g. CHURNED/PAUSED client status) —
  `bg-neutral-100 text-neutral-500`.

## Buttons

- Primary action: solid near-black fill (`bg-neutral-900`), white text,
  `rounded-lg`, medium-weight label, modest padding (`px-4 py-2 text-sm`).
  Hover darkens slightly (`hover:bg-neutral-800`).
- Secondary action: white background, neutral-300 border, neutral-700
  text, same radius/padding, hover to `bg-neutral-50`.
- Destructive action (e.g. "Remove" on a contact): text-only or very
  minimal treatment (muted gray, turns red on hover) — never a loud solid
  red button for a low-stakes inline removal; reserve strong red
  treatment for genuinely destructive, confirmed actions.

## Typography

- System font stack (no custom webfont import needed — Tailwind's
  default `font-sans` matches the reference's clean sans-serif).
  system font, no serif anywhere, no display/script fonts.
- Scale: page title ~`text-lg font-semibold`, section headings
  ~`text-sm font-medium`, body/table text ~`text-sm`, secondary/muted
  text ~`text-sm text-neutral-500` or `text-xs text-neutral-400` for the
  smallest labels (e.g. section group headers in the sidebar).

## Explicitly avoid

- Gradient backgrounds or gradient buttons.
- Large colorful stat cards with saturated fills (the reference's
  "Attention" summary cards use white cards with a single colored
  accent — a number and a small colored icon/badge — not a fully
  colored tile).
- Emoji as UI iconography.
- Rounded-full avatar-heavy "social app" styling outside the one profile
  avatar in the header.
- Dense multi-chart dashboards — this product deliberately has few
  visualizations; most of the interface is text, tables, and status.
