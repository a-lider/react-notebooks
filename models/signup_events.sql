-- signup_events: events relevant to the signup funnel.
-- A view over raw events; DuckDB locally, pushed to the warehouse in cloud mode.
SELECT
  user_id,
  event,
  properties.$browser AS browser,
  properties.url      AS url,
  timestamp
FROM events
WHERE event IN ('$pageview', 'signup_completed')
