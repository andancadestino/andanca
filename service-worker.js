const CACHE_NAME = 'andanca-grandtour-v6';
const ESCOPO = self.registration.scope;
const CACHE_ESSENCIAL = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png', 'gt-sync-boot.js', 'gt-sync.js'];
const HOSTS_EXTERNOS = ['res.cloudinary.com', 'img.usecurling.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const TEMPO_REDE_NAVEGACAO_MS = 5000;
self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of CACHE_ESSENCIAL) {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[Andança SW] Não encontrado (opcional):', url); }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((c) => c !== CACHE_NAME).map((c) => caches.delete(c)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;
  if (req.method !== 'GET' || url.pathname.endsWith('/state.json') ||
      (!mesmaOrigem && !HOSTS_EXTERNOS.includes(url.hostname))) return;

  const navegacao = req.mode === 'navigate';
  // Todas as navegações compartilham uma única cópia da página (ignora ?v=, #, etc.)
  const chaveCache = navegacao ? new Request(ESCOPO) : req;

  evento.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const rede = fetch(req).then(async (resposta) => {
      if (resposta && (resposta.status === 200 || resposta.type === 'opaque')) {
        await cache.put(chaveCache, resposta.clone());
      }
      return resposta;
    });
    rede.catch(() => {});

    try {
      if (navegacao) {
        const emCache = await cache.match(chaveCache);
        if (!emCache) return await rede;
        // Com cópia local, não deixa uma conexão lenta travar a abertura do app
        const limite = new Promise((resolver) => setTimeout(() => resolver(emCache), TEMPO_REDE_NAVEGACAO_MS));
        return await Promise.race([rede, limite]);
      }
      return await rede;
    } catch (e) {
      const emCache = await cache.match(chaveCache);
      if (emCache) return emCache;
      if (navegacao) {
        return new Response('<h1 style="font-family:sans-serif;color:#C0623B">Andança — Grand Tour</h1><p style="font-family:sans-serif">Você está offline e o app ainda não foi aberto com internet neste aparelho. Conecte-se uma vez para habilitar o modo offline.</p>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('Recurso indisponível offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
self.addEventListener('message', (evento) => { if (evento.data && evento.data.acao === 'pularEspera') { self.skipWaiting(); } });