-- Whether a yearly plan ends at paid_through instead of renewing then (SY-64).
-- Existing rows default to renewing, matching what the app previously assumed.
ALTER TABLE accounts ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0
  CHECK (cancel_at_period_end IN (0, 1));
