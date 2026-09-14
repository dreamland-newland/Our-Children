// ============================================================
//  서비스 워커 — «홈 화면에 추가» 가 뜨게 하고,
//  잠깐 인터넷이 끊겨도 교적부 화면이 열리게 합니다.
//  ------------------------------------------------------------
//  ★ 규칙은 하나뿐입니다: «늘 새 것을 먼저 가져온다.»
//    새로 올린 파일이 있으면 그걸 쓰고, 인터넷이 안 되면
//    마지막으로 성공했던 화면을 대신 보여 줍니다.
//    (오래된 화면이 남아 «수정이 반영 안 돼요» 가 되지 않도록)
//
//  자료(Supabase)와 사진은 캐시하지 않습니다 — 늘 최신을 받아옵니다.
// ============================================================
const CACHE = "kkumttang-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();                       // 새 워커를 기다리지 않고 바로 씁니다
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    "./",
    "./index.html",
    "./manifest.json",
    "./assets/css/style.css",
    "./assets/icons/favicon.png",
    "./assets/icons/icon-192.png",
  ]).catch(() => { /* 하나라도 없으면 그냥 넘어갑니다 */ })));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase·사진은 건드리지 않습니다

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-store" });   // ① 늘 새 것부터
      if (fresh && fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch {
      const hit = await caches.match(req);                     // ② 인터넷이 끊겼을 때
      if (hit) return hit;
      if (req.mode === "navigate") {
        const home = await caches.match("./index.html");
        if (home) return home;
      }
      throw new Error("offline");
    }
  })());
});
