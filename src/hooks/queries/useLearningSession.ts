import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { LearningSession, UserPreferences } from '../../types';

export const useLearningSession = (
    userId: string | undefined, 
    preferences: UserPreferences | null | undefined,
    sessionType: 'lesson' | 'exercise' | 'dialogue' | 'exam' | 'call' = 'lesson',
    specificLevel?: string
) => {
    const queryClient = useQueryClient();
    
    const targetLanguage = preferences?.targetLanguage;
    const level = specificLevel || preferences?.level || 'A1';

    const queryKey = ['learningSession', userId, targetLanguage, level, sessionType];

    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!userId || !targetLanguage) {
                return null;
            }
            
            const { data, error } = await supabase
                .from('learning_sessions')
                .select('*')
                .eq('user_id', userId)
                .eq('language', targetLanguage)
                .eq('level', level)
                .eq('type', sessionType)
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
                    type: data.type || sessionType,
                    updatedAt: new Date(data.updated_at).getTime()
                } as LearningSession;
            }

            // Create new session if none exists for this specific context
            const newSession = {
                id: crypto.randomUUID(),
                user_id: userId,
                language: targetLanguage,
                level: level,
                type: sessionType,
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
                type: insertedData.type,
                updatedAt: new Date(insertedData.updated_at).getTime()
            } as LearningSession;
        },
        enabled: !!userId && !!targetLanguage,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const updateMutation = useMutation({
        mutationFn: async (session: LearningSession) => {
            const payload = {
                id: session.id,
                user_id: session.userId,
                language: session.language,
                level: session.level,
                type: session.type,
                messages: session.messages,
                updated_at: new Date().toISOString()
            };
            const { error } = await supabase
                .from('learning_sessions')
                .upsert(payload);

            if (error) throw error;
            return session;
        },
        onMutate: async (newSession) => {
            await queryClient.cancelQueries({ queryKey });
            const previousSession = queryClient.getQueryData(queryKey);
            
            queryClient.setQueryData(queryKey, newSession);

            return { previousSession };
        },
        onError: (err, newSession, context) => {
            if (context?.previousSession) {
                queryClient.setQueryData(queryKey, context.previousSession);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
        }
    });

    const clearMutation = useMutation({
        mutationFn: async () => {
            if (!userId || !targetLanguage) return;
            const { error } = await supabase
                .from('learning_sessions')
                .delete()
                .eq('user_id', userId)
                .eq('language', targetLanguage)
                .eq('level', level)
                .eq('type', sessionType);
            
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
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
