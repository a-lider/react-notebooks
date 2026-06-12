-- signup_events: events relevant to the signup funnel.
-- Loaded as a view over data/events.db by the local query engine.
SELECT user_id, event, browser, url, timestamp
FROM events
WHERE event IN ('$pageview', 'signup')
