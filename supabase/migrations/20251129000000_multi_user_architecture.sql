-- Multi-User Architecture Migration
-- Adds support for multiple owners/editors/viewers per journey

-- ============================================
-- 1. Create profiles table (for user dropdown)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view profiles (needed for invite dropdown)
CREATE POLICY "Authenticated users can view profiles" ON profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Auto-populate profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Populate profiles for existing users
INSERT INTO profiles (id, email, display_name)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. Create journey_members table
-- ============================================
CREATE TABLE journey_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(journey_id, user_id)
);

ALTER TABLE journey_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_journey_members_journey_id ON journey_members(journey_id);
CREATE INDEX idx_journey_members_user_id ON journey_members(user_id);

-- ============================================
-- 3. Modify journeys table
-- ============================================
-- Rename user_id to created_by (keep for audit trail)
ALTER TABLE journeys RENAME COLUMN user_id TO created_by;

-- ============================================
-- 4. Modify photos table
-- ============================================
-- Add uploader attribution
ALTER TABLE photos ADD COLUMN uploaded_by UUID REFERENCES auth.users(id);

-- Set uploaded_by for existing photos to the journey creator
UPDATE photos
SET uploaded_by = journeys.created_by
FROM journeys
WHERE photos.journey_id = journeys.id;

-- ============================================
-- 5. Helper function for membership check
-- ============================================
CREATE OR REPLACE FUNCTION user_has_journey_access(
  _journey_id UUID,
  _required_role TEXT DEFAULT 'viewer'
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM journey_members
    WHERE journey_id = _journey_id
    AND user_id = auth.uid()
    AND (
      CASE _required_role
        WHEN 'viewer' THEN role IN ('owner', 'editor', 'viewer')
        WHEN 'editor' THEN role IN ('owner', 'editor')
        WHEN 'owner' THEN role = 'owner'
        ELSE false
      END
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. Migrate existing journeys to journey_members
-- ============================================
-- Create owner membership for each existing journey
INSERT INTO journey_members (journey_id, user_id, role, invited_by)
SELECT id, created_by, 'owner', created_by
FROM journeys
WHERE created_by IS NOT NULL
ON CONFLICT (journey_id, user_id) DO NOTHING;

-- ============================================
-- 7. Drop old RLS policies
-- ============================================
DROP POLICY IF EXISTS "Public journeys readable by all" ON journeys;
DROP POLICY IF EXISTS "Users can manage own journeys" ON journeys;
DROP POLICY IF EXISTS "Waypoints follow journey permissions" ON waypoints;
DROP POLICY IF EXISTS "Users can manage own waypoints" ON waypoints;
DROP POLICY IF EXISTS "Photos follow journey permissions" ON photos;
DROP POLICY IF EXISTS "Users can manage own photos" ON photos;

-- ============================================
-- 8. Create new RLS policies for journeys
-- ============================================
-- Read: user is a member (any role) OR journey is public
CREATE POLICY "Members can view journeys" ON journeys
  FOR SELECT USING (
    user_has_journey_access(id, 'viewer') OR is_public = true
  );

-- Update: user is owner or editor
CREATE POLICY "Editors can update journeys" ON journeys
  FOR UPDATE USING (user_has_journey_access(id, 'editor'));

-- Delete: user is owner only
CREATE POLICY "Owners can delete journeys" ON journeys
  FOR DELETE USING (user_has_journey_access(id, 'owner'));

-- Insert: any authenticated user can create
CREATE POLICY "Users can create journeys" ON journeys
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = created_by);

-- ============================================
-- 9. Create new RLS policies for waypoints
-- ============================================
CREATE POLICY "Members can view waypoints" ON waypoints
  FOR SELECT USING (user_has_journey_access(journey_id, 'viewer'));

CREATE POLICY "Editors can insert waypoints" ON waypoints
  FOR INSERT WITH CHECK (user_has_journey_access(journey_id, 'editor'));

CREATE POLICY "Editors can update waypoints" ON waypoints
  FOR UPDATE USING (user_has_journey_access(journey_id, 'editor'));

CREATE POLICY "Editors can delete waypoints" ON waypoints
  FOR DELETE USING (user_has_journey_access(journey_id, 'editor'));

-- ============================================
-- 10. Create new RLS policies for photos
-- ============================================
CREATE POLICY "Members can view photos" ON photos
  FOR SELECT USING (user_has_journey_access(journey_id, 'viewer'));

CREATE POLICY "Editors can insert photos" ON photos
  FOR INSERT WITH CHECK (user_has_journey_access(journey_id, 'editor'));

CREATE POLICY "Editors can update photos" ON photos
  FOR UPDATE USING (user_has_journey_access(journey_id, 'editor'));

CREATE POLICY "Editors can delete photos" ON photos
  FOR DELETE USING (user_has_journey_access(journey_id, 'editor'));

-- ============================================
-- 11. Create RLS policies for journey_members
-- ============================================
-- View members: any member can see who else is in the journey
CREATE POLICY "Members can view journey members" ON journey_members
  FOR SELECT USING (user_has_journey_access(journey_id, 'viewer'));

-- Insert members: only owners can add
CREATE POLICY "Owners can add members" ON journey_members
  FOR INSERT WITH CHECK (user_has_journey_access(journey_id, 'owner'));

-- Update members: only owners can change roles
CREATE POLICY "Owners can update members" ON journey_members
  FOR UPDATE USING (user_has_journey_access(journey_id, 'owner'));

-- Delete members: owners can remove, or user can remove self
CREATE POLICY "Owners can remove members or self-remove" ON journey_members
  FOR DELETE USING (
    user_has_journey_access(journey_id, 'owner') OR user_id = auth.uid()
  );

-- ============================================
-- 12. Trigger: Auto-add creator as owner
-- ============================================
CREATE OR REPLACE FUNCTION add_journey_creator_as_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO journey_members (journey_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.created_by, 'owner', NEW.created_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_journey_created
  AFTER INSERT ON journeys
  FOR EACH ROW EXECUTE FUNCTION add_journey_creator_as_owner();

-- ============================================
-- 13. Trigger: Prevent removing last owner
-- ============================================
CREATE OR REPLACE FUNCTION prevent_last_owner_removal()
RETURNS TRIGGER AS $$
DECLARE
  owner_count INTEGER;
BEGIN
  -- Check if we're removing/demoting an owner
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner') OR
     (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner') THEN

    SELECT COUNT(*) INTO owner_count
    FROM journey_members
    WHERE journey_id = OLD.journey_id AND role = 'owner' AND id != OLD.id;

    IF owner_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last owner. Transfer ownership first.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_last_owner
  BEFORE DELETE OR UPDATE ON journey_members
  FOR EACH ROW EXECUTE FUNCTION prevent_last_owner_removal();

-- ============================================
-- 14. Update index for renamed column
-- ============================================
DROP INDEX IF EXISTS idx_journeys_user_id;
CREATE INDEX idx_journeys_created_by ON journeys(created_by);
