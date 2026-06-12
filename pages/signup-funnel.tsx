import { Page, Note, Stat, Mention, Columns, Column, Callout } from '@/components/notebook'
import { Funnel, Trend, Query } from '@/components/analytics'
import { signups, signupConversion } from '@/metrics/growth'

export default function SignupFunnel() {
  return (
    <Page title="Signup funnel investigation">
      <h1>Signup funnel</h1>

      <p>Conversion moved <Stat metric={signupConversion} format="percent-change" /> after the pricing release — almost entirely in Chrome. cc <Mention user="marius" /></p>

      <Funnel
        steps={[
          { event: '$pageview', url: '/signup', label: 'Visited /signup' },
          { event: 'signup', label: 'Signed up' },
          { event: 'onboarding_completed', label: 'Onboarded' },
          { event: 'trial_started', label: 'Trial started' },
          { event: 'subscribed', label: 'Subscribed' },
        ]}
        breakdown="$browser"
      />

      <h2>Signups over time</h2>

      <Trend metric={signups} interval="week" compare="previous-period" />

      <Note author="alex">The drop tracks the new pricing modal. Next: pull a replay sample of Chrome sessions that abandoned between steps 2 and 3.</Note>

      <Callout></Callout>

      <Columns>
        <Column>
          <Query y="users" x="browser" chart="pie" sql={`SELECT browser, COUNT(DISTINCT user_id) AS users
FROM events WHERE event = 'signup'
GROUP BY browser ORDER BY users DESC`} />
        </Column>
        <Column>
          <p>Some text</p>

          <p></p>
        </Column>
      </Columns>
    </Page>
  )
}
