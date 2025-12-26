-- Fix photos RLS policy to allow viewing photos on public journeys
-- This matches the waypoints fix and allows authenticated users to view photos on public journeys

-- Drop existing policy
DROP POLICY IF EXISTS "Members can view photos" ON photos;

-- Recreate policy with public journey support
-- Read: user is a member (any role) OR journey is public
CREATE POLICY "Members can view photos" ON photos
  FOR SELECT USING (
    user_has_journey_access(journey_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = photos.journey_id
      AND journeys.is_public = true
    )
  );
