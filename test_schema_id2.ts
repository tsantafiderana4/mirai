import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const tables = ['certificates', 'exam_results', 'notifications', 'admin_requests', 'profiles'];
  for (const table of tables) {
    const { error } = await supabase.from(table).insert([{}]).select();
    console.log(`Insert Error for ${table}:`, error?.message);
  }
}

test();
