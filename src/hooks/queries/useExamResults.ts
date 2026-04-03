import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ExamResult } from '../../types';

export const useExamResults = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['examResults', userId],
        queryFn: async () => {
            if (!userId) return [];
            const { data, error } = await supabase
                .from('exam_results')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data.map((e: any) => ({
                id: e.id,
                userId: e.user_id,
                language: e.language,
                level: e.level,
                score: e.score,
                totalQuestions: e.total_questions,
                passed: e.score >= (e.total_questions / 2),
                date: new Date(e.created_at).getTime(),
                details: e.details
            })) as ExamResult[];
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 10, // 10 minutes
    });

    const insertMutation = useMutation({
        mutationFn: async (examResult: Omit<ExamResult, 'id'>) => {
            const payload = {
                user_id: examResult.userId,
                score: examResult.score,
                total_questions: examResult.totalQuestions,
                language: examResult.language,
                level: examResult.level,
                details: examResult.details,
                created_at: examResult.date || new Date().toISOString()
            };
            const { data, error } = await supabase
                .from('exam_results')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;
            return {
                id: data.id,
                userId: data.user_id,
                language: data.language,
                level: data.level,
                score: data.score,
                totalQuestions: data.total_questions,
                passed: data.score >= (data.total_questions / 2),
                date: new Date(data.created_at).getTime(),
                details: data.details
            } as ExamResult;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['examResults', userId] });
        }
    });

    return {
        examResults: query.data || [],
        isLoading: query.isLoading,
        error: query.error,
        addExamResult: insertMutation.mutateAsync
    };
};
