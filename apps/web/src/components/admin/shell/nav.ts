/** The admin sidebar model. Every admin sees every area (the API has one admin role). Pure (tested). */
import { Boxes, Gauge, Link2, MessagesSquare, ScrollText, Settings2, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/interviews", label: "Interviews", icon: MessagesSquare },
  { href: "/admin/models", label: "Models", icon: Boxes },
  { href: "/admin/quotas", label: "Quotas", icon: SlidersHorizontal },
  { href: "/admin/shares", label: "Shared links", icon: Link2 },
  { href: "/admin/settings", label: "Settings", icon: Settings2 },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

/** The item a pathname belongs to: the longest matching href ("/admin" only matches itself). */
export function activeNavHref(pathname: string, items: readonly AdminNavItem[] = ADMIN_NAV): string | null {
  let best: string | null = null;
  for (const i of items) {
    const hit = i.href === "/admin" ? pathname === "/admin" || pathname === "/admin/" : pathname === i.href || pathname.startsWith(`${i.href}/`);
    if (hit && (!best || i.href.length > best.length)) best = i.href;
  }
  return best;
}

/** The page heading for the top bar on phones ("Users"). */
export function navLabel(pathname: string, items: readonly AdminNavItem[] = ADMIN_NAV): string {
  const href = activeNavHref(pathname, items);
  return items.find((i) => i.href === href)?.label ?? "Admin";
}
