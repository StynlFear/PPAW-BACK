-- Add role to user_profiles for authorization (user/admin).

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS role varchar NOT NULL DEFAULT 'user';
