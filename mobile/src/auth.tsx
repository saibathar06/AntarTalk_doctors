import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearTokens, api, restoreTokens, refresh } from './api';
import type { Profile, Viewer } from './types';

type Session = { viewer: Viewer | null; profile: Profile | null; ready: boolean; refreshProfile: () => Promise<void>; signOut: () => Promise<void> };
const SessionContext = createContext<Session | null>(null);
export function useSession() { const value = useContext(SessionContext); if (!value) throw new Error('SessionProvider is missing'); return value; }
export function SessionProvider({ children }: { children: ReactNode }) {
 const [viewer, setViewer] = useState<Viewer | null>(null); const [profile, setProfile] = useState<Profile | null>(null); const [ready, setReady] = useState(false);
 const refreshProfile = async () => { const current = await api<Viewer>('/api/doctor/auth/me'); setViewer(current); setProfile(current.role === 'DOCTOR' ? await api<Profile>('/api/doctor/profile') : null); };
 const signOut = async () => { await clearTokens(); setViewer(null); setProfile(null); };
 useEffect(() => { (async () => { try { if (await restoreTokens()) { await refresh(); await refreshProfile(); } } catch { await signOut(); } finally { setReady(true); } })(); }, []);
 const value = useMemo(() => ({ viewer, profile, ready, refreshProfile, signOut }), [viewer, profile, ready]); return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
