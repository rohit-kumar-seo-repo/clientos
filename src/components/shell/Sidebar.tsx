"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// V1 primary nav — Reports is still a deferred phase
const PRIMARY_NAV = [
  { href: "/", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/work", label: "Work" },
  { href: "/payments", label: "Payments" },
  { href: "/calendar", label: "Calendar" },
];

// V1 management nav — Reminder Rules, Team, Integrations are deferred
const MANAGEMENT_NAV = [
  { href: "/services", label: "Services" },
];

// V1 settings nav — Razorpay, Notifications, Preferences are deferred
const SETTINGS_NAV = [
  { href: "/settings/organization", label: "Organization" },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroup({
  heading,
  items,
  pathname,
}: {
  heading?: string;
  items: { href: string; label: string }[];
  pathname: string;
}) {
  return (
    <div className="mb-6">
      {heading && (
        <p className="mb-2 px-3 text-xs font-medium tracking-wide text-neutral-400">
          {heading}
        </p>
      )}
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
                  : "rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-3">
        <div className="h-6 w-6 rounded-md bg-neutral-900" />
        <span className="text-sm font-semibold text-neutral-900">ClientOS</span>
      </div>
      <NavGroup items={PRIMARY_NAV} pathname={pathname} />
      <NavGroup heading="MANAGEMENT" items={MANAGEMENT_NAV} pathname={pathname} />
      <NavGroup heading="SETTINGS" items={SETTINGS_NAV} pathname={pathname} />
    </aside>
  );
}
