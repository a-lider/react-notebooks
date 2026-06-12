import { defineMetric } from '@/lib/metrics'

export const week1Retention = defineMetric({
  key: 'week1_retention',
  label: 'Week 1 retention',
  model: 'active_users',
  agg: 'ratio',
  num: 'weeks_since_signup = 1',
  den: 'weeks_since_signup = 0',
  unit: 'percent',
  owners: ['growth'],
})
