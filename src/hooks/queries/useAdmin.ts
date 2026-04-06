import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { UserProfile, SystemSettings, AdminRequest } from '../../types';

export const useAdmin = () => {
    const queryClient = useQueryClient();

    const usersQuery = useQuery({
        queryKey: ['admin', 'users'],
        queryFn: async () => {
            const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            return data.map((p: any) => ({
                id: p.id,
                username: p.username,
                role: p.role,
                createdAt: new Date(p.created_at).getTime(),
                updatedAt: new Date(p.updated_at).getTime(),
                credits: p.credits,
                isSuspended: p.is_suspended,
                preferences: p.preferences
            })) as UserProfile[];
        }
    });

    const requestsQuery = useQuery({
        queryKey: ['admin', 'requests'],
        queryFn: async () => {
            const { data, error } = await supabase.from('admin_requests').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            return data.map((r: any) => ({
                id: r.id,
                userId: r.user_id,
                username: r.username,
                type: r.type,
                amount: r.amount,
                transactionRef: r.transaction_ref,
                status: r.status,
                createdAt: new Date(r.created_at).getTime()
            })) as AdminRequest[];
        }
    });

    const settingsQuery = useQuery({
        queryKey: ['admin', 'settings'],
        queryFn: async () => {
            const { data, error } = await supabase.from('system_settings').select('*').single();
            if (error && error.code !== 'PGRST116') throw error;
            return (data && data.settings) ? data.settings as SystemSettings : {
                creditPrice: 10,
                validTransactionRefs: [],
                adminContact: { telma: '', airtel: '', orange: '' },
                updatedAt: Date.now()
            };
        }
    });

    const updateSettings = useMutation({
        mutationFn: async (newSettings: SystemSettings) => {
            const { error } = await supabase.from('system_settings').upsert({ id: 1, settings: newSettings });
            if (error) throw error;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
    });

    const updateUser = useMutation({
        mutationFn: async (user: UserProfile) => {
            const { error } = await supabase.from('profiles').update({
                is_suspended: user.isSuspended,
                credits: user.credits
            }).eq('id', user.id);
            if (error) throw error;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    });

    const resolveRequest = useMutation({
        mutationFn: async ({ reqId, status }: { reqId: string, status: 'approved' | 'rejected' }) => {
            const { error } = await supabase.from('admin_requests').update({ status }).eq('id', reqId);
            if (error) throw error;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'requests'] })
    });

    return {
        users: usersQuery.data || [],
        requests: requestsQuery.data || [],
        settings: settingsQuery.data,
        isLoading: usersQuery.isLoading || requestsQuery.isLoading || settingsQuery.isLoading,
        updateSettings: updateSettings.mutateAsync,
        updateUser: updateUser.mutateAsync,
        resolveRequest: resolveRequest.mutateAsync,
        refetchAll: () => {
            usersQuery.refetch();
            requestsQuery.refetch();
            settingsQuery.refetch();
        }
    };
};
