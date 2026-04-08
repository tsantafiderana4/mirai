import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    const { data, error } = await supabase.from('admin_requests').select('id, user_id, username, type, amount, message, status').limit(1);
    console.log("Data:", data);
    console.log("Error:", error);
}

checkSchema();
