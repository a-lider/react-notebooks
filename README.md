# react-notebooks

Local-first analytics notebooks. Pages are plain TSX files, charts are shadcn components, metrics are typed definitions. Everything lives in one repo and runs on your machine.

![Demo](docs/demo.gif)

## Why

Coding agents are thriving, but all the analytics tools were built before that era. What if all the context you need to do complex data analytics lived in one repo - dashboards, metric definitions, data transformations, docs, skills on how to query the data, Python scripts, notebooks.

This project explores how the agentic local-first analytics would look like: 

- **Notebooks and dashboards are code.** A report is a `.tsx` file in `pages/` — diffable, reviewable, git versioned. 
- **Metrics are defined once, in one place.** `metrics/` is a small semantic layer: typed, importable definitions (`defineMetric`) built on SQL models in `models/`. Pages could inline SQL or render `<Trend metric={signups} />` and `<Stat metric={signupConversion} />`.
- **Data stays local.** Queries run against a local SQLite database (for now)
- **Pages are just files, so anything can edit them.** Open a `.tsx` in your editor and change it by hand, or let a coding agent edit the page directly (see the demo) — no special API, it's just source.
- **Or edit in the browser.** A built-in Notion-style editor gives you a slash menu, drag-to-reorder, drag-beside for columns, and autosave. Every change is written back to the source file as a surgical, format-preserving splice, so the git diff stays small and reviewable.

## Current status

Right now the only supported query engine is **local SQLite**: a Vite dev-server plugin runs read-only SQL against `data/events.db` using `node:sqlite`, with every `models/*.sql` file loaded as a view. The adapter interface (`lib/data.ts`) is deliberately small — `metricSeries` and `funnel` — so warehouse adapters can slot in later. A zero-setup `demo` adapter with deterministic synthetic data is also included.

## Getting started

```sh
npm install
python3 data/generate.py   # builds data/events.db — a deterministic synthetic dataset
npm run dev
```

Open the dev server URL and you'll land in the notebook viewer. If you'd rather skip the dataset, switch `analytics.config.ts` to the demo adapter.

## How it fits together

```
pages/          the content — one default-exported JSX component per file
components/     building blocks: notebook/ (Page, Note, Stat, Mention, Columns…)
                and analytics/ (Trend, Funnel, Query, DataTable); ui/ is shadcn
metrics/        the semantic layer — typed metric definitions pages import
models/         SQL views the metrics build on (loaded into the engine at startup)
lib/            data runtime: useMetric/useFunnel, adapters, result cache
src/            the app shell and the in-browser editor
```

A page looks like this:

```jsx
import { Page, Note, Stat } from '@/components/notebook'
import { Funnel, Trend, Query } from '@/components/analytics'
import { signups, signupConversion } from '@/metrics/growth'

export default function SignupFunnel() {
  return (
    <Page title="Signup funnel investigation">
      <h1>Signup funnel</h1>
      <p>Conversion moved <Stat metric={signupConversion} format="percent-change" /> after the pricing release.</p>
      <Funnel
        steps={[
          { event: '$pageview', url: '/signup', label: 'Visited /signup' },
          { event: 'signup', label: 'Signed up' },
        ]}
        breakdown="$browser"
      />
      <Trend metric={signups} interval="week" compare="previous-period" />
      <Note author="alex">The drop tracks the new pricing modal.</Note>
      <Query x="browser" y="users" chart="pie" sql={`SELECT browser, COUNT(DISTINCT user_id) AS users
FROM events WHERE event = 'signup'
GROUP BY browser ORDER BY users DESC`} />
    </Page>
  )
}
```

See [AGENTS.md](AGENTS.md) for the conventions used when writing or editing pages.
