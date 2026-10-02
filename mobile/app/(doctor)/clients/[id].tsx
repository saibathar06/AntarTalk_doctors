import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, ApiError, json } from '../../../src/api';
import { useSession } from '../../../src/auth';
import { colors } from '../../../src/theme';
import { Button, Card, Field, InlineError, Loader, Screen, Title } from '../../../src/ui';

type Prescription = { id: string; medicines: string; instructions: string | null; issuedAt: string };
type Session = { id: string; startTime: string; sessionDurationMinutes: number; status: string; prescription: Prescription | null };
type History = { client: { name: string }; items: Session[] };
const date = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));

export default function ClientHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [medicines, setMedicines] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const keys = useRef<Record<string, string>>({});
  const psychiatrist = profile?.professionalCategory === 'PSYCHIATRIST';

  const load = useCallback(async () => { if (!id) return; try { setError(''); setHistory(await api<History>(`/api/doctor/clients/${id}/sessions?page=1&limit=50`)); } catch (cause) { setError((cause as ApiError).message); } }, [id]);
  useEffect(() => { load(); }, [load]);
  const issuePrescription = async (session: Session) => {
    const medicineText = medicines[session.id]?.trim();
    if (!medicineText) { setError('Enter the prescribed medicines before issuing the prescription.'); return; }
    if (!keys.current[session.id]) keys.current[session.id] = crypto.randomUUID();
    setBusyId(session.id); setError('');
    try {
      await json(`/api/doctor/sessions/${session.id}/prescription`, 'POST', { medicines: medicineText, instructions: instructions[session.id]?.trim() || null }, { 'Idempotency-Key': keys.current[session.id] });
      await load();
    } catch (cause) { setError((cause as ApiError).message); } finally { setBusyId(null); }
  };
  if (!history && !error) return <Loader label="Loading client history…" />;
  return <Screen>
    <Title subtitle="Session history is visible only for this client within your practice.">{history?.client.name || 'Client history'}</Title>
    <InlineError message={error} retry={load} />
    {history?.items.length ? history.items.map((session) => <Card key={session.id}>
      <View style={styles.row}><View><Text style={styles.date}>{date(session.startTime)}</Text><Text style={styles.meta}>Up to {session.sessionDurationMinutes} min</Text></View><Text style={[styles.status, session.status === 'COMPLETED' && styles.completed]}>{session.status}</Text></View>
      {session.prescription ? <View style={styles.prescription}><Text style={styles.prescriptionTitle}>Prescription issued</Text><Text style={styles.medicine}>{session.prescription.medicines}</Text>{session.prescription.instructions ? <Text style={styles.instructions}>{session.prescription.instructions}</Text> : null}<Text style={styles.issued}>Issued {date(session.prescription.issuedAt)}</Text></View> : null}
      {psychiatrist && session.status === 'COMPLETED' && !session.prescription ? <View style={styles.form}><Text style={styles.prescriptionTitle}>Issue prescription</Text>{!profile?.hasStampSignature ? <Text style={styles.warning}>Upload your stamp/signature in My profile before issuing a prescription.</Text> : <><Field label="Prescribed medicines" value={medicines[session.id] ?? ''} onChangeText={(value) => setMedicines((current) => ({ ...current, [session.id]: value }))} multiline placeholder="Medicine, dose, frequency and duration" /><Field label="Instructions (optional)" value={instructions[session.id] ?? ''} onChangeText={(value) => setInstructions((current) => ({ ...current, [session.id]: value }))} multiline placeholder="Additional instructions" /><Button label="Issue and email prescription PDF" onPress={() => issuePrescription(session)} loading={busyId === session.id} disabled={!medicines[session.id]?.trim()} /></>}</View> : null}
    </Card>) : <Card><Text style={styles.empty}>No past sessions with this client yet.</Text></Card>}
  </Screen>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, date: { color: colors.ink, fontWeight: '800', fontSize: 15 }, meta: { color: colors.muted, fontSize: 12, marginTop: 4 }, status: { color: colors.muted, fontSize: 11, fontWeight: '800' }, completed: { color: colors.teal }, prescription: { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.line, gap: 6 }, form: { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.line, gap: 9 }, prescriptionTitle: { color: colors.teal, fontWeight: '800', fontSize: 13 }, medicine: { color: colors.ink, fontSize: 13, lineHeight: 19 }, instructions: { color: colors.muted, fontSize: 12, lineHeight: 18 }, issued: { color: colors.muted, fontSize: 11 }, warning: { color: colors.danger, fontSize: 12, lineHeight: 18 }, empty: { color: colors.muted }
});
