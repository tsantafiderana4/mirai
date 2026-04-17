import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
  const tables = ['temp_profiles', 'temp_users', 'temp_identities'];
  for (const table of tables) {
    console.log(`Tentative de suppression de la table : ${table}...`);
    // On utilise rpc('exec_sql') si disponible, sinon on peut essayer de deviner
    const { error } = await supabase.rpc('exec_sql', { 
      sql_query: `DROP TABLE IF EXISTS ${table} CASCADE;` 
    });
    
    if (error) {
      console.error(`Erreur pour ${table}:`, error.message);
      // Fallback : essai via une requête directe si exec_sql n'existe pas ou a un nom différent
      const { error: error2 } = await supabase.rpc('execute_sql', { 
        sql: `DROP TABLE IF EXISTS ${table} CASCADE;` 
      });
      if (error2) console.error(`Deuxième essai échoué pour ${table}:`, error2.message);
    } else {
      console.log(`Table ${table} supprimée avec succès.`);
    }
  }
}

cleanup();
