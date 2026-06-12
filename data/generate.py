#!/usr/bin/env python3
"""Generate data/events.db — a deterministic synthetic product-analytics dataset.

The database is gitignored; this script is the source of truth. Re-run any time:

    python3 data/generate.py

Events: $pageview, signup, login, onboarding_completed, trial_started, subscribed.
The last two weeks include a Chrome-specific signup-conversion drop so the
"Signup funnel investigation" notebook has something real to show.
"""

import math
import os
import random
import sqlite3
from datetime import datetime, timedelta

random.seed(42)

DB_PATH = os.path.join(os.path.dirname(__file__), "events.db")
END = datetime(2026, 6, 12, 12, 0, 0)  # fixed so the dataset is reproducible
DAYS = 120
PRICING_RELEASE = END - timedelta(days=14)  # Chrome conversion drops after this

BROWSERS = [("Chrome", 0.55), ("Safari", 0.25), ("Firefox", 0.12), ("Edge", 0.08)]

# step-to-step conversion probabilities
P_VIEW_SIGNUP_PAGE = 0.62   # landing visitor views /signup
P_SIGNUP = 0.38             # /signup viewer signs up
P_SIGNUP_CHROME_AFTER_RELEASE = 0.24  # the drop the notebook investigates
P_ONBOARD = 0.68
P_TRIAL = 0.55
P_SUBSCRIBE = 0.38
WEEKLY_RETENTION_DECAY = 0.82  # P(login in week w) = 0.6 * decay**(w-1)


def pick_browser() -> str:
    r = random.random()
    acc = 0.0
    for name, share in BROWSERS:
        acc += share
        if r < acc:
            return name
    return BROWSERS[-1][0]


def jitter(base: datetime, min_minutes: int, max_minutes: int) -> datetime:
    return base + timedelta(minutes=random.randint(min_minutes, max_minutes))


def main() -> None:
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    con = sqlite3.connect(DB_PATH)
    con.executescript(
        """
        CREATE TABLE events (
          id        INTEGER PRIMARY KEY,
          user_id   TEXT NOT NULL,
          event     TEXT NOT NULL,
          timestamp TEXT NOT NULL,   -- 'YYYY-MM-DD HH:MM:SS'
          url       TEXT,
          browser   TEXT NOT NULL
        );
        """
    )

    rows: list[tuple[str, str, str, str | None, str]] = []

    def emit(user: str, event: str, ts: datetime, browser: str, url: str | None = None) -> None:
        if ts <= END:
            rows.append((user, event, ts.strftime("%Y-%m-%d %H:%M:%S"), url, browser))

    user_n = 0
    start = END - timedelta(days=DAYS)
    for day in range(DAYS):
        date = start + timedelta(days=day)
        # gentle growth + weekend dip
        growth = 1.008 ** day
        weekday_factor = 0.62 if date.weekday() >= 5 else 1.0
        visitors = int(70 * growth * weekday_factor * random.uniform(0.85, 1.15))

        for _ in range(visitors):
            user_n += 1
            user = f"u{user_n:06d}"
            browser = pick_browser()
            t = date.replace(hour=0) + timedelta(seconds=random.randint(7 * 3600, 23 * 3600))

            emit(user, "$pageview", t, browser, "/")
            if random.random() >= P_VIEW_SIGNUP_PAGE:
                continue
            t = jitter(t, 1, 9)
            emit(user, "$pageview", t, browser, "/signup")

            p_signup = (
                P_SIGNUP_CHROME_AFTER_RELEASE
                if browser == "Chrome" and date >= PRICING_RELEASE
                else P_SIGNUP
            )
            if random.random() >= p_signup:
                continue
            t = jitter(t, 2, 15)
            emit(user, "signup", t, browser, "/signup")
            signup_ts = t

            if random.random() < P_ONBOARD:
                t = jitter(t, 10, 240)
                emit(user, "onboarding_completed", t, browser, "/onboarding")

                if random.random() < P_TRIAL:
                    t = jitter(t, 60, 3 * 24 * 60)
                    emit(user, "trial_started", t, browser, "/billing")

                    if random.random() < P_SUBSCRIBE:
                        t = jitter(t, 24 * 60, 14 * 24 * 60)
                        emit(user, "subscribed", t, browser, "/billing")

            # recurring logins — simple decaying retention curve
            week = 1
            while True:
                week_start = signup_ts + timedelta(days=7 * (week - 1) + 1)
                if week_start > END:
                    break
                if random.random() < 0.6 * (WEEKLY_RETENTION_DECAY ** (week - 1)):
                    for _ in range(random.randint(1, 3)):
                        lt = week_start + timedelta(
                            days=random.uniform(0, 6.5), seconds=random.randint(0, 3600)
                        )
                        emit(user, "login", lt, browser, "/login")
                        emit(user, "$pageview", jitter(lt, 0, 2), browser, "/")
                week += 1

    con.executemany(
        "INSERT INTO events (user_id, event, timestamp, url, browser) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    con.executescript(
        """
        CREATE INDEX idx_events_user ON events(user_id);
        CREATE INDEX idx_events_event ON events(event);
        CREATE INDEX idx_events_ts ON events(timestamp);
        """
    )
    con.commit()

    print(f"{DB_PATH}: {len(rows):,} events, {user_n:,} users")
    for event, count in con.execute(
        "SELECT event, COUNT(*) FROM events GROUP BY event ORDER BY 2 DESC"
    ):
        print(f"  {event:<22} {count:>8,}")
    size_mb = os.path.getsize(DB_PATH) / 1e6
    print(f"  db size: {size_mb:.1f} MB")
    con.close()


if __name__ == "__main__":
    main()
