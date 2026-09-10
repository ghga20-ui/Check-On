self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("neis-subject-v1").then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon.svg"]))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});
