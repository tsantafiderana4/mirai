import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const useAppStats = () => {
    return useQuery({
        queryKey: ['appStats'],
        queryFn: async () => {
            const { count, error } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true });
            
            if (error) throw error;
            return {
                students: (count || 0) + 250, // Base students + real count
                visitors: 14203 + Math.floor(Math.random() * 100),
                lessons: 3900 + Math.floor(Math.random() * 50)
            };
        },
        staleTime: 1000 * 60 * 60, // 1 hour
    });
};
