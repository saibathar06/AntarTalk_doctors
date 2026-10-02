import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api, authenticatedFileSource } from './api';
import { useSession } from './auth';
import { colors } from './theme';

type NotificationPage = { unreadCount: number };

export function DoctorBrand() {
  return <View style={styles.brand} accessibilityLabel="AntarTalk Professionals">
    <View style={styles.mark}><Ionicons name="heart" size={21} color="#fff" /></View>
    <View><Text style={styles.name}>AntarTalk</Text><Text style={styles.role}>PROFESSIONALS</Text></View>
  </View>;
}

export function DoctorHeaderActions() {
  const { profile } = useSession();
  const [imageFailed, setImageFailed] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => setImageFailed(false), [profile?.profileImageUrl]);
  useEffect(() => { let active = true; api<NotificationPage>('/api/notifications?page=1&limit=1').then((data) => { if (active) setUnread(data.unreadCount); }).catch(() => {}); return () => { active = false; }; }, []);
  const initials = `${profile?.firstName?.[0] ?? ''}${profile?.lastName?.[0] ?? ''}`.toUpperCase() || 'AT';
  return <View style={styles.actions}><Pressable accessibilityLabel="Open notifications" onPress={() => router.push('/(doctor)/notifications')} style={styles.bell} hitSlop={8}><Ionicons name="notifications-outline" color={colors.ink} size={21} />{unread ? <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}</Pressable><Pressable accessibilityLabel="Open your profile" onPress={() => router.navigate('/(doctor)/profile')} style={styles.avatar} hitSlop={8}>{profile?.profileImageUrl && !imageFailed ? <Image source={authenticatedFileSource(profile.profileImageUrl)} style={styles.avatarImage} onError={() => setImageFailed(true)} /> : <Text style={styles.initials}>{initials}</Text>}</Pressable></View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.ink, fontSize: 21, lineHeight: 23, fontWeight: '800', letterSpacing: -0.45 },
  role: { color: colors.teal, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.55, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 11 }, bell: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', position: 'relative' }, badge: { position: 'absolute', right: 1, top: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pink }, badgeText: { color: '#fff', fontSize: 8, fontWeight: '800' }, avatar: { width: 45, height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.tealSoft, borderWidth: 1, borderColor: '#D6EEE9' },
  avatarImage: { width: '100%', height: '100%' },
  initials: { color: colors.teal, fontSize: 13, fontWeight: '800' },
});
