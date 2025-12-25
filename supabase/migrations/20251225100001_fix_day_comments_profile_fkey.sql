-- Fix day_comments foreign key to profiles
-- The PostgREST query needs a direct foreign key relationship to join tables

-- Drop the existing foreign key to auth.users
ALTER TABLE day_comments DROP CONSTRAINT IF EXISTS day_comments_user_id_fkey;

-- Add foreign key to profiles instead
-- This enables PostgREST to resolve the join in queries like:
-- author:profiles!user_id(id, display_name, avatar_url)
ALTER TABLE day_comments
  ADD CONSTRAINT day_comments_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;

-- Re-create the index for performance (dropped with constraint)
CREATE INDEX IF NOT EXISTS idx_day_comments_user_id ON day_comments(user_id);
