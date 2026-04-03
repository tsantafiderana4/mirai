import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { LearningSession, UserPreferences } from '../../types';

export const useLearningSession = (userId: string | undefined, preferences: UserPreferences | null | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['learningSession', userId, preferences?.targetLanguage],
        queryFn: async () => {
            if (!userId || !preferences?.targetLanguage) return null;
            
            const { data, error } = await supabase
                .from('learning_sessions')
                .select('*')
                .eq('user_id', userId)
                .eq('language', preferences.targetLanguage)
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
                throw error;
            }

            if (data) {
                return {
                    id: data.id,
                    userId: data.user_id,
                    messages: data.messages || [],
                    language: data.language,
                    level: data.level,
                    updatedAt: new Date(data.updated_at).getTime()
                } as LearningSession;
            }

            // Create new session if none exists
            const newSession = {
                user_id: userId,
                language: preferences.targetLanguage,
                level: preferences.level || 'A1',
                messages: [],
                updated_at: new Date().toISOString()
            };

            const { data: insertedData, error: insertError } = await supabase
                .from('learning_sessions')
                .insert([newSession])
                .select()
                .single();

            if (insertError) throw insertError;

            return {
                id: insertedData.id,
                userId: insertedData.user_id,
                messages: insertedData.messages || [],
                language: insertedData.language,
                level: insertedData.level,
                updatedAt: new Date(insertedData.updated_at).getTime()
            } as LearningSession;
        },
        enabled: !!userId && !!preferences?.targetLanguage,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const updateMutation = useMutation({
        mutationFn: async (session: LearningSession) => {
            const payload = {
                user_id: session.userId,
                language: session.language,
                level: session.level,
                messages: session.messages,
                updated_at: new Date().toISOString()
            };
            const { error } = await supabase
                .from('learning_sessions')
                .upsert(payload)
                .eq('id', session.id);

            if (error) throw error;
            return session;
        },
        onMutate: async (newSession) => {
            await queryClient.cancelQueries({ queryKey: ['learningSession', userId, preferences?.targetLanguage] });
            const previousSession = queryClient.getQueryData(['learningSession', userId, preferences?.targetLanguage]);
            
            queryClient.setQueryData(['learningSession', userId, preferences?.targetLanguage], newSession);

            return { previousSession };
        },
        onError: (err, newSession, context) => {
            if (context?.previousSession) {
                queryClient.setQueryData(['learningSession', userId, preferences?.targetLanguage], context.previousSession);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['learningSession', userId, preferences?.targetLanguage] });
        }
    });

    const clearMutation = useMutation({
        mutationFn: async () => {
            if (!userId || !preferences?.targetLanguage) return;
            const { error } = await supabase
                .from('learning_sessions')
                .delete()
                .eq('user_id', userId)
                .eq('language', preferences.targetLanguage);
            
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['learningSession', userId, preferences?.targetLanguage] });
        }
    });

    return {
        session: query.data,
        isLoading: query.isLoading,
        error: query.error,
        updateSession: updateMutation.mutateAsync,
        clearSession: clearMutation.mutateAsync,
        refetch: query.refetch
    };
};
