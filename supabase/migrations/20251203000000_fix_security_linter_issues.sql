-- Fix Supabase Security Linter Issues
-- Addresses: auth_users_exposed, security_definer_view, function_search_path_mutable

-- ============================================
-- 1. Drop problematic view (exposes auth.users)
-- ============================================
DROP VIEW IF EXISTS public.user_usage_stats;

-- ============================================
-- 2. Drop unused check_*_limit triggers and functions
-- ============================================
DROP TRIGGER IF EXISTS enforce_journey_limit ON journeys;
DROP TRIGGER IF EXISTS enforce_photo_limit ON photos;
DROP TRIGGER IF EXISTS enforce_waypoint_limit ON waypoints;

DROP FUNCTION IF EXISTS public.check_journey_limit();
DROP FUNCTION IF EXISTS public.check_photo_limit();
DROP FUNCTION IF EXISTS public.check_waypoint_limit();

-- ============================================
-- 3. Recreate functions with immutable search_path
-- ============================================

-- 3a. handle_new_user - auto-populate profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

-- 3b. user_has_journey_access - check membership/role
CREATE OR REPLACE FUNCTION public.user_has_journey_access(
  _journey_id UUID,
  _required_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.journey_members
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
$$;

-- 3c. add_journey_creator_as_owner - trigger function
CREATE OR REPLACE FUNCTION public.add_journey_creator_as_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.journey_members (journey_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.created_by, 'owner', NEW.created_by);
  RETURN NEW;
END;
$$;

-- 3d. prevent_last_owner_removal - trigger function
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  owner_count INTEGER;
BEGIN
  -- Check if we're removing/demoting an owner
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner') OR
     (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner') THEN

    SELECT COUNT(*) INTO owner_count
    FROM public.journey_members
    WHERE journey_id = OLD.journey_id AND role = 'owner' AND id != OLD.id;

    IF owner_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last owner. Transfer ownership first.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
