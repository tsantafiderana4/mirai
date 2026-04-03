// Ce fichier ne contient plus que les constantes de coûts.
// La logique de déduction est désormais gérée côté serveur via les Edge Functions.

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
