import { Page, Callout } from '@/components/notebook'
import { Trend } from '@/components/analytics'
import { signups } from '@/metrics/growth'

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
        Pages never fetch and never contain numbers. They import metrics from{' '}
        <code>metrics/</code> (the semantic layer, built on the SQL models in{' '}
        <code>models/</code>) and pass them to components from <code>components/</code>. The
        chart below is two lines of JSX:
      </p>

      <Trend metric={signups} interval="week" />

      <h2>Where things live</h2>

      <ul>
        <li><code>pages/</code> — all the pages; columns via Columns/Column when needed</li>
        <li><code>components/notebook</code> — Page, Note, Stat, Mention, Callout</li>
        <li><code>components/analytics</code> — Trend, Funnel, DataTable</li>
        <li><code>metrics/</code> + <code>models/</code> — the semantic layer</li>
        <li><code>lib/</code> — the data runtime and result cache</li>
      </ul>
    </Page>
  )
}
