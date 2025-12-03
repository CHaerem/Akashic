-- Fix RLS initplan performance issues
-- Replace auth.uid() with (select auth.uid()) to avoid per-row re-evaluation

-- ============================================
-- 1. Fix profiles policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
CREATE POLICY "Authenticated users can view profiles" ON profiles
  FOR SELECT USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id);

-- ============================================
-- 2. Fix journeys policy
-- ============================================
DROP POLICY IF EXISTS "Users can create journeys" ON journeys;
CREATE POLICY "Users can create journeys" ON journeys
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL AND (select auth.uid()) = created_by);

-- ============================================
-- 3. Fix journey_members policy
-- ============================================
DROP POLICY IF EXISTS "Owners can remove members or self-remove" ON journey_members;
CREATE POLICY "Owners can remove members or self-remove" ON journey_members
  FOR DELETE USING (
    user_has_journey_access(journey_id, 'owner') OR user_id = (select auth.uid())
  );
