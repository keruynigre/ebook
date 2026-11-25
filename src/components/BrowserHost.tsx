import { useCallback, useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { HttpError, isChallengePage, registerBrowserBridge } from '../lib/http';
import { colors } from '../lib/theme';

/**
 * A WebView that lives behind the app. When a site blocks plain requests with a
 * "checking your browser" page, pages are fetched from inside this WebView, which
 * passes such checks like a normal browser. If the site wants the person to tick a
 * box, the WebView is shown on top of the app until the check is done.
 */

/**
 * react-native-webview's published prop types collapse to \`never\` with the
 * React Native 0.88 types, so the props used here are declared explicitly.
 */
type HostWebViewProps = {
  ref?: Ref<WebView>;
  source: { uri: string };
  style?: StyleProp<ViewStyle>;
  injectedJavaScript?: string;
  onMessage?: (e: WebViewMessageEvent) => void;
  onLoadEnd?: () => void;
  javaScriptEnabled?: boolean;
  domStorageEnabled?: boolean;
  thirdPartyCookiesEnabled?: boolean;
  sharedCookiesEnabled?: boolean;
  setSupportMultipleWindows?: boolean;
  mediaPlaybackRequiresUserAction?: boolean;
  originWhitelist?: string[];
};
const HostWebView = WebView as unknown as ComponentType<HostWebViewProps>;

const PAGE_PROBE = `
(function () {
  if (window.__ebookProbe) return;
  window.__ebookProbe = true;
  function challenged() {
    var t = document.title || '';
    return /Just a moment|Attention Required|Checking your browser|Bir dakika/i.test(t) ||
      !!document.querySelector('#challenge-form, #challenge-stage, #cf-challenge-running, .cf-turnstile, #turnstile-wrapper');
  }
  function report() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'page', url: location.href, challenge: challenged(), ready: document.readyState !== 'loading'
      }));
    } catch (e) {}
  }
  report();
  var n = 0;
  var timer = setInterval(function () { report(); if (++n > 300) clearInterval(timer); }, 1000);
  document.addEventListener('readystatechange', report);
})();
true;
`;

function fetchScript(id: number, url: string): string {
  return `
(function () {
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  fetch(${JSON.stringify(url)}, { credentials: 'include' })
    .then(function (r) { return r.text().then(function (t) { post({ type: 'fetch', id: ${id}, status: r.status, body: t }); }); })
    .catch(function (e) { post({ type: 'fetch', id: ${id}, error: String(e) }); });
})();
true;
`;
}

type PageMsg = { type: 'page'; url: string; challenge: boolean; ready: boolean };
type FetchMsg = { type: 'fetch'; id: number; status?: number; body?: string; error?: string };

interface Pending {
  resolve: (v: { status: number; body: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const READY_TIMEOUT_MS = 3 * 60 * 1000;
const SHOW_AFTER_MS = 4000;
const FETCH_TIMEOUT_MS = 60 * 1000;

export function BrowserHost() {
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);

  const page = useRef<{ origin: string; ready: boolean; challenge: boolean }>({ origin: '', ready: false, challenge: false });
  const readyWaiters = useRef<{ origin: string; resolve: () => void; reject: (e: Error) => void }[]>([]);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const flushWaiters = useCallback(() => {
    const p = page.current;
    if (!p.ready || p.challenge) return;
    const still: typeof readyWaiters.current = [];
    for (const w of readyWaiters.current) {
      if (w.origin === p.origin) w.resolve();
      else still.push(w);
    }
    readyWaiters.current = still;
    if (still.length === 0) setVisible(false);
  }, []);

  /** Loads `url` in the WebView (if needed) and waits until its site has let us in. */
  const openPage = useCallback(
    (url: string, force: boolean) =>
      new Promise<void>((resolve, reject) => {
        const origin = new URL(url).origin;
        const p = page.current;
        if (!force && p.origin === origin && p.ready && !p.challenge) {
          resolve();
          return;
        }
        page.current = { origin, ready: false, challenge: false };
        let showTimer: ReturnType<typeof setTimeout> | undefined;
        const giveUp = setTimeout(() => {
          cleanup();
          reject(new HttpError('Site doğrulaması zaman aşımına uğradı.'));
        }, READY_TIMEOUT_MS);
        const cleanup = () => {
          clearTimeout(giveUp);
          if (showTimer) clearTimeout(showTimer);
          readyWaiters.current = readyWaiters.current.filter((w) => w !== waiter);
        };
        const waiter = {
          origin,
          resolve: () => {
            cleanup();
            resolve();
          },
          reject: (e: Error) => {
            cleanup();
            reject(e);
          },
        };
        readyWaiters.current.push(waiter);
        // Only bother the person if the check doesn't pass on its own.
        showTimer = setTimeout(() => {
          if (page.current.challenge || !page.current.ready) setVisible(true);
        }, SHOW_AFTER_MS);
        if (loadedUrl.current === url) webRef.current?.reload();
        else {
          loadedUrl.current = url;
          setSourceUrl(url);
        }
      }),
    [],
  );

  const runFetch = useCallback(
    (url: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const id = nextId.current++;
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new HttpError('Sayfa zamanında yanıt vermedi.'));
        }, FETCH_TIMEOUT_MS);
        pending.current.set(id, { resolve, reject, timer });
        webRef.current?.injectJavaScript(fetchScript(id, url));
      }),
    [],
  );

  const fetchText = useCallback(
    (url: string): Promise<string> => {
      const task = async () => {
        await openPage(url, false);
        let res = await runFetch(url);
        if (isChallengePage(res.status, res.body)) {
          // The site wants a new check: open the page itself so the person can pass it.
          await openPage(url, true);
          res = await runFetch(url);
        }
        if (isChallengePage(res.status, res.body)) throw new HttpError('Site doğrulaması geçilemedi.');
        if (res.status >= 400) throw new HttpError(`Sayfa açılamadı (HTTP ${res.status}).`, res.status);
        return res.body;
      };
      const run = queue.current.then(task, task);
      queue.current = run.catch(() => undefined);
      return run;
    },
    [openPage, runFetch],
  );

  useEffect(() => {
    registerBrowserBridge({ fetchText });
    return () => registerBrowserBridge(null);
  }, [fetchText]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: PageMsg | FetchMsg;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'page') {
        let origin = '';
        try {
          origin = new URL(msg.url).origin;
        } catch {
          return;
        }
        if (origin !== page.current.origin) return;
        page.current = { origin, ready: msg.ready, challenge: msg.challenge };
        flushWaiters();
      } else if (msg.type === 'fetch') {
        const p = pending.current.get(msg.id);
        if (!p) return;
        pending.current.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new HttpError(`Bağlantı hatası: ${msg.error}`));
        else p.resolve({ status: msg.status ?? 0, body: msg.body ?? '' });
      }
    },
    [flushWaiters],
  );

  const cancel = useCallback(() => {
    for (const w of [...readyWaiters.current]) w.reject(new HttpError('Doğrulama iptal edildi.'));
    readyWaiters.current = [];
    setVisible(false);
  }, []);

  if (!sourceUrl) return null;

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={visible ? [styles.overlay, { paddingTop: insets.top }] : styles.hidden}
    >
      {visible && (
        <View style={styles.bar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.barTitle}>Site doğrulaması</Text>
            <Text style={styles.barText}>
              Site bir güvenlik kontrolü istiyor. Kutucuk varsa dokunun; geçince otomatik devam edilecek.
            </Text>
          </View>
          <Pressable onPress={cancel} style={styles.cancel} hitSlop={8}>
            <Text style={styles.cancelText}>İptal</Text>
          </Pressable>
        </View>
      )}
      <HostWebView
        ref={webRef}
        source={{ uri: sourceUrl }}
        style={{ flex: 1 }}
        injectedJavaScript={PAGE_PROBE}
        onMessage={onMessage}
        onLoadEnd={() => webRef.current?.injectJavaScript(PAGE_PROBE)}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction
        originWhitelist={['https://*', 'http://*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0.01 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, zIndex: 100, elevation: 100 },
  bar: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border },
  barTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  barText: { color: colors.muted, fontSize: 13, marginTop: 2 },
  cancel: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.border },
  cancelText: { color: colors.text, fontWeight: '600' },
});
