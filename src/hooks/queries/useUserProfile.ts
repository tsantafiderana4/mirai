import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { UserProfile, UserPreferences } from '../../types';
import { useEffect } from 'react';

const mapProfile = (data: any): UserProfile => ({
    id: data.id,
    username: data.username || "Utilisateur",
    email: data.email,
    role: data.role || 'user',
    credits: data.credits ?? 0,
    preferences: data.preferences,
    createdAt: new Date(data.created_at).getTime(),
    updatedAt: new Date(data.updated_at).getTime(),
    isSuspended: data.is_suspended
});

export const useUserProfile = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['userProfile', userId],
        queryFn: async () => {
            if (!userId) return null;
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;
            return mapProfile(data);
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    useEffect(() => {
        if (!userId) return;

        const channel = supabase
            .channel(`public:profiles:id=eq.${userId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${userId}`,
                },
                (payload) => {
                    queryClient.setQueryData(['userProfile', userId], (oldData: any) => {
                        if (!oldData) return oldData;
                        return {
                            ...oldData,
                            ...mapProfile(payload.new)
                        };
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userId, queryClient]);

    const updateMutation = useMutation({
        mutationFn: async (updatedProfile: Partial<UserProfile> & { id: string }) => {
            const payload = {
                username: updatedProfile.username,
                preferences: updatedProfile.preferences,
                updated_at: new Date().toISOString()
            };
            const { error } = await supabase
                .from('profiles')
                .update(payload)
                .eq('id', updatedProfile.id);

            if (error) throw error;
            return updatedProfile;
        },
        onMutate: async (updatedProfile) => {
            await queryClient.cancelQueries({ queryKey: ['userProfile', updatedProfile.id] });
            const previousProfile = queryClient.getQueryData(['userProfile', updatedProfile.id]);
            
            queryClient.setQueryData(['userProfile', updatedProfile.id], (old: any) => ({
                ...old,
                ...updatedProfile
            }));

            return { previousProfile };
        },
        onError: (err, newProfile, context) => {
            if (context?.previousProfile) {
                queryClient.setQueryData(['userProfile', newProfile.id], context.previousProfile);
            }
        },
        onSettled: (data, error, variables) => {
            queryClient.invalidateQueries({ queryKey: ['userProfile', variables.id] });
        }
    });

    return {
        profile: query.data,
        isLoading: query.isLoading,
        error: query.error,
        updateProfile: updateMutation.mutateAsync,
        isUpdating: updateMutation.isPending,
        refetch: query.refetch
    };
};
