import { useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { apiBaseUrl, authenticatedHeaders } from '../../../src/api';
import { Loader } from '../../../src/ui';

export default function CredentialDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id || !apiBaseUrl()) return <Loader label="Credential document is unavailable." />;
  return <WebView source={{ uri: `${apiBaseUrl()}/api/admin/doctors/${id}/license-document`, headers: authenticatedHeaders() }} startInLoadingState renderLoading={() => <Loader label="Loading credential document…" />} />;
}
