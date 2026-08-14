self.addEventListener("push", (event) => {
  let data = {
    title: "Trading Command Center",
    body: "A new PAPER trading notification is available.",
    url: "/?section=Notifications",
  };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* Safe generic fallback. */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: data.tag || "trading-command-center",
      renotify: Boolean(data.renotify),
      data: { url: data.url || "/?section=Notifications" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/?section=Notifications",
    self.location.origin,
  ).href;
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const existing = windows.find((client) =>
          client.url.startsWith(self.location.origin),
        );
        return existing
          ? existing.navigate(target).then(() => existing.focus())
          : clients.openWindow(target);
      }),
  );
});
