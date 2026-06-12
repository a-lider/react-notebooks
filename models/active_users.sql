-- active_users: one row per user per active day, with weeks since signup
-- (NULL for users who never signed up).
SELECT
  e.user_id,
  date(e.timestamp) AS day,
  e.timestamp,
  CAST((julianday(e.timestamp) - julianday(s.first_signup)) / 7 AS INTEGER) AS weeks_since_signup
FROM events e
LEFT JOIN (
  SELECT user_id, MIN(timestamp) AS first_signup
  FROM events WHERE event = 'signup' GROUP BY user_id
) s ON s.user_id = e.user_id
WHERE e.event IN ('login', '$pageview', 'signup')
GROUP BY e.user_id, day
