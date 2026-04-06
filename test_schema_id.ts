import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('learning_sessions').insert([{
    user_id: '00000000-0000-0000-0000-000000000000',
    language: 'English',
    level: 'A1',
    type: 'lesson',
    messages: [],
    updated_at: new Date().toISOString()
  }]).select();
  console.log('Insert Error:', error);
}

test();
