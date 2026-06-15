import { Page, Callout } from '@/components/notebook'
import { Query } from '@/components/analytics'

export default function Welcome() {
  return (
    <Page title="Welcome">
      <h1>Welcome to react-notebooks</h1>

      <p>
        Everything here is a plain JSX page in <code>pages/</code> — notebooks, dashboards,
        reports are all just pages. Agents write pages as code, this app renders them, and git
        reviews them. Click any text to edit — changes autosave into the page's source file.
        Hover a block for the + and drag handles, type / in an empty block for block types, and
        drag a block to the side of another to make columns.
      </p>

      <Callout>
        Try it: ask an agent (or yourself) to create <code>pages/my-analysis.tsx</code> — it
        appears in the sidebar instantly. The conventions live in <code>AGENTS.md</code>.
      </Callout>

      <h2>How a page gets its data</h2>

      <p>
        For ad-hoc exploration, drop a <code>Query</code> block directly on the page — write SQL
        against the models in <code>models/</code> (available as views) and the results render
        inline. In dev mode the query autosaves back into this file as you type:
      </p>

      <Query
        title="Signups by browser"
        sql={`SELECT browser, COUNT(*) AS signups
FROM signup_events
WHERE event = 'signup'
GROUP BY browser
ORDER BY signups DESC`}
        chart="pie"
        x="browser"
        y="signups"
      />

      <h2>Where things live</h2>

      <ul>
        <li><code>pages/</code> — all the pages; columns via Columns/Column when needed</li>
        <li><code>components/notebook</code> — Page, Note, Stat, Mention, Callout</li>
        <li><code>components/analytics</code> — Trend, Funnel, Query</li>
        <li><code>metrics/</code> + <code>models/</code> — the semantic layer</li>
        <li><code>lib/</code> — the data runtime and result cache</li>
      </ul>

      <Query
        title="Daily active users (last 30 days)"
        sql={`SELECT day, COUNT(DISTINCT user_id) AS dau
FROM active_users
WHERE day >= date('now', '-30 days')
GROUP BY day
ORDER BY day`}
        chart="bar"
        x="day"
        y="dau"
      />
    </Page>
  )
}
