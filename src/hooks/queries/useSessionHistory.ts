import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { LearningSession } from '../../types';

export const useSessionHistory = (userId: string | undefined) => {
    return useQuery({
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
};
