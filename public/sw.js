/**
 * sw.js — Service Worker for GAIT MFDFA PWA
 *
 * Strategy:
 *   Python files (.py)        → always network-first (never stale)
 *   Pyodide CDN               → network-first (large, versioned)
 *   App shell (HTML/JS/CSS)   → network-first with cache fallback
 *
 * Safari note: Safari supports service workers since iOS 11.3.
 * No-cache meta tags + this SW ensure Python changes always land.
 */

const CACHE_VERSION = "gait-mfdfa-v1";

const PYTHON_PATTERN = /\.py(\?.*)?$/;
const PYODIDE_PATTERN = /cdn\.jsdelivr\.net\/pyodide/;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Always bypass cache for Python source files
  if (PYTHON_PATTERN.test(url)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.match(event.request)
      )
    );
    return;
  }

  // Pyodide CDN: network-first, long cache fallback
  if (PYODIDE_PATTERN.test(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        fetch(event.request)
          .then((resp) => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          })
          .catch(() => cache.match(event.request))
      )
    );
    return;
  }

  // App shell: network-first
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp.ok) {
          caches.open(CACHE_VERSION).then((c) =>
            c.put(event.request, resp.clone())
          );
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
