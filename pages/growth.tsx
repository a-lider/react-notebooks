import { Page, Stat, Columns, Column } from '@/components/notebook'
import { Trend, Query } from '@/components/analytics'
import { signups, signupConversion, weeklyActiveUsers } from '@/metrics/growth'
import { week1Retention } from '@/metrics/retention'

export default function GrowthDashboard() {
  return (
    <Page title="Growth" layout="wide">
      <h1>Growth</h1>

      <p>WAU <Stat metric={weeklyActiveUsers} /> · signups <Stat metric={signups} format="percent-change" /> vs previous period · week-1 retention <Stat metric={week1Retention} format="percent" /></p>

      <Columns>
        <Column>
          <Trend metric={weeklyActiveUsers} interval="week" />

          <Trend metric={signupConversion} interval="week" />
        </Column>
        <Column>
          <Trend metric={signups} interval="week" compare="previous-period" />

          <Trend metric={week1Retention} interval="month" />
        </Column>
      </Columns>

      <h2>Top acquisition channels</h2>

      <Query
        title="Signups by acquisition source"
        sql={`SELECT
  utm_source AS source,
  COUNT(DISTINCT CASE WHEN event = 'signup' THEN user_id END) AS signups,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN event = 'signup' THEN user_id END)
    / COUNT(DISTINCT CASE WHEN event = '$pageview' AND url = '/' THEN user_id END),
    1
  ) AS conversion_pct
FROM events
GROUP BY utm_source
ORDER BY signups DESC`}
      />
    </Page>
  )
}
