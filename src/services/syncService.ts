import { supabase, isSupabaseConfigured } from "../lib/supabase";

const SYNC_QUEUE_KEY = 'tm_sync_queue_v2';
const MAX_RETRIES = 5;
const MAX_QUEUE_SIZE = 100; // Limite stricte pour éviter la saturation du localStorage

type SyncOperationType = 
    | 'UPDATE_PROFILE' 
    | 'UPSERT_SESSION' 
    | 'INSERT_EXAM' 
    | 'INSERT_CERT' 
    | 'INSERT_NOTIF'
    | 'MARK_NOTIF_READ'
    | 'MARK_ALL_NOTIF_READ'
    | 'DELETE_NOTIF';

interface SyncOperation {
    id: string;
    type: SyncOperationType;
    payload: any;
    timestamp: number;
    retryCount: number;
}

class SyncService {
    private queue: SyncOperation[] = [];
    private isProcessing = false;
    private listeners: ((status: 'synced' | 'syncing' | 'offline' | 'error') => void)[] = [];
    private debouncers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.loadQueue();
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.processQueue());
            window.addEventListener('offline', () => this.notifyListeners('offline'));
            // Try to process on load if online
            if (navigator.onLine) {
                setTimeout(() => this.processQueue(), 1000);
            }
        }
    }

    private loadQueue() {
        try {
            const stored = localStorage.getItem(SYNC_QUEUE_KEY);
            this.queue = stored ? JSON.parse(stored) : [];
        } catch (e) {
            this.queue = [];
        }
    }

    private saveQueue() {
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.queue));
    }

    public subscribe(callback: (status: 'synced' | 'syncing' | 'offline' | 'error') => void) {
        this.listeners.push(callback);
        // Initial status
        callback(this.queue.length > 0 ? (this.isProcessing ? 'syncing' : 'offline') : 'synced');
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners(status: 'synced' | 'syncing' | 'offline' | 'error') {
        this.listeners.forEach(cb => cb(status));
    }

    public async addToQueue(type: SyncOperationType, payload: any, debounceKey?: string) {
        // Debounce logic: If a pending operation exists with the same key, replace it or delay
        if (debounceKey) {
            // Remove existing pending op with same key to avoid stale overwrites in queue
            // CRITICAL FIX: Do not remove the item at index 0 if it is currently being processed
            this.queue = this.queue.filter((op, index) => {
                if (this.isProcessing && index === 0) return true; // Keep currently processing item
                return op.id !== debounceKey;
            });
            
            // Clear existing timeout
            if (this.debouncers.has(debounceKey)) {
                clearTimeout(this.debouncers.get(debounceKey)!);
            }

            // Schedule addition
            const timeout = setTimeout(() => {
                this.pushToQueue(type, payload, debounceKey);
                this.debouncers.delete(debounceKey);
            }, 2000); // 2s debounce for high frequency updates
            
            this.debouncers.set(debounceKey, timeout);
        } else {
            this.pushToQueue(type, payload);
        }
    }

    private pushToQueue(type: SyncOperationType, payload: any, idOverride?: string) {
        const op: SyncOperation = {
            id: idOverride || crypto.randomUUID(),
            type,
            payload,
            timestamp: Date.now(),
            retryCount: 0
        };
        
        this.queue.push(op);
        
        // Stratégie anti-surcharge : on supprime les plus vieux si on dépasse la limite
        if (this.queue.length > MAX_QUEUE_SIZE) {
            console.warn(`[SyncService] Queue size exceeded ${MAX_QUEUE_SIZE}. Dropping oldest item.`);
            // On garde les éléments en cours de traitement (index 0) et on supprime le plus vieux non traité (index 1)
            if (this.isProcessing && this.queue.length > 1) {
                this.queue.splice(1, 1);
            } else {
                this.queue.shift();
            }
        }
        
        this.saveQueue();
        this.processQueue();
    }

    public async processQueue() {
        if (this.isProcessing) return;
        
        if (this.queue.length === 0) {
            this.notifyListeners('synced');
            return;
        }

        if (!navigator.onLine || !isSupabaseConfigured()) {
            this.notifyListeners('offline');
            return;
        }

        this.isProcessing = true;
        this.notifyListeners('syncing');

        try {
            while (this.queue.length > 0) {
                // Check connectivity again in the loop
                if (!navigator.onLine) {
                    this.notifyListeners('offline');
                    break;
                }

                const currentOp = this.queue[0];
                const result = await this.executeOperation(currentOp);
                
                if (result.success) {
                    this.queue.shift(); // Remove successful op
                    this.saveQueue();
                } else if (result.drop) {
                    // Erreur permanente (ex: 400 Bad Request, 401 Unauthorized, 403 Forbidden)
                    console.error(`[SyncService] Operation ${currentOp.id} failed permanently. Dropping.`);
                    this.queue.shift();
                    this.saveQueue();
                } else {
                    // Handle failure (retry logic with exponential backoff)
                    currentOp.retryCount++;
                    if (currentOp.retryCount >= MAX_RETRIES) {
                        console.error(`[SyncService] Operation ${currentOp.id} failed after ${MAX_RETRIES} attempts. Dropping.`);
                        this.queue.shift(); // Drop it to unblock queue
                    } else {
                        // Delay before retrying same op (Exponential Backoff: 1s, 2s, 4s, 8s...)
                        const delay = 1000 * Math.pow(2, currentOp.retryCount);
                        console.log(`[SyncService] Retrying operation ${currentOp.id} in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    this.saveQueue();
                }
            }
        } catch (e) {
            console.error("Sync processing error:", e);
            this.notifyListeners('error');
        } finally {
            this.isProcessing = false;
            if (this.queue.length === 0) {
                this.notifyListeners('synced');
            }
        }
    }

    private async executeOperation(op: SyncOperation): Promise<{ success: boolean, drop: boolean }> {
        try {
            let error = null;
            switch (op.type) {
                case 'UPDATE_PROFILE':
                    ({ error } = await supabase.from('profiles').update(op.payload).eq('id', op.payload.id));
                    break;
                case 'UPSERT_SESSION':
                    ({ error } = await supabase.from('learning_sessions').upsert(op.payload));
                    break;
                case 'INSERT_EXAM':
                    ({ error } = await supabase.from('exam_results').insert([op.payload]));
                    break;
                case 'INSERT_CERT':
                    ({ error } = await supabase.from('certificates').insert([op.payload]));
                    break;
                case 'INSERT_NOTIF':
                    ({ error } = await supabase.from('notifications').insert([op.payload]));
                    break;
                case 'MARK_NOTIF_READ':
                    ({ error } = await supabase.from('notifications').update({ read: true }).eq('id', op.payload.id));
                    break;
                case 'MARK_ALL_NOTIF_READ':
                    ({ error } = await supabase.from('notifications').update({ read: true }).eq('user_id', op.payload.userId));
                    break;
                case 'DELETE_NOTIF':
                    ({ error } = await supabase.from('notifications').delete().eq('id', op.payload.id));
                    break;
                default:
                    return { success: true, drop: false };
            }

            if (error) {
                console.error(`[SyncService] DB Error for ${op.type}:`, error);
                // Si l'erreur est liée aux permissions (RLS) ou à un schéma invalide, on drop pour ne pas boucler
                const isPermanentError = error.code === '42P01' || error.code === '42501' || error.code === '23505';
                return { success: false, drop: isPermanentError };
            }

            return { success: true, drop: false };

        } catch (e) {
            console.error("[SyncService] Execute operation exception:", e);
            return { success: false, drop: false }; // Network error, we can retry
        }
    }
}

export const syncService = new SyncService();
