import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { SmartNotification } from '../../types';

export const useNotifications = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['notifications', userId],
        queryFn: async () => {
            if (!userId) return [];
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            return data.map((n: any) => ({
                id: n.id,
                userId: n.user_id,
                title: n.title,
                message: n.message,
                type: n.type,
                read: n.read,
                createdAt: new Date(n.created_at).getTime(),
                data: n.data
            })) as unknown as SmartNotification[];
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 2, // 2 minutes
    });

    const markReadMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const { error } = await supabase
                .from('notifications')
                .update({ read: true })
                .eq('id', notificationId);
            if (error) throw error;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: ['notifications', userId] });
            const previousNotifs = queryClient.getQueryData(['notifications', userId]);
            
            queryClient.setQueryData(['notifications', userId], (old: any) => 
                old?.map((n: any) => n.id === notificationId ? { ...n, read: true } : n)
            );

            return { previousNotifs };
        },
        onError: (err, variables, context) => {
            if (context?.previousNotifs) {
                queryClient.setQueryData(['notifications', userId], context.previousNotifs);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        }
    });

    const markAllReadMutation = useMutation({
        mutationFn: async () => {
            if (!userId) return;
            const { error } = await supabase
                .from('notifications')
                .update({ read: true })
                .eq('user_id', userId);
            if (error) throw error;
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['notifications', userId] });
            const previousNotifs = queryClient.getQueryData(['notifications', userId]);
            
            queryClient.setQueryData(['notifications', userId], (old: any) => 
                old?.map((n: any) => ({ ...n, read: true }))
            );

            return { previousNotifs };
        },
        onError: (err, variables, context) => {
            if (context?.previousNotifs) {
                queryClient.setQueryData(['notifications', userId], context.previousNotifs);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const { error } = await supabase
                .from('notifications')
                .delete()
                .eq('id', notificationId);
            if (error) throw error;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: ['notifications', userId] });
            const previousNotifs = queryClient.getQueryData(['notifications', userId]);
            
            queryClient.setQueryData(['notifications', userId], (old: any) => 
                old?.filter((n: any) => n.id !== notificationId)
            );

            return { previousNotifs };
        },
        onError: (err, variables, context) => {
            if (context?.previousNotifs) {
                queryClient.setQueryData(['notifications', userId], context.previousNotifs);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        }
    });

    return {
        notifications: query.data || [],
        isLoading: query.isLoading,
        error: query.error,
        markRead: markReadMutation.mutateAsync,
        markAllRead: markAllReadMutation.mutateAsync,
        deleteNotification: deleteMutation.mutateAsync
    };
};
