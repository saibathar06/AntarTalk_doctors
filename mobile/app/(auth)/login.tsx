import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { beginLogin, ApiError } from '../../src/api';
import { Button, InlineError } from '../../src/ui';
import { AuthCard, AuthField, AuthHeading, AuthScreen, PasswordField } from '../../src/auth-ui';
import { colors } from '../../src/theme';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPanel({ onCreateAccount }: { onCreateAccount?: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [emailError, setEmailError] = useState('');
  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailPattern.test(normalizedEmail)) { setEmailError('Enter the email address linked to your account.'); return; }
    if (!password) { setError('Enter your password to continue.'); return; }
    setBusy(true); setError(''); setEmailError('');
    try { const challenge = await beginLogin(normalizedEmail, password); router.push({ pathname: '/(auth)/verify', params: { token: challenge.challengeToken, email: challenge.email, purpose: challenge.purpose } }); }
    catch (caught) { setError((caught as ApiError).message); } finally { setBusy(false); }
  };
  return <><AuthHeading title="Welcome back" subtitle="Sign in to manage your practice, appointments, and sessions." /><AuthCard><AuthField label="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} onBlur={() => setEmailError(email && !emailPattern.test(email.trim()) ? 'Enter a valid email address.' : '')} error={emailError} placeholder="name@example.com" /><PasswordField value={password} onChangeText={setPassword} /><InlineError message={error} /><Button label="Continue securely" onPress={submit} loading={busy} disabled={!email || !password} /><Pressable onPress={() => router.push('/(auth)/forgot')} accessibilityRole="link" hitSlop={8}><Text style={{ color: colors.pink, textAlign: 'center', fontWeight: '800', marginTop: 3 }}>Forgot password?</Text></Pressable></AuthCard><Text style={{ textAlign: 'center', color: colors.muted, fontSize: 13 }}>New to AntarTalk? <Text onPress={onCreateAccount ?? (() => router.replace('/auth?mode=register'))} style={{ color: colors.pink, fontWeight: '800' }}>Create your professional account</Text></Text></>;
}

export default function Login() { return <AuthScreen mode="login"><LoginPanel /></AuthScreen>; }
