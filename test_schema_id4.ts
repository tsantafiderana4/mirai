import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teachermada3@gmail.com',
    password: 'password123'
  });
  
  if (user) {
    const { error } = await supabase.from('notifications').insert([{
      user_id: user.id,
      type: 'system',
      title: 'Test',
      message: 'Test'
    }]);
    console.log('Insert Notification Error:', error?.message);
  } else {
    console.log('Auth error:', authError?.message);
  }
}

test();
