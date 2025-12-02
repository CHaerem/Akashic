-- Security Fix: Drop user_usage_stats view
--
-- This view has two security vulnerabilities:
-- 1. auth_users_exposed: Exposes auth.users data to anon/authenticated roles
-- 2. security_definer_view: Uses SECURITY DEFINER which bypasses RLS
--
-- The view was created directly in the database and is not used by the application.
-- Dropping it resolves both security issues.

DROP VIEW IF EXISTS public.user_usage_stats;
