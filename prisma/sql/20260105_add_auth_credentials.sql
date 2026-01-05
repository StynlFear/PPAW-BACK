-- Add local auth credentials for email/password + JWT login.
-- This keeps existing user_profiles intact and stores passwords as hashes only.

CREATE TABLE IF NOT EXISTS auth_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  email varchar NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
