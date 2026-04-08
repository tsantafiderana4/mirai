import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { UserProfile, SystemSettings, AdminRequest } from '../../types';
import { useEffect } from 'react';

export const useAdmin = () => {
    const queryClient = useQueryClient();

    const cleanupOldRequests = async () => {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        await supabase.from('admin_requests').delete().lt('created_at', oneWeekAgo.toISOString());
    };

    useEffect(() => {
        cleanupOldRequests();
    }, []);

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
                message: r.message,
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
            
            if (data) {
                // Extract apiKeys from admin_contact if it exists there
                const adminContactData = data.admin_contact || {};
                const apiKeys = adminContactData.apiKeys || {};
                
                // Clean up adminContact to not include apiKeys in the UI if we want to separate them
                const cleanAdminContact = {
                    telma: adminContactData.telma || '',
                    airtel: adminContactData.airtel || '',
                    orange: adminContactData.orange || ''
                };

                return {
                    creditPrice: data.credit_price || 10,
                    validTransactionRefs: data.valid_coupons || [],
                    adminContact: cleanAdminContact,
                    apiKeys: apiKeys,
                    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : Date.now()
                } as SystemSettings;
            }

            return {
                creditPrice: 10,
                validTransactionRefs: [],
                adminContact: { telma: '', airtel: '', orange: '' },
                apiKeys: {},
                updatedAt: Date.now()
            } as SystemSettings;
        }
    });

    const updateSettings = useMutation({
        mutationFn: async (newSettings: SystemSettings) => {
            // Merge apiKeys into admin_contact for storage
            const adminContactWithKeys = {
                ...newSettings.adminContact,
                apiKeys: newSettings.apiKeys || {}
            };

            const { error } = await supabase.from('system_settings').upsert({ 
                id: 1, 
                credit_price: newSettings.creditPrice,
                valid_coupons: newSettings.validTransactionRefs,
                admin_contact: adminContactWithKeys,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
    });

    const addCredits = useMutation({
        mutationFn: async ({ userId, amount }: { userId: string, amount: number }) => {
            const { error } = await supabase.rpc('admin_add_credits', { p_user_id: userId, p_amount: amount });
            if (error) throw error;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
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

    const updateUserAuth = useMutation({
        mutationFn: async ({ userId, email, password }: { userId: string, email?: string, password?: string }) => {
            const { error } = await supabase.rpc('admin_update_user_auth', {
                p_user_id: userId,
                p_email: email || null,
                p_password: password || null
            });
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
        updateUserAuth: updateUserAuth.mutateAsync,
        addCredits: addCredits.mutateAsync,
        resolveRequest: resolveRequest.mutateAsync,
        refetchAll: () => {
            usersQuery.refetch();
            requestsQuery.refetch();
            settingsQuery.refetch();
        }
    };
};
