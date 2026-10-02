import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { ApiError, resendOtp, verifyOtp } from '../../src/api';
import { useSession } from '../../src/auth';
import { AuthCard, AuthHeading, AuthScreen } from '../../src/auth-ui';
import { Button, InlineError } from '../../src/ui';
import { colors } from '../../src/theme';

function maskEmail(value?: string) { if (!value || !value.includes('@')) return 'your registered email'; const [local, domain] = value.split('@'); return `${local.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(5, local.length - 2)))}@${domain}`; }

export default function Verify() {
  const { token, email } = useLocalSearchParams<{ token: string; email: string }>();
  const { refreshProfile } = useSession(); const [otp, setOtp] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [left, setLeft] = useState(60);
  useEffect(() => { if (!left) return; const id = setInterval(() => setLeft((current) => Math.max(0, current - 1)), 1000); return () => clearInterval(id); }, [left]);
  const submit = async () => { if (!token) { router.replace('/auth'); return; } setBusy(true); setError(''); try { await verifyOtp(token, otp); await refreshProfile(); router.replace('/'); } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); } };
  const resend = async () => { if (!token || left) return; setBusy(true); setError(''); try { const result = await resendOtp(token); setLeft(result.retryAfterSeconds ?? 60); } catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); } };
  return <AuthScreen mode="login" showSwitcher={false}><View style={styles.icon}><Ionicons name="mail-open-outline" size={30} color={colors.teal} /></View><AuthHeading title="Check your inbox" subtitle="We sent a six-digit verification code to your registered email." /><AuthCard><View style={styles.emailRow}><Ionicons name="shield-checkmark-outline" color={colors.teal} size={18} /><Text style={styles.email}>{maskEmail(email)}</Text></View><View style={styles.codeWrap}><Text style={styles.label}>Verification code</Text><TextInput accessibilityLabel="Six digit verification code" value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus style={styles.codeInput} placeholder="000000" placeholderTextColor="#C4CAD4" /></View><InlineError message={error} /><Button label="Verify and continue" onPress={submit} loading={busy} disabled={otp.length !== 6} /><View style={styles.resend}><Text style={styles.resendHint}>{left ? `You can request another code in ${left}s` : 'Did not receive a code?'}</Text><Pressable onPress={resend} disabled={Boolean(left) || busy} hitSlop={8}><Text style={[styles.resendButton, (Boolean(left) || busy) && styles.resendDisabled]}>Resend code</Text></Pressable></View></AuthCard><Pressable onPress={() => router.replace('/auth')} hitSlop={10}><Text style={styles.back}>Use a different account</Text></Pressable></AuthScreen>;
}

const styles = StyleSheet.create({
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 1 }, emailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#F4FBFA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 }, email: { color: colors.ink, fontSize: 13, fontWeight: '700' }, codeWrap: { gap: 7 }, label: { color: colors.ink, fontSize: 13, fontWeight: '700' }, codeInput: { height: 62, borderRadius: 14, borderColor: colors.line, borderWidth: 1, color: colors.ink, backgroundColor: '#fff', fontSize: 25, fontWeight: '800', textAlign: 'center', paddingHorizontal: 0 }, resend: { alignItems: 'center', gap: 5, paddingTop: 1 }, resendHint: { color: colors.muted, fontSize: 12, textAlign: 'center' }, resendButton: { color: colors.pink, fontSize: 13, fontWeight: '800' }, resendDisabled: { color: '#A4ACBA' }, back: { color: colors.muted, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 2 }
});
