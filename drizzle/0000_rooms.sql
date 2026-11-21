CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rooms_expires_idx ON rooms(expires);
