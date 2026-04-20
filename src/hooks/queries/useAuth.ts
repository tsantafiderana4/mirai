import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { UserProfile } from '../../types';

const formatLoginEmail = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return trimmed;
    const cleanId = trimmed.replace(/[^a-zA-Z0-9.\-_+]/g, '');
    return `${cleanId}@gmail.com`;
};

const createDefaultProfilePayload = (id: string, username: string, email: string, phoneNumber?: string) => ({
    id,
    username,
    email,
    phone_number: phoneNumber,
    role: 'user',
    credits: 10,
    preferences: {
        targetLanguage: 'en',
        level: 'beginner',
        interests: [],
        dailyGoal: 15,
        theme: 'light'
    },
    is_suspended: false
});

export const useAuth = () => {
    const queryClient = useQueryClient();

    const loginMutation = useMutation({
        mutationFn: async ({ id, pass }: { id: string, pass: string }) => {
            let email = id.trim();
            let usernameFallback = id.trim();

            if (!email.includes('@')) {
                const { data, error } = await supabase.rpc('resolve_login', { p_identifier: email });
                
                if (error) {
                    console.error("Erreur lors de la résolution (RPC):", error);
                }

                if (data && typeof data === 'string') {
                    email = data;
                    console.log("Pseudo résolu en email (RPC):", email);
                } else {
                    email = formatLoginEmail(id);
                    console.log("Pseudo non trouvé (RPC), utilisation de l'email formaté:", email);
                }
            } else {
                usernameFallback = email.split('@')[0];
            }
            
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: email, 
                password: pass
            });

            if (authError) throw new Error("Identifiants incorrects.");
            if (!authData || !authData.user) throw new Error("Erreur de connexion.");

            let { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (profileError || !profileData) {
                // Auto-create profile if it doesn't exist
                const payload = createDefaultProfilePayload(authData.user.id, authData.user.user_metadata?.username || usernameFallback, authData.user.email || email);
                const { data: newProfile, error: insertError } = await supabase
                    .from('profiles')
                    .insert([payload])
                    .select()
                    .single();
                
                if (insertError) throw new Error("Erreur lors de la création du profil.");
                profileData = newProfile;
            }

            if (profileData.is_suspended) {
                await supabase.auth.signOut();
                throw new Error("Ce compte a été suspendu.");
            }

            return {
                id: profileData.id,
                username: profileData.username || "Utilisateur",
                email: profileData.email,
                role: profileData.role || 'user',
                credits: profileData.credits ?? 0,
                preferences: profileData.preferences,
                createdAt: new Date(profileData.created_at).getTime(),
                updatedAt: new Date(profileData.updated_at).getTime(),
                isSuspended: profileData.is_suspended
            } as UserProfile;
        },
        onSuccess: (user) => {
            queryClient.setQueryData(['userProfile', user.id], user);
        }
    });

    const registerMutation = useMutation({
        mutationFn: async ({ id, pass, email, phoneNumber }: { id: string, pass: string, email?: string, phoneNumber?: string }) => {
            const finalEmail = email ? email.trim() : formatLoginEmail(id);
            const username = id.trim();
            
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: finalEmail,
                password: pass,
                options: {
                    data: {
                        username: username
                    }
                }
            });

            if (authError) throw new Error(authError.message);
            if (!authData || !authData.user) throw new Error("Erreur lors de l'inscription.");

            // Wait a bit for the trigger to execute (if it exists)
            await new Promise(resolve => setTimeout(resolve, 500));

            let { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (profileError || !profileData) {
                // Auto-create profile if it doesn't exist
                const payload = createDefaultProfilePayload(authData.user.id, username, finalEmail, phoneNumber);
                const { data: newProfile, error: insertError } = await supabase
                    .from('profiles')
                    .insert([payload])
                    .select()
                    .single();
                
                if (insertError) throw new Error("Erreur lors de la création du profil.");
                profileData = newProfile;
            }

            return {
                id: profileData.id,
                username: profileData.username || "Utilisateur",
                email: profileData.email,
                role: profileData.role || 'user',
                credits: profileData.credits ?? 0,
                preferences: profileData.preferences,
                createdAt: new Date(profileData.created_at).getTime(),
                updatedAt: new Date(profileData.updated_at).getTime(),
                isSuspended: profileData.is_suspended
            } as UserProfile;
        },
        onSuccess: (user) => {
            queryClient.setQueryData(['userProfile', user.id], user);
        }
    });

    const logoutMutation = useMutation({
        mutationFn: async () => {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.clear();
        }
    });

    const resetPasswordMutation = useMutation({
        mutationFn: async (identifier: string) => {
            let email = identifier.trim();

            if (!email.includes('@')) {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('email')
                    .eq('username', email)
                    .single();
                
                if (error || !data || !data.email) {
                    throw new Error("Utilisateur introuvable.");
                }
                email = data.email;
            }

            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin,
            });
            if (error) throw new Error(error.message);
        }
    });

    return {
        login: loginMutation.mutateAsync,
        isLoggingIn: loginMutation.isPending,
        register: registerMutation.mutateAsync,
        isRegistering: registerMutation.isPending,
        logout: logoutMutation.mutateAsync,
        isLoggingOut: logoutMutation.isPending,
        resetPassword: resetPasswordMutation.mutateAsync,
        isResettingPassword: resetPasswordMutation.isPending
    };
};
