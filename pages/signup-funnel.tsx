import { Page, Note, Stat, Mention } from '@/components/notebook'
import { Funnel, Trend } from '@/components/analytics'
import { signups, signupConversion } from '@/metrics/growth'

export default function SignupFunnel() {
  return (
    <Page title="Signup funnel investigation">
      <h1>Signup funnel investigation</h1>

      <p>Conversion moved <Stat metric={signupConversion} format="percent-change" /> after the pricing release — almost entirely in Chrome. cc <Mention user="marius" /></p>

      <Funnel
        steps={[
          { event: '$pageview', url: '/signup' },
          { event: 'signup_started' },
          { event: 'signup_completed' },
        ]}
        breakdown="$browser"
      />

      <h3>another heading</h3>

      <h2>Signups over time</h2>

      <Trend metric={signups} interval="week" compare="previous-period" />

      <Note author="alex">
        The drop tracks the new pricing modal. Next: pull a replay sample of Chrome sessions
        that abandoned between steps 2 and 3.
      </Note>
    </Page>
  )
}
