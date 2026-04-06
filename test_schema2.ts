import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.rpc('get_schema_info'); // this might not exist
  // Let's just try to insert a valid row and see the error
  const { data: insertData, error: insertError } = await supabase.from('learning_sessions').insert([{
    user_id: '11111111-1111-1111-1111-111111111111',
    language: 'English',
    level: 'A1',
    type: 'lesson',
    messages: [],
    updated_at: new Date().toISOString()
  }]).select();
  console.log('Insert Error:', insertError);
}

test();
