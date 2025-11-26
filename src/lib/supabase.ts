import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === 'true';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase credentials not configured - auth disabled');
}

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

// Auth is disabled in e2e test mode to allow automated testing
export const isAuthEnabled = !!supabase && !isE2ETestMode;
