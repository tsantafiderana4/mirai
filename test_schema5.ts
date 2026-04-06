import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  // We can query the information_schema if we have permission, or just do a select and look at the error if we select a non-existent column
  const { data, error } = await supabase.from('learning_sessions').select('id').limit(1);
  console.log('Select ID Error:', error);
}

test();
