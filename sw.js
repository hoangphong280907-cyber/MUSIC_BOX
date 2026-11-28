/* Service worker - Music Box Karaoke 3D Online
   - Lưu sẵn "khung app" (index.html, biểu tượng) để mở nhanh và mở được cả khi mất mạng.
   - Thư viện từ CDN (three.js, mqtt) được lưu lại sau lần tải đầu.
   - KHÔNG đụng tới YouTube, kết nối MQTT/WebRTC: để trình duyệt tự xử lý.
   Khi sửa index.html, đổi VERSION bên dưới để máy người dùng nhận bản mới. */
const VERSION = 'v1';
const SHELL_CACHE = 'mbk3d-shell-' + VERSION;
const RUNTIME_CACHE = 'mbk3d-runtime-' + VERSION;
const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map(f => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('mbk3d-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isCacheable = (res) => res && (res.ok || res.type === 'opaque');

// Trang chính: ưu tiên bản mới từ mạng, quá 4 giây hoặc mất mạng thì dùng bản đã lưu
async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    if (isCacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = (await cache.match(req)) || (await caches.match('index.html'));
    if (cached) return cached;
    throw err;
  }
}

// Tệp tĩnh: dùng bản đã lưu ngay, đồng thời cập nhật ngầm
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetching = fetch(req)
    .then(res => { if (isCacheable(res)) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return cached || (await fetching) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') event.respondWith(networkFirst(req, SHELL_CACHE, 4000));
    else event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
  }
  // Các nguồn khác (YouTube, broker MQTT...): không can thiệp
});
