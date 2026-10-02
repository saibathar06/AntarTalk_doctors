import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError, json } from '../../../src/api';
import type { Appointment, Page } from '../../../src/types';
import { colors } from '../../../src/theme';
import { Button, Card, confirm, InlineError, Loader, Screen, Title } from '../../../src/ui';

const filters = ['upcoming', 'today', 'completed', 'cancelled'] as const;
type Filter = typeof filters[number];
type Slot = { startTime: string; endTime: string };
type RescheduleRequest = { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; proposedStartTime: string; reason: string | null; booking: { id: string; clientName: string | null; startTime: string; sessionDurationMinutes: number } };

const indiaParts = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).reduce<Record<string, string>>((result, part) => (result[part.type] = part.value, result), {});
const indiaDay = (value = new Date()) => { const parts = indiaParts(value); return `${parts.year}-${parts.month}-${parts.day}`; };
const plusDays = (date: string, days: number) => { const parsed = new Date(`${date}T12:00:00.000Z`); parsed.setUTCDate(parsed.getUTCDate() + days); return parsed.toISOString().slice(0, 10); };
const appointmentTime = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value));
const slotTime = (value: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value));

export default function AppointmentsScreen() {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [items, setItems] = useState<Appointment[]>([]);
  const [requests, setRequests] = useState<RescheduleRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const from = useMemo(() => indiaDay(), []);
  const to = useMemo(() => plusDays(from, 7), [from]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError('');
      const [appointments, reschedulePage] = await Promise.all([
        api<Page<Appointment>>(`/api/doctor/appointments?filter=${filter}&page=1&limit=30`),
        api<Page<RescheduleRequest>>('/api/doctor/reschedule-requests?page=1&limit=10&status=PENDING')
      ]);
      setItems(appointments.items);
      setRequests(reschedulePage.items);
    } catch (cause) { setError((cause as ApiError).message); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const openReschedule = async (item: Appointment) => {
    setRescheduling(item); setSlotsLoading(true); setSlots([]); setError('');
    try {
      const available = await api<Slot[]>(`/api/doctor/availability/slots?from=${encodeURIComponent(`${from}T00:00:00.000+05:30`)}&to=${encodeURIComponent(`${to}T00:00:00.000+05:30`)}`);
      setSlots(available.filter((slot) => slot.startTime !== item.startTime));
    } catch (cause) { setError((cause as ApiError).message); } finally { setSlotsLoading(false); }
  };
  const reschedule = async (startTime: string) => {
    if (!rescheduling) return;
    setActionId(rescheduling.id);
    try { await json(`/api/doctor/sessions/${rescheduling.id}/reschedule`, 'POST', { startTime }); setRescheduling(null); await load(); } catch (cause) { setError((cause as ApiError).message); } finally { setActionId(null); }
  };
  const cancel = async (id: string) => {
    setActionId(id);
    try { await json(`/api/doctor/sessions/${id}/cancel`, 'POST', {}); await load(); } catch (cause) { setError((cause as ApiError).message); } finally { setActionId(null); }
  };
  const respond = async (request: RescheduleRequest, decision: 'APPROVE' | 'REJECT') => {
    setActionId(request.id);
    try { await json(`/api/doctor/reschedule-requests/${request.id}/respond`, 'POST', { decision }); await load(); } catch (cause) { setError((cause as ApiError).message); } finally { setActionId(null); }
  };

  return <Screen>
    <Title subtitle="Manage confirmed sessions, client change requests, and secure video access.">Appointments</Title>
    <View style={styles.filters}>{filters.map((value) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value}</Text></Pressable>)}</View>
    <InlineError message={error} retry={load} />
    {loading ? <Loader label="Loading appointments…" /> : <>
      {requests.length ? <Card style={styles.requestCard}>
        <Text style={styles.sectionTitle}>Client reschedule requests</Text><Text style={styles.sectionCaption}>Approving uses this client’s requested appointment time and sends the update securely.</Text>
        {requests.map((request) => <View key={request.id} style={styles.request}>
          <Text style={styles.client}>{request.booking.clientName || 'Client'}</Text><Text style={styles.meta}>Requested: {slotTime(request.proposedStartTime)}</Text>{request.reason ? <Text style={styles.reason}>“{request.reason}”</Text> : null}
          <View style={styles.actions}><View style={styles.action}><Button label="Decline" variant="secondary" loading={actionId === request.id} onPress={() => respond(request, 'REJECT')} /></View><View style={styles.action}><Button label="Approve" loading={actionId === request.id} onPress={() => respond(request, 'APPROVE')} /></View></View>
        </View>)}
      </Card> : null}
      {items.length ? items.map((item) => <Card key={item.id}>
        <Text style={styles.client}>{item.clientLabel}</Text><Text style={styles.meta}>{appointmentTime(item.startTime)} · up to {item.sessionDurationMinutes} min</Text><Text style={[styles.status, item.status === 'CONFIRMED' && styles.confirmed]}>{item.status}</Text>
        {item.join.canJoin ? <Button label="Join session" onPress={() => router.push({ pathname: '/(doctor)/video/[id]', params: { id: item.id } })} /> : null}
        {item.status === 'CONFIRMED' ? <View style={styles.actions}><View style={styles.action}><Button label="Reschedule" variant="secondary" loading={actionId === item.id} onPress={() => openReschedule(item)} /></View><View style={styles.action}><Button label="Cancel" variant="danger" loading={actionId === item.id} onPress={() => confirm('Cancel appointment?', 'The client will receive the cancellation and any eligible refund is handled by AntarTalk.', () => cancel(item.id), true)} /></View></View> : null}
      </Card>) : <Card><Text style={styles.empty}>No {filter} appointments.</Text></Card>}
      {rescheduling ? <Card style={styles.rescheduleCard}>
        <Text style={styles.sectionTitle}>Choose a new session time</Text><Text style={styles.sectionCaption}>Only live, backend-confirmed availability for the next seven days is shown.</Text>
        {slotsLoading ? <Loader label="Finding available times…" /> : slots.length ? <View style={styles.slotList}>{slots.map((slot) => <Pressable key={slot.startTime} disabled={Boolean(actionId)} onPress={() => reschedule(slot.startTime)} style={styles.slot}><Text style={styles.slotText}>{slotTime(slot.startTime)}</Text></Pressable>)}</View> : <Text style={styles.empty}>There are no other available times in the next seven days.</Text>}
        <Button label="Close" variant="secondary" onPress={() => setRescheduling(null)} />
      </Card> : null}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, filter: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line }, filterActive: { backgroundColor: colors.pink, borderColor: colors.pink }, filterText: { color: colors.muted, fontWeight: '700', textTransform: 'capitalize' }, filterTextActive: { color: '#fff' },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' }, sectionCaption: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5 }, requestCard: { gap: 12, backgroundColor: colors.tealSoft }, request: { borderTopWidth: 1, borderTopColor: '#CBEAE3', paddingTop: 12, gap: 4 }, client: { color: colors.ink, fontWeight: '800', fontSize: 16 }, meta: { color: colors.muted, marginTop: 4, lineHeight: 20 }, reason: { color: colors.muted, fontStyle: 'italic', marginTop: 2 }, status: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 9 }, confirmed: { color: colors.teal }, actions: { flexDirection: 'row', gap: 9, marginTop: 10 }, action: { flex: 1 }, rescheduleCard: { gap: 12, borderColor: '#F8C4D8' }, slotList: { gap: 8 }, slot: { borderWidth: 1, borderColor: '#B9E5DD', backgroundColor: '#F5FCFA', padding: 13, borderRadius: 12 }, slotText: { color: colors.ink, fontWeight: '700' }, empty: { color: colors.muted, lineHeight: 20 }
});
