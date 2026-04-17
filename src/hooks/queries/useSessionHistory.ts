import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { LearningSession } from '../../types';

export const useSessionHistory = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['sessionHistory', userId],
        queryFn: async () => {
            if (!userId) return [];
            
            const { data, error } = await supabase
                .from('learning_sessions')
                .select('*')
                .eq('user_id', userId)
                .order('updated_at', { ascending: false });

            if (error) {
                throw error;
            }

            return (data || []).map(row => ({
                id: row.id,
                userId: row.user_id,
                messages: row.messages || [],
                language: row.language,
                level: row.level,
                type: row.type,
                updatedAt: new Date(row.updated_at).getTime()
            })) as LearningSession[];
        },
        enabled: !!userId
    });

    const deleteSession = useMutation({
        mutationFn: async (sessionId: string) => {
            if (!userId) throw new Error("Non authentifié");
            const { error } = await supabase
                .from('learning_sessions')
                .delete()
                .eq('id', sessionId)
                .eq('user_id', userId);
            
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sessionHistory', userId] });
        }
    });

    const deleteAllSessions = useMutation({
        mutationFn: async () => {
            if (!userId) throw new Error("Non authentifié");
            const { error } = await supabase
                .from('learning_sessions')
                .delete()
                .eq('user_id', userId);
            
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sessionHistory', userId] });
        }
    });

    return { ...query, deleteSession: deleteSession.mutateAsync, deleteAllSessions: deleteAllSessions.mutateAsync };
};
