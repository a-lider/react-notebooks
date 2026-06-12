import { Page } from '@/components/notebook'
import { Query } from '@/components/analytics'

export default function VizTest() {
  return (
    <Page title="Viz test">
      <h1>Viz test</h1>

      <Query
        title="Funnel via SQL"
        chart="bar"
        x="step"
        y="users"
        sql={`WITH s0 AS (SELECT user_id, MIN(timestamp) t FROM events WHERE event = '$pageview' AND url = '/signup' GROUP BY user_id),
s1 AS (SELECT e.user_id, MIN(e.timestamp) t FROM events e JOIN s0 ON s0.user_id = e.user_id AND e.timestamp >= s0.t WHERE event = 'signup' GROUP BY e.user_id),
s2 AS (SELECT e.user_id, MIN(e.timestamp) t FROM events e JOIN s1 ON s1.user_id = e.user_id AND e.timestamp >= s1.t WHERE event = 'subscribed' GROUP BY e.user_id)
SELECT '1 visited' AS step, (SELECT COUNT(*) FROM s0) AS users
UNION ALL SELECT '2 signed up', (SELECT COUNT(*) FROM s1)
UNION ALL SELECT '3 subscribed', (SELECT COUNT(*) FROM s2)`}
      />

      <Query
        title="Signups trend"
        chart="line"
        x="day"
        y="signups"
        sql={`SELECT date(timestamp) AS day, COUNT(*) AS signups
FROM events WHERE event = 'signup'
GROUP BY 1 ORDER BY 1`}
      />
    </Page>
  )
}
