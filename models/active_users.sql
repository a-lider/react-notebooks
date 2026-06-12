-- active_users: one row per user per active day.
SELECT
  user_id,
  CAST(timestamp AS DATE) AS day,
  date_diff('week', first_seen, timestamp) AS weeks_since_signup
FROM events
WHERE event IN ('app_opened', 'feature_used')
GROUP BY user_id, day, weeks_since_signup
