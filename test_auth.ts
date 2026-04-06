import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  // Sign in first
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teachermada3@gmail.com',
    password: 'password123' // I don't know the password, so this will fail.
  });
  console.log('Auth:', authError);
}

test();
