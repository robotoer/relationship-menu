-- AI coach daily quota (docs/spec/coach.md, CO-8). Only counters: `key` is
-- "a:<account id>" or "total", `day` is a UTC date. No request content is stored.
CREATE TABLE coach_usage (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
) STRICT;
