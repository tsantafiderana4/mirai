import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const usePayment = () => {
    const queryClient = useQueryClient();

    const sendAdminRequest = useMutation({
        mutationFn: async ({ userId, username, type, amount, message }: {
            userId: string, username: string, type: string, amount?: number, message?: string
        }) => {
            const { error } = await supabase.from('admin_requests').insert({
                user_id: userId,
                username,
                type,
                amount,
                message,
                status: 'pending'
            });
            if (error) throw error;
        }
    });

    const validateCoupon = useMutation({
        mutationFn: async ({ userId, code }: { userId: string, code: string }) => {
            const { data, error } = await supabase.rpc('use_coupon', { p_user_id: userId, p_code: code });
            if (error) throw error;
            if (!data.success) throw new Error(data.message);
            return data.amount;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['userProfile', variables.userId] });
        }
    });

    return {
        sendAdminRequest: sendAdminRequest.mutateAsync,
        validateCoupon: validateCoupon.mutateAsync,
        isSubmittingRequest: sendAdminRequest.isPending,
        isValidatingCoupon: validateCoupon.isPending
    };
};
