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
            // 1. Get settings to check valid coupons
            const { data: settingsData, error: settingsError } = await supabase.from('system_settings').select('valid_coupons').single();
            if (settingsError) throw settingsError;
            
            const validCoupons = settingsData.valid_coupons || [];
            const couponIndex = validCoupons.findIndex((c: any) => c.code === code);
            
            if (couponIndex === -1) {
                throw new Error("Code invalide ou expiré.");
            }
            
            const coupon = validCoupons[couponIndex];
            
            // 2. Add credits to user
            const { data: userData, error: userError } = await supabase.from('profiles').select('credits').eq('id', userId).single();
            if (userError) throw userError;
            
            const { error: updateError } = await supabase.from('profiles').update({
                credits: userData.credits + coupon.amount
            }).eq('id', userId);
            
            if (updateError) throw updateError;
            
            // 3. Remove coupon
            validCoupons.splice(couponIndex, 1);
            await supabase.from('system_settings').update({
                valid_coupons: validCoupons
            }).eq('id', 1);
            
            return coupon.amount;
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
