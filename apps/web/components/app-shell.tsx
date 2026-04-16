"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MarketRefreshButton } from "@/components/market-refresh-button";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Dashboard"
  },
  {
    href: "/history",
    label: "Archive"
  }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <div className="app-shell-inner">
          <div className="app-brand">
            <span className="app-brand-kicker">NSE research console</span>
            <div className="app-brand-title">Stock recommendation workspace</div>
          </div>

          <div className="app-shell-actions">
            <nav className="app-nav" aria-label="Primary">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === item.href || pathname.startsWith("/stocks/")
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`app-nav-link${isActive ? " active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <MarketRefreshButton
              buttonClassName="app-shell-refresh-button"
              containerClassName="app-shell-refresh"
              feedbackClassName="app-shell-refresh-feedback"
              idleLabel="Refresh all data"
              pendingLabel="Refreshing all data..."
            />
          </div>
        </div>
      </header>

      <div className="app-shell-body">{children}</div>
    </div>
  );
}
