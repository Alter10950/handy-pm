"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import {
  formatNotificationMessage,
  notificationHref,
  type NotificationRow,
} from "@/lib/notifications/shared";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell({
  notifications,
}: {
  notifications: NotificationRow[];
}) {
  const [open, setOpen] = useState(false);
  // A pure additive overlay, not a copy of the prop — avoids needing to
  // keep local state in sync with server-refreshed data (see
  // lib/gates/shared.ts's sibling components for that pattern where it's
  // actually needed); here the prop is always rendered fresh, this just
  // layers "shown as read" on top until router.refresh() lands the real
  // read_at from the DB, at which point this overlay becomes redundant.
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const displayItems = notifications.map((notification) =>
    locallyRead.has(notification.id) && !notification.read_at
      ? { ...notification, read_at: new Date().toISOString() }
      : notification
  );
  const unreadCount = displayItems.filter((n) => !n.read_at).length;

  function handleItemClick(notification: NotificationRow) {
    setOpen(false);
    if (notification.read_at) return;
    setLocallyRead((current) => new Set(current).add(notification.id));
    markNotificationRead(notification.id)
      .then(() => router.refresh())
      .catch(() => {
        setLocallyRead((current) => {
          const next = new Set(current);
          next.delete(notification.id);
          return next;
        });
      });
  }

  function handleMarkAllRead() {
    setLocallyRead(new Set(displayItems.map((n) => n.id)));
    markAllNotificationsRead()
      .then(() => router.refresh())
      .catch(() => setLocallyRead(new Set()));
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={
          unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"
        }
        onClick={() => setOpen((value) => !value)}
        className="relative flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
      >
        <Bell className="size-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          data-testid="notification-dropdown"
          className="absolute right-0 top-11 z-20 w-80 max-w-[90vw] rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-foreground">
              Notifications
            </span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-primary hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {displayItems.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing here yet.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {displayItems.map((notification) => (
                <li
                  key={notification.id}
                  className="border-b border-border last:border-b-0"
                >
                  <Link
                    href={notificationHref(notification)}
                    onClick={() => handleItemClick(notification)}
                    className={cn(
                      "flex flex-col gap-0.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent",
                      !notification.read_at && "bg-primary/5"
                    )}
                  >
                    <span className="text-foreground">
                      {formatNotificationMessage(notification)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(notification.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
