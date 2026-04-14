import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Certificate } from '../../types';

export const useCertificates = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['certificates', userId],
        queryFn: async () => {
            if (!userId) return [];
            const { data, error } = await supabase
                .from('certificates')
                .select('*')
                .eq('user_id', userId)
                .order('issue_date', { ascending: false });

            if (error) throw error;
            return data.map((c: any) => ({
                id: c.id,
                userId: c.user_id,
                examId: c.exam_id,
                language: c.language,
                level: c.level,
                issueDate: new Date(c.issue_date).getTime(),
                certificateUrl: c.certificate_url,
                globalScore: c.score,
                skillScores: c.skill_scores,
                status: c.status || 'bloqué'
            })) as Certificate[];
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 10, // 10 minutes
    });

    const insertMutation = useMutation({
        mutationFn: async (certificate: Omit<Certificate, 'id'>) => {
            const payload = {
                id: crypto.randomUUID(),
                user_id: certificate.userId,
                exam_id: certificate.examId,
                language: certificate.language,
                level: certificate.level,
                issue_date: certificate.issueDate || new Date().toISOString(),
                certificate_url: certificate.certificateUrl
            };
            const { data, error } = await supabase
                .from('certificates')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;
            return {
                id: data.id,
                userId: data.user_id,
                examId: data.exam_id,
                language: data.language,
                level: data.level,
                issueDate: data.issue_date,
                certificateUrl: data.certificate_url
            } as Certificate;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates', userId] });
        }
    });

    const unlockMutation = useMutation({
        mutationFn: async (examId: string) => {
            // This is a placeholder as the actual unlocking logic is in SmartExamService
            // We just need to invalidate the query after the service call
            return;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates', userId] });
        }
    });

    return {
        certificates: query.data || [],
        isLoading: query.isLoading,
        error: query.error,
        addCertificate: insertMutation.mutateAsync,
        unlockCertificate: unlockMutation.mutateAsync
    };
};
