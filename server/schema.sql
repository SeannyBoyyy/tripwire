CREATE TABLE IF NOT EXISTS tripwires (
  id            TEXT PRIMARY KEY,
  token         TEXT NOT NULL,
  coin_id       TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  name          TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('below', 'above')),
  target        REAL NOT NULL,
  start_price   REAL NOT NULL,
  created_at    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'armed' CHECK (status IN ('armed', 'tripped')),
  tripped_at    INTEGER,
  tripped_price REAL
);
CREATE INDEX IF NOT EXISTS tripwires_status ON tripwires (status);
CREATE INDEX IF NOT EXISTS tripwires_token ON tripwires (token);
