import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError } from '../../src/api';
import type { NotificationItem, Page } from '../../src/types';
import { colors } from '../../src/theme';
import { Card, InlineError, Loader, Screen, Title } from '../../src/ui';

type NotificationPage = Page<NotificationItem> & { unreadCount: number };

export default function NotificationsScreen() {
  const [data, setData] = useState<NotificationPage | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); setData(await api<NotificationPage>('/api/notifications?page=1&limit=30')); } catch (caught) { setError((caught as ApiError).message); } }, []);
  useEffect(() => { load(); }, [load]);
  const markRead = async (item: NotificationItem) => { if (item.readAt) return; try { await api(`/api/notifications/${item.id}/read`, { method: 'PATCH' }); await load(); } catch (caught) { setError((caught as ApiError).message); } };
  if (!data && !error) return <Loader label="Loading notifications…" />;
  return <Screen><Title subtitle="Booking and session updates from AntarTalk.">Notifications</Title><InlineError message={error} retry={load} />{data?.items.length ? data.items.map((item) => <Pressable key={item.id} onPress={() => markRead(item)}><Card style={item.readAt ? styles.item : { ...styles.item, ...styles.unread }}><View style={styles.icon}><Ionicons name={item.readAt ? 'notifications-outline' : 'notifications'} color={colors.teal} size={19} /></View><View style={{ flex: 1 }}><Text style={styles.title}>{item.title}</Text><Text style={styles.body}>{item.body}</Text><Text style={styles.time}>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(item.createdAt))}</Text></View></Card></Pressable>) : <Card><Text style={styles.empty}>You are all caught up. New booking and session updates will appear here.</Text></Card>}</Screen>;
}
const styles = StyleSheet.create({ item: { flexDirection: 'row', gap: 12 }, unread: { backgroundColor: '#F5FCFB', borderColor: '#CFECE6' }, icon: { width: 37, height: 37, borderRadius: 19, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center' }, title: { color: colors.ink, fontSize: 14, fontWeight: '800' }, body: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, time: { color: colors.muted, fontSize: 10, marginTop: 8 }, empty: { color: colors.muted, fontSize: 13, lineHeight: 19 } });
