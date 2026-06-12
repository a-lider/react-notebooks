# Analytics workspace — agent guide

This is a Vite + React 19 app. Notebooks and dashboards are JSX pages in `pages/`.
Run `npm run dev` to render; run `npm run check` (tsc + eslint) before every commit.

## Layout

- `pages/`      — notebooks & dashboards. One default-exported component per file.
                  Dashboards live in `pages/dashboards/`.
- `components/` — building blocks. `ui/` is shadcn (regenerate, don't hand-edit);
                  `notebook/` and `analytics/` are ours — read them before writing pages.
- `metrics/`    — the semantic layer. Pages import metrics; never inline SQL in a page.
- `models/`     — SQL transformations metrics build on.
- `lib/`        — data runtime (`useMetric`) and the result cache.
- `styles/`     — design tokens. Use Tailwind + existing tokens. No inline styles, no new colors.
- `src/`        — the app shell (viewer). Pages should not import from here.

Imports use the `@/` alias, which points at the repo root: `@/components/notebook`,
`@/metrics/growth`, `@/lib/data`.

## Writing a page

1. Pages are declarative JSX: text elements (h1, p, ul, blockquote) plus components
   from `components/`. No fetching, no useState/useEffect, no logic in pages —
   that belongs in components or the semantic layer.
2. Numbers in prose: use `<Stat metric={...} />`, never hardcode values into text.
3. Need a new visualization? Add a component to `components/analytics/`
   (shadcn chart + Recharts — copy Trend.tsx's shape), then use it from the page.
4. Need a new metric? Define it in `metrics/` with `defineMetric`, building on
   `models/` where possible. Check existing metrics first — don't redefine.
   For ad-hoc SQL, use a `<Query sql={`...`} />` block — it runs against
   `data/events.db` (generate with `python3 data/generate.py`; `models/*.sql`
   are available as views).
5. Keep props literal. Extract anything computed into the component or metric.

## Editing an existing page

- Change only the elements you mean to change. Never reformat the whole file.
- Don't rename or reorder other blocks; keep diffs reviewable.

## Style

- Lead with the finding, then the evidence. One chart per question.
- Interpretation goes in `<Note>`, not in chart titles.
- Titles in sentence case.
