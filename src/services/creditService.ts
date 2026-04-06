import { supabase } from "../lib/supabase";

export const CREDIT_COSTS = {
  LESSON: 2,
  AUDIO_MESSAGE: 2,
  AUDIO_PRONUNCIATION: 1,
  DIALOGUE_MESSAGE: 1,
  EXERCISE: 5,
  VOICE_CALL_PER_MINUTE: 5,
  DIAGNOSTIC: 40,
  EXAM: 100,
  CERTIFICATE: 100,
};

export async function deductCredits(amount: number, userId: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('consume_credits', { p_user_id: userId, p_amount: amount });
    if (error) {
        console.error("RPC consume_credits failed:", error);
        return null;
    }
    
    // Fetch new balance
    const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
    return profile?.credits || 0;
}
