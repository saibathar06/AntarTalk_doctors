import { Redirect } from 'expo-router';
import { useSession } from '../src/auth';
import { Loader } from '../src/ui';
export default function Index() { const { ready, viewer } = useSession(); if (!ready) return <Loader label="Restoring your secure session…" />; if (!viewer) return <Redirect href="/auth" />; return <Redirect href={viewer.role === 'ADMIN' ? '/(admin)' : '/(doctor)/(tabs)'} />; }
