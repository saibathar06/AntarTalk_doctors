import * as Device from 'expo-device';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, Linking, Platform } from 'react-native';
import { json, platform } from './api';

const expoGoPushUnavailable = 'Remote push notifications require an AntarTalk development or production build. They are unavailable in Expo Go.';

export async function registerPushNotifications() {
  if (!Device.isDevice) return { registered: false, reason: 'Push notifications require a physical device.' };
  try {
    // Expo Go removed Android remote-push support in SDK 53. Lazy-loading keeps
    // the entire app usable there, while dev/production builds still register.
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });
    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { registered: false, reason: 'Notifications are off. Enable them in your device Settings to receive appointment updates.' };
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await json('/api/notifications/devices', 'POST', { token, platform });
    return { registered: true, token };
  } catch {
    return { registered: false, reason: expoGoPushUnavailable };
  }
}
async function requirePermission(result: { granted: boolean; canAskAgain: boolean }, feature: string) {
  if (result.granted) return true;
  Alert.alert(`${feature} permission needed`, result.canAskAgain ? `Allow ${feature.toLowerCase()} to continue.` : `Enable ${feature.toLowerCase()} in device Settings to continue.`, result.canAskAgain ? [{ text: 'OK' }] : [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel', style: 'cancel' }]);
  return false;
}
export async function requestVideoPermissions() { const camera = await Camera.requestCameraPermissionsAsync(); const microphone = await Camera.requestMicrophonePermissionsAsync(); return (await requirePermission(camera, 'Camera')) && (await requirePermission(microphone, 'Microphone')); }
export async function chooseProfilePhoto() { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!(await requirePermission(permission, 'Photo library'))) return null; const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.82 }); if (result.canceled) return null; const asset = result.assets[0]; return { uri: asset.uri, name: asset.fileName ?? 'profile.jpg', mimeType: asset.mimeType ?? 'image/jpeg' }; }
export async function chooseCredentialDocument() { const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true }); if (result.canceled) return null; const asset = result.assets[0]; return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? (Platform.OS === 'ios' ? 'application/pdf' : 'application/octet-stream') }; }
