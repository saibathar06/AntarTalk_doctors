import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AuthScreen } from '../../src/auth-ui';
import { LoginPanel } from './login';
import { RegisterPanel } from './register';

export default function AuthIndex() {
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode === 'register' ? 'register' : 'login');
  return <AuthScreen mode={mode} onModeChange={setMode}>{mode === 'login' ? <LoginPanel onCreateAccount={() => setMode('register')} /> : <RegisterPanel />}</AuthScreen>;
}
