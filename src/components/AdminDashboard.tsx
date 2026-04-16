
import React, { useState, useEffect } from 'react';
import { UserProfile, SystemSettings } from '../types';
import { Users, CreditCard, Settings, Search, Save, MessageSquare, Plus, Minus, RefreshCw, Banknote, Shield, Loader2, Trash2, CheckCircle, X, Info, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAdmin } from '../hooks/queries/useAdmin';

interface AdminDashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
  onBack: () => void;
  isDarkMode: boolean;
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout, onBack, notify }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'requests' | 'coupons' | 'settings'>('overview');
  const [search, setSearch] = useState('');
  
  const { users, requests, settings: fetchedSettings, coupons, isLoading, updateSettings, updateUser, updateUserAuth, addCredits, resolveRequest, addCoupon, removeCoupon, refetchAll } = useAdmin();
  const [localSettings, setLocalSettings] = useState<SystemSettings | undefined>(fetchedSettings);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);

  // Sync local settings when fetchedSettings changes
  useEffect(() => {
      if (fetchedSettings) {
          const timer = setTimeout(() => {
              setLocalSettings(fetchedSettings);
          }, 0);
          return () => clearTimeout(timer);
      }
  }, [fetchedSettings]);

  useEffect(() => {
      const fetchKeys = async () => {
          setIsLoadingKeys(true);
          const { data, error } = await supabase.from('api_keys').select('key_value');
          if (!error && data) {
              setApiKeys(data.map(k => k.key_value));
          }
          setIsLoadingKeys(false);
      };
      fetchKeys();
  }, []);
  
  // New State for Coupon Generation
  const [newTransactionRef, setNewTransactionRef] = useState('');
  const [couponAmount, setCouponAmount] = useState<number>(10);
  const [couponExpiresAt, setCouponExpiresAt] = useState<string>('');

  const [manualCreditInputs, setManualCreditInputs] = useState<Record<string, string>>({});
  
  // State for editing user auth
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const refreshData = async () => {
      await refetchAll();
  };

  const handleSaveUserAuth = async (userId: string) => {
      try {
          await updateUserAuth({ userId, email: editEmail, password: editPassword });
          notify("Informations de l'utilisateur mises à jour.", 'success');
          setEditingUser(null);
          setEditEmail('');
          setEditPassword('');
      } catch (_e) {
          console.error(_e);
          notify("Erreur lors de la mise à jour des informations.", 'error');
      }
  };

  const handleManualCreditChange = (userId: string, val: string) => {
      setManualCreditInputs(prev => ({ ...prev, [userId]: val }));
  };

  const executeManualCredit = async (userId: string, multiplier: number) => {
      const val = parseInt(manualCreditInputs[userId] || '0');
      if (!isNaN(val) && val !== 0) {
          const finalAmt = val * multiplier;
          const user = users.find(u => u.id === userId);
          if (user) {
              try {
                  await addCredits({ userId, amount: finalAmt });
                  setManualCreditInputs(prev => ({ ...prev, [userId]: '' })); 
                  notify(`Crédits modifiés: ${finalAmt > 0 ? '+' : ''}${finalAmt}`, 'success');
              } catch (_e) {
                  console.error(_e);
                  notify("Échec de la mise à jour des crédits.", 'error');
              }
          }
      }
  };

  const toggleSuspend = async (user: UserProfile) => {
      try {
          await updateUser({ ...user, isSuspended: !user.isSuspended });
          notify(`Utilisateur ${!user.isSuspended ? 'suspendu' : 'réactivé'}.`, 'info');
      } catch (_e) {
          console.error(_e);
          notify(`Échec de la suspension.`, 'error');
      }
  };

  const handleResolveRequest = async (reqId: string, status: 'approved' | 'rejected') => {
      try {
          const req = requests?.find(r => r.id === reqId);
          await resolveRequest({ reqId, status });
          
          if (status === 'approved' && req && req.type === 'credit' && req.amount) {
              await addCredits({ userId: req.userId, amount: req.amount });
          }
          
          notify(`Demande ${status === 'approved' ? 'approuvée' : 'rejetée'}.`, 'success');
      } catch (_e) {
          console.error(_e);
          notify("Erreur lors de la résolution.", 'error');
      }
  };

  const saveSettings = async () => {
      if (!localSettings) return;
      try {
          await updateSettings(localSettings);
          notify("Paramètres sauvegardés dans le Cloud.", 'success');
      } catch (_e) {
          console.error(_e);
          notify("Erreur lors de la sauvegarde. Vérifiez les permissions DB.", 'error');
      }
  };

  // --- COUPON MANAGEMENT ---
  const handleAddCoupon = async () => {
      // 1. Sanitize Input
      const rawCode = newTransactionRef.trim();
      
      if (rawCode.startsWith('{') || rawCode.includes('"') || rawCode.length > 30) {
          notify("Format invalide. Entrez un code simple (ex: PROMO10).", 'error');
          return;
      }

      if (!rawCode || couponAmount <= 0) {
          notify("Code et montant requis.", 'error');
          return;
      }
      
      try {
          await addCoupon({
              code: rawCode.toUpperCase(),
              amount: couponAmount,
              expiresAt: couponExpiresAt ? new Date(couponExpiresAt).getTime() : undefined
          });
          setNewTransactionRef('');
          notify(`Coupon créé : ${rawCode.toUpperCase()} (${couponAmount} CRD)`, 'success');
      } catch (_e) {
          const err = _e as any;
          console.error(err);
          let msg = "Erreur serveur : Coupon non sauvegardé.";
          if (err.message?.includes('unique constraint')) msg = "Ce code existe déjà.";
          if (err.code === '42501') msg = "Erreur de permission (RLS). Assurez-vous d'être bien Admin dans la base de données.";
          notify(msg, 'error');
      }
  };

  const handleRemoveCoupon = async (codeToRemove: string) => {
      try {
          await removeCoupon(codeToRemove);
          notify("Coupon supprimé.", 'info');
      } catch (_e) {
          console.error(_e);
          notify("Erreur lors de la suppression.", 'error');
      }
  };

  const filteredUsers = users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || (u.email && u.email.toLowerCase().includes(search.toLowerCase())));
  const pendingRequestsCount = (requests || []).filter(r => r.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 pb-20">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5">
            <div className="flex items-center gap-4">
                <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-500/20">
                    <Shield className="w-8 h-8" />
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight">TeacherMada Admin</h1>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Master Control Dashboard</p>
                </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <button onClick={refreshData} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl hover:bg-slate-100 transition-colors">
                    {isLoading ? <Loader2 className="w-5 h-5 text-indigo-500 animate-spin"/> : <RefreshCw className="w-5 h-5 text-indigo-500"/>}
                </button>
                <button onClick={onBack} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold transition-all hover:bg-slate-200">
                    Mode Chat
                </button>
                <button onClick={onLogout} className="flex-1 md:flex-none px-6 py-3 bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-500/20 hover:bg-red-600 transition-colors">
                    Déconnexion
                </button>
            </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide pb-2">
            <Tab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4"/>} label="Vue d'ensemble" />
            <Tab active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={<Users className="w-4 h-4"/>} label="Utilisateurs" />
            <Tab active={activeTab === 'requests'} onClick={() => setActiveTab('requests')} icon={<MessageSquare className="w-4 h-4"/>} label="Demandes" count={pendingRequestsCount} />
            <Tab active={activeTab === 'coupons'} onClick={() => setActiveTab('coupons')} icon={<Banknote className="w-4 h-4"/>} label="Coupons" />
            <Tab active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings className="w-4 h-4"/>} label="Système" />
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col gap-2">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                        <Users className="w-5 h-5" />
                        <span className="text-sm font-bold uppercase tracking-widest">Utilisateurs</span>
                    </div>
                    <div className="text-4xl font-black text-slate-800 dark:text-white">{users.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col gap-2">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                        <CreditCard className="w-5 h-5" />
                        <span className="text-sm font-bold uppercase tracking-widest">Montant Total (Ar)</span>
                    </div>
                    <div className="text-4xl font-black text-indigo-600">{(users.reduce((acc, u) => acc + u.credits, 0) * (localSettings?.creditPrice || 0)).toLocaleString()} Ar</div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col gap-2">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                        <Settings className="w-5 h-5" />
                        <span className="text-sm font-bold uppercase tracking-widest">Clés API</span>
                    </div>
                    <div className="text-4xl font-black text-slate-800 dark:text-white">{apiKeys.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col gap-2">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                        <MessageSquare className="w-5 h-5" />
                        <span className="text-sm font-bold uppercase tracking-widest">Demandes en attente</span>
                    </div>
                    <div className="text-4xl font-black text-amber-500">{pendingRequestsCount}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col gap-2">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                        <Banknote className="w-5 h-5" />
                        <span className="text-sm font-bold uppercase tracking-widest">Coupons Actifs</span>
                    </div>
                    <div className="text-4xl font-black text-emerald-500">{coupons.length}</div>
                </div>
            </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
            <div className="space-y-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input type="text" placeholder="Rechercher un utilisateur par nom ou email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
                    </div>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                    {filteredUsers.map(user => (
                        <div key={user.id} className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-white/5 flex flex-col gap-4 shadow-sm hover:border-indigo-500/30 transition-all">
                            <div className="flex flex-col sm:flex-row justify-between gap-4">
                                <div className="flex justify-between items-start sm:w-1/3">
                                    <div>
                                        <div className="font-black text-slate-800 dark:text-white text-lg">{user.username}</div>
                                        <div className="text-xs text-slate-400 font-mono mt-1">{user.email || 'Pas d\'email'}</div>
                                    </div>
                                    <div className="sm:hidden font-black text-indigo-600 text-xl bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1 rounded-xl border border-indigo-100 dark:border-indigo-800">{user.credits} CRD</div>
                                </div>
                                
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between sm:w-2/3 gap-4">
                                    <div className="hidden sm:block font-black text-indigo-600 text-xl bg-indigo-50 dark:bg-indigo-900/20 px-4 py-2 rounded-xl border border-indigo-100 dark:border-indigo-800 text-center min-w-[100px]">{user.credits} CRD</div>
                                    
                                    <div className="flex items-center gap-2 flex-1">
                                        <input type="number" placeholder="0" value={manualCreditInputs[user.id] || ''} onChange={(e) => handleManualCreditChange(user.id, e.target.value)} className="w-full sm:w-24 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                                        <button onClick={() => executeManualCredit(user.id, 1)} className="p-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors shadow-sm"><Plus className="w-5 h-5"/></button>
                                        <button onClick={() => executeManualCredit(user.id, -1)} className="p-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors shadow-sm"><Minus className="w-5 h-5"/></button>
                                    </div>
                                    
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => {
                                            setEditingUser(editingUser === user.id ? null : user.id);
                                            setEditEmail(user.email || '');
                                            setEditPassword('');
                                        }} className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shadow-sm">
                                            <Settings className="w-5 h-5"/>
                                        </button>
                                        <button onClick={() => toggleSuspend(user)} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest border transition-all whitespace-nowrap ${user.isSuspended ? 'border-red-500 text-red-500 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/30' : 'border-emerald-500 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'}`}>
                                            {user.isSuspended ? 'Suspendu' : 'Actif'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Edit User Auth Section */}
                            {editingUser === user.id && (
                                <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                                    <h4 className="text-sm font-bold mb-3">Modifier les informations de connexion</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Email</label>
                                            <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Nouvel email" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-indigo-500" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Nouveau mot de passe</label>
                                            <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-indigo-500" />
                                        </div>
                                    </div>
                                    <div className="mt-4 flex justify-end gap-2">
                                        <button onClick={() => setEditingUser(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors">Annuler</button>
                                        <button onClick={() => handleSaveUserAuth(user.id)} className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">Enregistrer</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {filteredUsers.length === 0 && (
                        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                            <p className="text-slate-400 font-medium">Aucun utilisateur trouvé.</p>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* REQUESTS TAB */}
        {activeTab === 'requests' && (
            <div className="space-y-4">
                <div className="flex items-center justify-between ml-2 mb-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Demandes de Rechargement</h3>
                    <span className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-bold px-3 py-1.5 rounded-xl">{pendingRequestsCount} en attente</span>
                </div>
                
                {(!requests || requests.length === 0) && (
                    <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                        <p className="text-slate-400 font-medium">Aucune demande pour le moment.</p>
                    </div>
                )}

                {requests?.map(req => (
                    <div key={req.id} className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group hover:border-indigo-500/30 transition-all">
                        <div className="flex-1 w-full">
                            <div className="flex flex-wrap items-center gap-3 mb-3">
                                <span className="font-black text-lg text-slate-800 dark:text-white">{req.username}</span>
                                <span className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full uppercase tracking-tighter">{new Date(req.createdAt).toLocaleDateString()}</span>
                                {req.status === 'pending' && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>}
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${req.type === 'credit' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                    {req.type === 'password_reset' ? 'Reset MDP' : req.type}
                                </span>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 w-full">
                                {req.amount && (
                                    <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-black bg-indigo-50 dark:bg-indigo-900/20 px-4 py-2 rounded-xl text-sm border border-indigo-100 dark:border-indigo-800 w-fit">
                                        <CreditCard className="w-4 h-4"/>
                                        {req.amount} CRD
                                    </div>
                                )}
                                {req.message && <div className="text-slate-500 dark:text-slate-400 italic text-sm border-l-2 border-slate-200 dark:border-slate-700 pl-3 break-words w-full sm:w-auto">"{req.message}"</div>}
                            </div>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
                            {req.status === 'pending' ? (
                                <>
                                    <button onClick={() => handleResolveRequest(req.id, 'approved')} className="flex-1 md:flex-none px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-sm font-bold transition-all flex items-center justify-center gap-2">
                                        <CheckCircle className="w-5 h-5"/> Accepter
                                    </button>
                                    <button onClick={() => handleResolveRequest(req.id, 'rejected')} className="flex-1 md:flex-none px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-500 hover:border-red-200 rounded-xl transition-all font-bold flex items-center justify-center gap-2">
                                        <X className="w-5 h-5"/> Rejeter
                                    </button>
                                </>
                            ) : (
                                <span className={`w-full md:w-auto text-center px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest border ${req.status === 'approved' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                                    {req.status === 'approved' ? 'Validé' : 'Rejeté'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* COUPONS TAB */}
        {activeTab === 'coupons' && (
            <div className="space-y-6">
                <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-[2rem] border border-emerald-100 dark:border-emerald-900/30 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-100 dark:bg-emerald-900/20 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                    
                    <div className="relative z-10">
                    <h3 className="font-black text-emerald-800 dark:text-emerald-400 mb-6 flex items-center gap-2 uppercase tracking-widest text-sm">
                        <Banknote className="w-5 h-5"/> Créer un Coupon (Code)
                    </h3>
                    <div className="flex flex-col md:flex-row gap-4 mb-8">
                        <div className="flex-[2]">
                            <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-2 block tracking-wider">Code à distribuer</label>
                            <input 
                                type="text" 
                                placeholder="Ex: PROMO2024" 
                                value={newTransactionRef} 
                                onChange={e => setNewTransactionRef(e.target.value)} 
                                className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold font-mono text-lg uppercase transition-all" 
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-2 block tracking-wider">Valeur (Crédits)</label>
                            <input 
                                type="number" 
                                value={couponAmount} 
                                onChange={e => setCouponAmount(Number(e.target.value))} 
                                className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-center text-lg transition-all"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-400 uppercase ml-2 mb-2 block tracking-wider">Expiration (Optionnel)</label>
                            <input 
                                type="date" 
                                value={couponExpiresAt} 
                                onChange={e => setCouponExpiresAt(e.target.value)} 
                                className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-center text-lg transition-all"
                            />
                        </div>
                        <div className="flex items-end">
                            <button onClick={handleAddCoupon} className="w-full md:w-auto h-[60px] px-8 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2">
                                <Plus className="w-5 h-5"/> Créer
                            </button>
                        </div>
                    </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200 dark:border-white/5">
                    <h4 className="text-sm font-bold text-slate-400 uppercase mb-6 tracking-widest flex items-center justify-between">
                        Coupons Actifs 
                        <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-full text-xs">{coupons.length}</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {coupons.length === 0 && (
                            <div className="col-span-full text-slate-400 text-sm italic text-center py-8 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                                Aucun coupon actif.
                            </div>
                        )}
                        {coupons.map((ref, i) => (
                            <div key={i} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl flex items-center justify-between gap-3 shadow-sm border border-slate-200 dark:border-slate-700 group hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors">
                                <div className="flex flex-col gap-1 overflow-hidden">
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate" title={ref.code}>
                                        {ref.code}
                                    </span>
                                    <span className="text-xs text-slate-400 font-medium">Créé le {new Date(ref.createdAt).toLocaleDateString()}</span>
                                    {ref.expiresAt && (
                                        <span className="text-[10px] font-bold text-red-400 uppercase">
                                            Expire: {new Date(ref.expiresAt).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-lg text-sm font-black border border-emerald-200 dark:border-emerald-800">{ref.amount} CRD</span>
                                    <button onClick={() => handleRemoveCoupon(ref.code)} className="text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors p-2 bg-white dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600" title="Supprimer">
                                        <Trash2 className="w-4 h-4"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
            <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200 dark:border-white/5">
                <h3 className="text-xl font-black mb-8 flex items-center gap-3">
                    <Settings className="w-6 h-6 text-indigo-500" />
                    Paramètres Plateforme
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className="space-y-3">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-2">Prix par Crédit (Ar)</label>
                        <input type="number" value={localSettings?.creditPrice || ''} onChange={e => setLocalSettings(prev => prev ? {...prev, creditPrice: parseInt(e.target.value), updatedAt: Date.now()} : undefined)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-xl border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-2">Contact Telma</label>
                        <input type="text" value={localSettings?.adminContact?.telma || ''} onChange={e => setLocalSettings(prev => prev ? {...prev, adminContact: {...(prev.adminContact || { telma: '', airtel: '', orange: '' }), telma: e.target.value}, updatedAt: Date.now()} : undefined)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-xl border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-2">Contact Airtel</label>
                        <input type="text" value={localSettings?.adminContact?.airtel || ''} onChange={e => setLocalSettings(prev => prev ? {...prev, adminContact: {...(prev.adminContact || { telma: '', airtel: '', orange: '' }), airtel: e.target.value}, updatedAt: Date.now()} : undefined)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-xl border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-2">Console Logs (Debug)</label>
                        <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                            <button 
                                onClick={() => setLocalSettings(prev => prev ? {...prev, showConsoleLogs: !prev.showConsoleLogs, updatedAt: Date.now()} : undefined)}
                                className={`w-14 h-8 rounded-full transition-all relative ${localSettings?.showConsoleLogs ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${localSettings?.showConsoleLogs ? 'left-7' : 'left-1'}`} />
                            </button>
                            <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                {localSettings?.showConsoleLogs ? 'Activé (Visible)' : 'Désactivé (Caché)'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="mb-10">
                    <h4 className="text-sm font-bold text-slate-400 uppercase mb-4 tracking-widest flex items-center gap-2">
                        <Settings className="w-4 h-4"/> Clés API Gemini (Rotation Automatique)
                        {isLoadingKeys && <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />}
                    </h4>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-2">Ajouter une clé API</label>
                            <div className="flex gap-2">
                                <input 
                                    type="password" 
                                    placeholder="AIzaSy..." 
                                    id="newGeminiKeyInput"
                                    className="flex-1 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-mono text-sm border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                                />
                                <button 
                                    onClick={async () => {
                                        const input = document.getElementById('newGeminiKeyInput') as HTMLInputElement;
                                        if (input && input.value.trim()) {
                                            const newKey = input.value.trim();
                                            const { error } = await supabase.from('api_keys').insert({ key_value: newKey });
                                            if (error) {
                                                console.error("Supabase error:", error);
                                                notify(`Erreur lors de l'ajout de la clé: ${error.message}`, 'error');
                                                return;
                                            }
                                            setApiKeys(prev => [...prev, newKey]);
                                            input.value = '';
                                            notify("Clé ajoutée.", 'success');
                                        }
                                    }}
                                    className="px-6 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-colors"
                                >
                                    Ajouter
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 ml-2">Ces clés seront utilisées à tour de rôle (rotation) pour éviter de dépasser les quotas.</p>
                        </div>
                        
                        {/* List of keys */}
                        {apiKeys.length > 0 && (
                            <div className="mt-4 space-y-2">
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-2">Clés configurées ({apiKeys.length})</label>
                                {apiKeys.map((key, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                                        <div className="font-mono text-sm text-slate-600 dark:text-slate-300">
                                            {key.substring(0, 10)}...{key.substring(key.length - 4)}
                                        </div>
                                        <button 
                                            onClick={async () => {
                                                const { error } = await supabase.from('api_keys').delete().eq('key_value', key);
                                                if (error) {
                                                    console.error("Supabase error:", error);
                                                    notify(`Erreur lors de la suppression: ${error.message}`, 'error');
                                                    return;
                                                }
                                                setApiKeys(prev => prev.filter((_, i) => i !== idx));
                                                notify("Clé supprimée.", 'success');
                                            }}
                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <button onClick={saveSettings} className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-3 transition-all active:scale-[0.99]">
                    <Save className="w-6 h-6"/> Sauvegarder les changements
                </button>
                <div className="mt-10 p-6 sm:p-8 bg-amber-50 dark:bg-amber-900/10 border-l-8 border-amber-400 rounded-2xl">
                    <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200 font-black mb-3"><Info className="w-6 h-6"/> Gestion API</div>
                    <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed font-medium">Les clés API sont désormais isolées au niveau du déploiement (Render/Vercel) via la variable <strong>API_KEY</strong> pour une sécurité maximale. Pour changer de clé, mettez à jour votre environnement sur Render.</p>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

interface TabProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    count?: number;
}

const Tab = ({ active, onClick, icon, label, count }: TabProps) => (
    <button onClick={onClick} className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl font-black whitespace-nowrap transition-all flex-1 md:flex-none min-w-[120px] ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
        {icon} <span className="hidden sm:inline">{label}</span>
        {count !== undefined && count > 0 && <span className="bg-white/30 dark:bg-slate-700 px-2 py-0.5 rounded-full text-[10px] ml-1">{count}</span>}
    </button>
);

export default AdminDashboard;

