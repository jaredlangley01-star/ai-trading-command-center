"use client";
import { useCallback, useEffect, useState } from "react";
import {
  criticalProtectedTypes,
  defaultNotificationPreferences,
  notificationTypes,
  type NotificationPreferences,
  type NotificationType,
} from "@/src/services/notifications/policy";

const labels: Record<NotificationType, string> = Object.fromEntries(
  notificationTypes.map((type) => [
    type,
    type.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase()),
  ]),
) as Record<NotificationType, string>;
const visibleTypes = notificationTypes.filter(
  (type) =>
    ![
      "TEST",
      "ORDER_SUBMITTED",
      "ORDER_REJECTED",
      "PROTECTIVE_EXIT_FAILURE",
    ].includes(type),
);
function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
function normalizePreferences(
  value: Partial<NotificationPreferences> | null | undefined,
): NotificationPreferences {
  return {
    ...defaultNotificationPreferences,
    ...value,
    types: {
      ...defaultNotificationPreferences.types,
      ...(value?.types ?? {}),
    },
  };
}

export function NotificationSettingsWorkspace() {
  const [preferences, setPreferences] = useState(
      defaultNotificationPreferences,
    ),
    [status, setStatus] = useState(""),
    [supported, setSupported] = useState(true),
    [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    const available =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (!available) queueMicrotask(() => setSupported(false));
    fetch("/api/notification-preferences")
      .then((r) => r.json())
      .then((value) => setPreferences(normalizePreferences(value)))
      .catch(() => setStatus("Preferences unavailable"));
    navigator.serviceWorker
      ?.register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(Boolean(subscription)))
      .catch(() => setSupported(false));
  }, []);
  const save = async (
    next: NotificationPreferences,
    criticalAcknowledged = false,
  ) => {
    const response = await fetch("/api/notification-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences: next, criticalAcknowledged }),
    });
    if (
      response.status === 409 &&
      confirm(
        "This disables a critical safety alert. Acknowledge that you may not receive this alert?",
      )
    )
      return save(next, true);
    if (!response.ok) {
      setStatus("Could not save preferences");
      return;
    }
    setPreferences(next);
    setStatus("Notification preferences saved");
  };
  const subscribe = async () => {
    if (!supported) {
      setStatus(
        "Web Push is unavailable in this browser. In-app notifications remain available.",
      );
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notification permission was not granted.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const keys = await fetch("/api/push/subscriptions").then((r) => r.json());
    if (!keys.publicKey) {
      setStatus("VAPID public key is not configured.");
      return;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(keys.publicKey),
    });
    const response = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...subscription.toJSON(),
        deviceName: navigator.platform || "Owner device",
      }),
    });
    if (response.ok) {
      setSubscribed(true);
      const next = { ...preferences, pushEnabled: true };
      await save(next);
      setStatus("Device subscribed. You can now send a safe test.");
    } else setStatus("Device subscription failed.");
  };
  const unsubscribe = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    setSubscribed(false);
    await save({ ...preferences, pushEnabled: false });
  };
  const test = async () => {
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    setStatus(
      response.ok
        ? "Safe test queued. No broker action was taken."
        : "Test notification could not be queued.",
    );
  };
  return (
    <div className="strategy-workspace notification-settings-workspace">
      <section className="module">
        <header className="module-head">
          <div>
            <span className="section-label">MOBILE / PWA SETUP</span>
            <h2>Hosted Push Notifications</h2>
            <p>
              1. Install this site to your home screen. 2. Enable notifications.
              3. Subscribe this device. 4. Send a safe test.
            </p>
          </div>
          <span className={`status ${subscribed ? "good" : "warn"}`}>
            {subscribed
              ? "DEVICE SUBSCRIBED"
              : supported
                ? "NOT SUBSCRIBED"
                : "BROWSER UNAVAILABLE"}
          </span>
        </header>
        <div className="modal-actions">
          <button className="primary" onClick={subscribe} disabled={subscribed}>
            Enable & Subscribe
          </button>
          <button onClick={test} disabled={!subscribed}>
            Send Safe Test
          </button>
          <button
            className="danger-outline"
            onClick={unsubscribe}
            disabled={!subscribed}
          >
            Remove Device
          </button>
        </div>
        {status && <p className="paper-warning">{status}</p>}
      </section>
      <section className="module">
        <header className="module-head">
          <div>
            <span className="section-label">GLOBAL CONTROLS</span>
            <p>
              Critical notifications bypass quiet hours, but never bypass an
              explicitly disabled preference.
            </p>
          </div>
        </header>
        <div className="auto-config-grid">
          <label className="toggle-row">
            <span>Enable Push Notifications</span>
            <input
              type="checkbox"
              checked={preferences.pushEnabled}
              onChange={(e) =>
                void save({ ...preferences, pushEnabled: e.target.checked })
              }
            />
          </label>
          <label className="toggle-row">
            <span>Critical Alerts Only</span>
            <input
              type="checkbox"
              checked={preferences.criticalOnly}
              onChange={(e) =>
                void save({ ...preferences, criticalOnly: e.target.checked })
              }
            />
          </label>
          <label>
            <span>Minimum Opportunity Score</span>
            <input
              type="number"
              min="0"
              max="100"
              value={preferences.minimumOpportunityScore}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  minimumOpportunityScore: Number(e.target.value),
                })
              }
              onBlur={() => void save(preferences)}
            />
          </label>
          <label>
            <span>Cooldown (minutes)</span>
            <input
              type="number"
              min="0"
              value={preferences.cooldownMinutes}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  cooldownMinutes: Number(e.target.value),
                })
              }
              onBlur={() => void save(preferences)}
            />
          </label>
          <label className="toggle-row">
            <span>Quiet Hours</span>
            <input
              type="checkbox"
              checked={preferences.quietHoursEnabled}
              onChange={(e) =>
                void save({
                  ...preferences,
                  quietHoursEnabled: e.target.checked,
                })
              }
            />
          </label>
          <label>
            <span>Quiet Start</span>
            <input
              type="time"
              value={preferences.quietHoursStart}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  quietHoursStart: e.target.value,
                })
              }
              onBlur={() => void save(preferences)}
            />
          </label>
          <label>
            <span>Quiet End</span>
            <input
              type="time"
              value={preferences.quietHoursEnd}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  quietHoursEnd: e.target.value,
                })
              }
              onBlur={() => void save(preferences)}
            />
          </label>
          <label>
            <span>Timezone</span>
            <input
              value={preferences.timezone}
              onChange={(e) =>
                setPreferences({ ...preferences, timezone: e.target.value })
              }
              onBlur={() => void save(preferences)}
            />
          </label>
        </div>
      </section>
      <section className="module">
        <header className="module-head">
          <div>
            <span className="section-label">ALERT CATEGORIES</span>
            <p>
              Shielded alerts require explicit acknowledgement before disabling.
            </p>
          </div>
        </header>
        <div className="auto-config-grid">
          {visibleTypes.map((type) => (
            <label className="toggle-row" key={type}>
              <span>
                {labels[type]}{" "}
                {criticalProtectedTypes.includes(type) ? "(Protected)" : ""}
              </span>
              <input
                type="checkbox"
                checked={preferences.types[type]}
                onChange={(e) =>
                  void save({
                    ...preferences,
                    types: { ...preferences.types, [type]: e.target.checked },
                  })
                }
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

type CenterItem = {
  id: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  deep_link: string;
  status: string;
  created_at: string;
  read: boolean;
};
export function NotificationCenterWorkspace() {
  const [items, setItems] = useState<CenterItem[]>([]),
    [unread, setUnread] = useState(0),
    [category, setCategory] = useState(""),
    [severity, setSeverity] = useState("");
  const refresh = useCallback(async () => {
    const query = new URLSearchParams();
    if (category) query.set("category", category);
    if (severity) query.set("severity", severity);
    const data = await fetch(`/api/notifications?${query}`, {
      cache: "no-store",
    }).then((r) => r.json());
    setItems(data.notifications ?? []);
    setUnread(data.unreadCount ?? 0);
  }, [category, severity]);
  useEffect(() => {
    const initial = window.setTimeout(refresh, 0);
    const timer = setInterval(refresh, 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  const mark = async (ids: string[], all = false) => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: all ? "read_all" : "read", ids }),
    });
    await refresh();
  };
  return (
    <div className="strategy-workspace notification-center-workspace">
      <section className="module notification-center-panel">
        <header className="module-head">
          <div>
            <span className="section-label">NOTIFICATION CENTER</span>
            <h2>{unread} unread</h2>
          </div>
          <button onClick={() => void mark([], true)}>Mark all as read</button>
        </header>
        <div className="strategy-controls">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            <option>TRADE</option>
            <option>RISK</option>
            <option>RESEARCH</option>
            <option>INFRASTRUCTURE</option>
            <option>SYSTEM</option>
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">All severities</option>
            <option>INFO</option>
            <option>WARNING</option>
            <option>CRITICAL</option>
          </select>
        </div>
        <div className="notification-list">
          {items.map((item) => (
            <article
              className={`notification-item severity-${item.severity.toLowerCase()} ${item.read ? "is-read" : "is-unread"}`}
              key={item.id}
            >
              <span className="notification-severity-icon" aria-hidden="true">
                {item.severity === "CRITICAL"
                  ? "!"
                  : item.severity === "WARNING"
                    ? "△"
                    : "i"}
              </span>
              <div>
                <div className="notification-meta">
                  <span>{item.category}</span>
                  <span>{item.severity}</span>
                  <span>DELIVERY: {item.status}</span>
                  {!item.read && <b>UNREAD</b>}
                </div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
              <div>
                <a href={item.deep_link}>Open</a>
                {!item.read && (
                  <button onClick={() => void mark([item.id])}>
                    Mark read
                  </button>
                )}
              </div>
            </article>
          ))}
          {!items.length && (
            <div className="notification-empty">
              <b>ALL CLEAR</b>
              <p>No notifications match the selected filters.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function DashboardNotificationSummary() {
  const [items, setItems] = useState<CenterItem[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/notifications", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data: { notifications?: CenterItem[] }) =>
        setItems((data.notifications ?? []).slice(0, 3)),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <section className="module dashboard-notifications">
      <header className="module-head">
        <div>
          <span className="section-label">NOTIFICATIONS</span>
          <p>Latest owner alerts and delivery state</p>
        </div>
        <span className="status-badge">
          {items.filter((item) => !item.read).length} UNREAD
        </span>
      </header>
      <div className="dashboard-notification-list">
        {items.map((item) => (
          <article
            key={item.id}
            className={`severity-${item.severity.toLowerCase()}`}
          >
            <b>{item.title}</b>
            <span>
              {item.category} · {item.status}
            </span>
            <time>{new Date(item.created_at).toLocaleTimeString()}</time>
          </article>
        ))}
        {!items.length && <p>No current notifications.</p>}
      </div>
    </section>
  );
}
