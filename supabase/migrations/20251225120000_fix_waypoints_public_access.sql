-- Fix waypoints RLS policy to allow viewing waypoints on public journeys
-- This fixes E2E tests and allows unauthenticated users to view public journey waypoints

-- Drop existing policy
DROP POLICY IF EXISTS "Members can view waypoints" ON waypoints;

-- Recreate policy with public journey support
-- Read: user is a member (any role) OR journey is public
CREATE POLICY "Members can view waypoints" ON waypoints
  FOR SELECT USING (
    user_has_journey_access(journey_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = waypoints.journey_id
      AND journeys.is_public = true
    )
  );
