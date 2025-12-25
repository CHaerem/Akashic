-- Day Comments Migration
-- Adds support for commenting on specific days/waypoints of a journey

-- ============================================
-- 1. Create day_comments table
-- ============================================
CREATE TABLE day_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waypoint_id UUID NOT NULL REFERENCES waypoints(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Comment content (1-2000 characters)
  content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 2000),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. Indexes for performance
-- ============================================
CREATE INDEX idx_day_comments_waypoint_id ON day_comments(waypoint_id);
CREATE INDEX idx_day_comments_journey_id ON day_comments(journey_id);
CREATE INDEX idx_day_comments_user_id ON day_comments(user_id);
CREATE INDEX idx_day_comments_created_at ON day_comments(created_at DESC);

-- ============================================
-- 3. Enable RLS
-- ============================================
ALTER TABLE day_comments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 4. RLS Policies
-- ============================================

-- SELECT: Journey members can view, OR anyone on public journeys
CREATE POLICY "View comments on accessible journeys" ON day_comments
  FOR SELECT USING (
    user_has_journey_access(journey_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = day_comments.journey_id
      AND journeys.is_public = true
    )
  );

-- INSERT: Authenticated users can comment on public journeys, members can comment on private
CREATE POLICY "Add comments to accessible journeys" ON day_comments
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND (
      user_has_journey_access(journey_id, 'viewer')
      OR EXISTS (
        SELECT 1 FROM journeys
        WHERE journeys.id = day_comments.journey_id
        AND journeys.is_public = true
      )
    )
  );

-- UPDATE: Only comment author can edit their own comments
CREATE POLICY "Authors can update own comments" ON day_comments
  FOR UPDATE USING (auth.uid() = user_id);

-- DELETE: Comment author can delete, or journey editors/owners can moderate
CREATE POLICY "Authors or moderators can delete comments" ON day_comments
  FOR DELETE USING (
    auth.uid() = user_id
    OR user_has_journey_access(journey_id, 'editor')
  );

-- ============================================
-- 5. Auto-update updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_day_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER day_comments_updated_at
  BEFORE UPDATE ON day_comments
  FOR EACH ROW EXECUTE FUNCTION update_day_comments_updated_at();
