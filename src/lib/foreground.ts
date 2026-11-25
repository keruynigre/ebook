import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

/** Native side lives in modules/ebook-foreground (Android only). */
interface EbookForegroundModule {
  start(title: string, text: string): boolean;
  update(title: string, text: string, progress: number, max: number): void;
  stop(): void;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<EbookForegroundModule>('EbookForeground') : null;

let asked = false;

/** Android 13+ needs permission to show the progress notification. */
async function askForNotifications() {
  if (asked || Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  asked = true;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // Without it the download still runs; only the notification is hidden.
  }
}

export async function startForeground(title: string, text: string): Promise<void> {
  if (!native) return;
  await askForNotifications();
  native.start(title, text);
}

export function updateForeground(title: string, text: string, progress: number, max: number): void {
  native?.update(title, text, progress, max);
}

export function stopForeground(): void {
  native?.stop();
}
