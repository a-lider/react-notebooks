import { Page, Stat, Columns, Column, Callout } from '@/components/notebook'
import { Trend, DataTable, Query } from '@/components/analytics'
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

      <DataTable
        columns={[
          { key: 'channel', label: 'Channel' },
          { key: 'signups', label: 'Signups', align: 'right' },
          { key: 'conversion', label: 'Conversion', align: 'right' },
        ]}
        rows={[
          { channel: 'Organic search', signups: 1842, conversion: '4.1%' },
          { channel: 'Referral', signups: 967, conversion: '6.8%' },
          { channel: 'Direct', signups: 743, conversion: '3.2%' },
          { channel: 'Paid social', signups: 489, conversion: '1.9%' },
        ]}
      />

      <Callout>dfghjkl;'</Callout>

      <p></p>

      <Query sql={`SELECT * 
FROM events
where event = '$pageview'
`} />
    </Page>
  )
}
