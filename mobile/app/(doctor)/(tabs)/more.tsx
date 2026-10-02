import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSession } from '../../../src/auth';
import { colors } from '../../../src/theme';
import { Card, Screen, Title } from '../../../src/ui';

const links = [
  { label: 'My profile', detail: 'Personal details, photo and credentials', icon: 'person-circle-outline', path: '/(doctor)/profile' },
  { label: 'Clients', detail: 'People who have booked with your practice', icon: 'people-outline', path: '/(doctor)/clients' },
  { label: 'Earnings & payouts', detail: 'Session earnings, accounts and withdrawals', icon: 'wallet-outline', path: '/(doctor)/earnings' },
  { label: 'Notifications', detail: 'Appointment and practice updates', icon: 'notifications-outline', path: '/(doctor)/notifications' },
  { label: 'Settings & security', detail: 'Bookings, password, devices and account', icon: 'settings-outline', path: '/(doctor)/settings' }
] as const;

export default function MoreScreen() {
  const { profile } = useSession();
  return <Screen>
    <Title subtitle={`${profile?.professionalCategory?.replace('_', ' ') ?? 'Professional'} · ${profile?.verificationStatus ?? 'Pending review'}`}>More</Title>
    <Card style={styles.card}>{links.map((link, index) => <Pressable key={link.label} accessibilityRole="button" onPress={() => router.push(link.path)} style={[styles.item, index !== links.length - 1 && styles.border]}>
      <View style={styles.icon}><Ionicons name={link.icon} size={21} color={colors.teal} /></View><View style={styles.copy}><Text style={styles.label}>{link.label}</Text><Text style={styles.detail}>{link.detail}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.muted} />
    </Pressable>)}</Card>
  </Screen>;
}

const styles = StyleSheet.create({
  card: { paddingVertical: 2 }, item: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, border: { borderBottomWidth: 1, borderBottomColor: colors.line }, icon: { width: 41, height: 41, borderRadius: 14, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 3 }, label: { color: colors.ink, fontSize: 16, fontWeight: '800' }, detail: { color: colors.muted, fontSize: 12, lineHeight: 17 }
});
