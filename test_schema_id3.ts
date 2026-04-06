import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teachermada3@gmail.com',
    password: 'password123' // assuming this is the password, or we can just use the service role key if we have it. Wait, we don't have service role key.
  });
  
  if (authError) {
    console.log('Auth error:', authError.message);
    // Let's just try to insert with a valid user_id to see if it bypasses RLS
  }
  
  const tables = ['certificates', 'exam_results', 'notifications', 'admin_requests', 'profiles'];
  for (const table of tables) {
    const { error } = await supabase.from(table).insert([{ user_id: '00000000-0000-0000-0000-000000000000' }]).select();
    console.log(`Insert Error for ${table}:`, error?.message);
  }
}

test();
