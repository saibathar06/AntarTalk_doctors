import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, json } from '../../../src/api';
import { colors } from '../../../src/theme';
import { Button, Card, Field, InlineError, Loader, Screen, Title } from '../../../src/ui';

type Timing = { startTime: string; endTime: string } | null;
type Slot = { startTime: string; endTime: string };
type Block = { id: string; startTime: string; endTime: string; reason: string | null };
type WorkingHour = { dayOfWeek: number; availableDate?: string | null; startTime: string; endTime: string; isActive: boolean; useDefault?: boolean };

const indiaTimeZone = 'Asia/Kolkata';

function dateKey(value = new Date()) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: indiaTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(key: string, offset: number) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset));
}

function keyFromDate(value: Date) { return value.toISOString().slice(0, 10); }
function dayOfWeek(value: Date) { return ((value.getUTCDay() + 6) % 7) + 1; }
function slotTime(value: string) { return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: indiaTimeZone }).format(new Date(value)); }
function dayLabel(value: Date) { return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value); }

export default function AvailabilityScreen() {
  const [timing, setTiming] = useState<Timing>(null);
  const [defaultStart, setDefaultStart] = useState('10:00');
  const [defaultEnd, setDefaultEnd] = useState('18:00');
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const firstDay = dateKey();
  const days = useMemo(() => Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(firstDay, offset);
    return { key: keyFromDate(date), dayOfWeek: dayOfWeek(date), label: offset === 0 ? `Today · ${dayLabel(date)}` : dayLabel(date) };
  }), [firstDay]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setError('');
      const from = `${dateKey()}T00:00:00.000+05:30`;
      const to = `${keyFromDate(addDays(dateKey(), 7))}T00:00:00.000+05:30`;
      const [savedDefault, datedHours, generated, blocked] = await Promise.all([
        api<Timing>('/api/doctor/availability/default-timing'),
        api<WorkingHour[]>('/api/doctor/availability'),
        api<Slot[]>(`/api/doctor/availability/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
        api<Block[]>('/api/doctor/blocked-slots'),
      ]);
      setTiming(savedDefault);
      setDefaultStart(savedDefault?.startTime ?? '10:00');
      setDefaultEnd(savedDefault?.endTime ?? '18:00');
      setHours(datedHours);
      setSlots(generated);
      setBlocks(blocked);
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveDefault = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await json('/api/doctor/availability/default-timing', 'PUT', { timing: { startTime: defaultStart, endTime: defaultEnd } });
      await load();
      setNotice('Default timing saved. It applies to every day that does not have a custom schedule.');
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  const saveHours = async (updated: WorkingHour[]) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await json('/api/doctor/availability', 'PUT', { timezone: indiaTimeZone, windows: updated });
      await load();
      setNotice('Daily availability saved. Generated times now reflect your changes.');
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  const customizeDay = (key: string, weekday: number) => {
    const existing = hours.filter((item) => item.availableDate === key);
    if (existing.length && !existing.every((item) => item.useDefault)) return;
    const withoutDay = hours.filter((item) => item.availableDate !== key);
    setHours([...withoutDay, { dayOfWeek: weekday, availableDate: key, startTime: timing?.startTime ?? defaultStart, endTime: timing?.endTime ?? defaultEnd, isActive: true, useDefault: false }]);
  };

  const updateDay = (key: string, change: Partial<WorkingHour>) => setHours((current) => current.map((item) => item.availableDate === key ? { ...item, ...change, useDefault: false } : item));
  const restoreDefault = async (key: string) => await saveHours(hours.filter((item) => item.availableDate !== key));

  const toggleBlock = async (slot: Slot) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const existing = blocks.find((block) => block.startTime === slot.startTime && block.endTime === slot.endTime);
      if (existing) await api(`/api/doctor/blocked-slots/${existing.id}`, { method: 'DELETE' });
      else await json('/api/doctor/blocked-slots', 'POST', { startTime: slot.startTime, endTime: slot.endTime, reason: 'Unavailable appointment time' });
      await load();
    } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };

  if (busy && !hours.length && !error) return <Loader label="Loading availability…" />;

  return <Screen>
    <Title subtitle={`Today is ${days[0]?.label ?? 'today'} in India Standard Time. Set your hours and review the appointment windows clients can book.`}>Availability</Title>
    <InlineError message={error} retry={load} />
    {notice ? <View style={styles.notice}><Ionicons name="checkmark-circle-outline" size={18} color={colors.teal} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
    <Card>
      <Text style={styles.cardTitle}>Default timing</Text>
      <Text style={styles.description}>This automatically applies for the next seven days unless you choose custom hours for a date.</Text>
      <View style={styles.timeFields}><View style={styles.timeField}><Field label="Start (HH:MM)" value={defaultStart} onChangeText={setDefaultStart} editable={!busy} /></View><View style={styles.timeField}><Field label="End (HH:MM)" value={defaultEnd} onChangeText={setDefaultEnd} editable={!busy} /></View></View>
      <Button label="Save default timing" onPress={saveDefault} loading={busy} />
    </Card>
    <Card>
      <Text style={styles.cardTitle}>Your next seven days</Text>
      <Text style={styles.description}>A custom timing takes precedence over your default only for that date. Restore default to make the date match your default timing again.</Text>
      <View style={styles.dayList}>{days.map((day) => {
        const custom = hours.filter((item) => item.availableDate === day.key && !item.useDefault);
        const isCustom = custom.length > 0;
        const activeHours = isCustom ? custom[0] : hours.find((item) => item.availableDate === day.key);
        const daySlots = slots.filter((slot) => dateKey(new Date(slot.startTime)) === day.key);
        const dayBlocks = blocks.filter((block) => dateKey(new Date(block.startTime)) === day.key);
        return <View key={day.key} style={styles.dayGroup}>
          <View style={styles.dayHeader}><View><Text style={styles.dayTitle}>{day.label}</Text><Text style={styles.dayMeta}>{isCustom ? `Custom · ${activeHours?.startTime ?? ''}–${activeHours?.endTime ?? ''}` : timing ? `Default · ${timing.startTime}–${timing.endTime}` : 'No default timing set'}</Text></View><Text style={styles.dayCount}>{daySlots.length} available{dayBlocks.length ? ` · ${dayBlocks.length} blocked` : ''}</Text></View>
          {isCustom ? <><View style={styles.customControls}><View style={styles.timeField}><Field label="Start" value={activeHours?.startTime ?? ''} onChangeText={(value) => updateDay(day.key, { startTime: value })} editable={!busy} /></View><View style={styles.timeField}><Field label="End" value={activeHours?.endTime ?? ''} onChangeText={(value) => updateDay(day.key, { endTime: value })} editable={!busy} /></View><Pressable onPress={() => restoreDefault(day.key)} disabled={busy} style={styles.restore}><Text style={styles.restoreText}>Use default</Text></Pressable></View><Pressable onPress={() => updateDay(day.key, { isActive: !activeHours?.isActive })} disabled={busy} style={styles.activeToggle}><Ionicons name={activeHours?.isActive ? 'checkmark-circle' : 'close-circle-outline'} size={17} color={activeHours?.isActive ? colors.teal : colors.muted} /><Text style={styles.activeText}>{activeHours?.isActive ? 'Active for this date · tap to take the day off' : 'Day off · tap to reactivate'}</Text></Pressable></> : <Pressable onPress={() => customizeDay(day.key, day.dayOfWeek)} disabled={busy || !timing} style={styles.customize}><Ionicons name="add" size={17} color={colors.pink} /><Text style={styles.customizeText}>Set custom timing for this date</Text></Pressable>}
          <View style={styles.slotGrid}>{daySlots.map((slot) => <Pressable key={slot.startTime} onPress={() => toggleBlock(slot)} disabled={busy} style={styles.slot}><Text style={styles.slotTime}>{slotTime(slot.startTime)}</Text><Text style={styles.slotStatus}>Available · block</Text></Pressable>)}{dayBlocks.map((block) => <Pressable key={block.id} onPress={() => toggleBlock({ startTime: block.startTime, endTime: block.endTime })} disabled={busy} style={[styles.slot, styles.slotBlocked]}><Text style={styles.slotTime}>{slotTime(block.startTime)}</Text><Text style={[styles.slotStatus, styles.slotStatusBlocked]}>Blocked · restore</Text></Pressable>)}</View>
          {!daySlots.length && !dayBlocks.length ? <Text style={styles.emptyDay}>No appointment windows generated for this day.</Text> : null}
        </View>;
      })}</View>
      {hours.some((item) => !item.useDefault) ? <Button label="Save daily availability" onPress={() => saveHours(hours)} loading={busy} /> : null}
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  cardTitle: { color: colors.ink, fontWeight: '800', fontSize: 16 }, description: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }, timeFields: { flexDirection: 'row', gap: 10, marginTop: 14 }, timeField: { flex: 1 }, notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: '#CFECE6', backgroundColor: '#F2FBF9', borderRadius: 12, padding: 11 }, noticeText: { color: colors.ink, fontSize: 12, lineHeight: 17, flex: 1 }, dayList: { gap: 17, marginTop: 16 }, dayGroup: { gap: 11, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line }, dayHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 }, dayTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' }, dayMeta: { color: colors.muted, fontSize: 11, marginTop: 3 }, dayCount: { color: colors.teal, fontSize: 10, fontWeight: '800', textAlign: 'right' }, customize: { minHeight: 39, borderWidth: 1, borderColor: '#F6B2CC', borderRadius: 11, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4 }, customizeText: { color: colors.pink, fontSize: 12, fontWeight: '800' }, customControls: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, restore: { minHeight: 45, paddingHorizontal: 10, borderRadius: 10, justifyContent: 'center', backgroundColor: colors.pinkSoft }, restoreText: { color: colors.pink, fontSize: 11, fontWeight: '800' }, activeToggle: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3 }, activeText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, slot: { width: '47.8%', minHeight: 70, padding: 11, borderRadius: 13, borderWidth: 1, borderColor: '#B9E7DF', backgroundColor: '#fff', justifyContent: 'center' }, slotBlocked: { borderColor: '#F6B2CC', backgroundColor: colors.pinkSoft }, slotTime: { color: colors.ink, fontWeight: '800', fontSize: 13 }, slotStatus: { color: colors.teal, fontSize: 10, marginTop: 4, fontWeight: '700' }, slotStatusBlocked: { color: colors.danger }, emptyDay: { color: colors.muted, fontSize: 12, paddingVertical: 3 },
});
