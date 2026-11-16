import { supabase } from "../lib/supabase";

// Tarifs AFFICHÉS dans l'interface. La facturation réelle de l'IA est faite
// par le serveur (supabase/functions/gemini-api/pricing.ts) : garder les deux
// alignés. Seul CERTIFICATE_UNLOCK est encore débité depuis le client.
export const CREDIT_COSTS = {
  LESSON: 2,
  AUDIO_MESSAGE: 2,
  AUDIO_PRONUNCIATION: 1,
  DIALOGUE_MESSAGE: 1,
  EXERCISE: 5,
  VOICE_CALL_PER_MINUTE: 5,
  VOICE_CALL: 10,
  DIAGNOSTIC: 40,
  EXAM: 100,
  CERTIFICATE: 100,
  CERTIFICATE_UNLOCK: 100,
};

export async function deductCredits(amount: number, userId: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('consume_credits', { p_amount: amount });
    if (error) {
        console.error("RPC consume_credits failed:", error);
        return null;
    }
    
    // data is the new balance returned by the RPC
    if (typeof data === 'number') {
        return data;
    }
    
    // Fallback if data is not a number (should not happen with new RPC)
    const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
    return profile?.credits || 0;
}
