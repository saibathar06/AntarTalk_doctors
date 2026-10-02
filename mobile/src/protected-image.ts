import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { apiBaseUrl, authenticatedHeaders } from './api';

// React Native's Image loader is inconsistent about Authorization headers across
// platforms. Downloading the already-authorized private image into cache gives
// Image a normal local URI without making profile files public.
export function useProtectedImage(path: string | null | undefined) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUri(null); setFailed(false);
    if (!path || !apiBaseUrl()) return;
    const filename = path.split('/').at(-1);
    if (!filename || !/^[a-f0-9-]{36}\.jpg$/i.test(filename)) { setFailed(true); return; }
    const destination = new File(Paths.cache, `antartalk-profile-${filename}`);
    void File.downloadFileAsync(`${apiBaseUrl()}${path}`, destination, { headers: authenticatedHeaders(), idempotent: true })
      .then((file) => { if (active) setUri(file.uri); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [path]);
  return { uri, failed };
}
