/* Minimal SW to enable PWA install + fast reloads */
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());

// Optional: if you ever add notifications, this will focus an open client
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = all.find(c => "focus" in c);
    if (client) return client.focus();
    return self.clients.openWindow("/");
  })());
});

