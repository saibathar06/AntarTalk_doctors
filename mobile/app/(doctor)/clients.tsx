import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, ApiError } from '../../src/api';
import type { Page } from '../../src/types';
import { colors } from '../../src/theme';
import { Card, InlineError, Loader, Screen, Title } from '../../src/ui';

type Client = { clientId: string; label: string; appointmentCount: number; latestAppointmentAt: string };
const day = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(value));

export default function ClientsScreen() {
  const [data, setData] = useState<Page<Client> | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); setData(await api<Page<Client>>('/api/doctor/clients?page=1&limit=50')); } catch (cause) { setError((cause as ApiError).message); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!data && !error) return <Loader label="Loading your clients…" />;
  return <Screen>
    <Title subtitle="Only people who have booked with your practice are listed. Open a client to review their session history.">Clients</Title>
    <InlineError message={error} retry={load} />
    <Card style={styles.list}>{data?.items.length ? data.items.map((client, index) => <Pressable key={client.clientId} onPress={() => router.push({ pathname: '/(doctor)/clients/[id]', params: { id: client.clientId } })} style={[styles.item, index !== data.items.length - 1 && styles.border]}>
      <View style={styles.avatar}><Text style={styles.initial}>{client.label.slice(0, 1).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.name}>{client.label}</Text><Text style={styles.meta}>{client.appointmentCount} {client.appointmentCount === 1 ? 'session' : 'sessions'} · last {day(client.latestAppointmentAt)}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.muted} />
    </Pressable>) : <Text style={styles.empty}>No clients yet.</Text>}</Card>
  </Screen>;
}

const styles = StyleSheet.create({
  list: { paddingVertical: 2 }, item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }, border: { borderBottomWidth: 1, borderBottomColor: colors.line }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center' }, initial: { color: colors.teal, fontWeight: '800', fontSize: 16 }, copy: { flex: 1, gap: 4 }, name: { color: colors.ink, fontSize: 16, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 12 }, empty: { color: colors.muted }
});
