-- ============================================
-- Fix missing journey owners
-- Adds creator as owner for any journeys missing from journey_members
-- ============================================

-- Insert missing owners for journeys where creator isn't in journey_members
INSERT INTO journey_members (journey_id, user_id, role, invited_by)
SELECT
  j.id,
  j.created_by,
  'owner',
  j.created_by
FROM journeys j
WHERE j.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM journey_members jm
    WHERE jm.journey_id = j.id
    AND jm.user_id = j.created_by
  )
ON CONFLICT (journey_id, user_id) DO UPDATE SET role = 'owner';

-- Also ensure any existing entries for creators have owner role
UPDATE journey_members jm
SET role = 'owner'
FROM journeys j
WHERE jm.journey_id = j.id
  AND jm.user_id = j.created_by
  AND jm.role != 'owner';
