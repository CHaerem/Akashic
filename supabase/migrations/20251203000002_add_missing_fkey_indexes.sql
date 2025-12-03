-- Add indexes for unindexed foreign keys
-- Improves CASCADE delete performance

CREATE INDEX IF NOT EXISTS idx_journey_members_invited_by ON journey_members(invited_by);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_by ON photos(uploaded_by);
