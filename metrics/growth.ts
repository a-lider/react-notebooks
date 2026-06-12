import { defineMetric } from '@/lib/metrics'

export const signups = defineMetric({
  key: 'signups',
  label: 'Completed signups',
  model: 'signup_events',
  agg: 'count',
  where: "event = 'signup'",
  unit: 'users',
  description: 'Users who completed the signup flow.',
  owners: ['growth'],
})

export const signupConversion = defineMetric({
  key: 'signup_conversion',
  label: 'Visit → signup conversion',
  model: 'signup_events',
  agg: 'ratio',
  num: "event = 'signup'",
  den: "event = '$pageview' AND url = '/signup'",
  unit: 'percent',
  owners: ['growth'],
})

export const weeklyActiveUsers = defineMetric({
  key: 'weekly_active_users',
  label: 'Weekly active users',
  model: 'active_users',
  agg: 'unique',
  unit: 'users',
  owners: ['growth'],
})
