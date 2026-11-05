"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flag, LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "host" | "player";
  paypalEmail?: string | null;
}

interface NavItem {
  href: string;
  label: string;
  /** Path prefix that marks this item as the current section. */
  match: string;
}

const HOST_NAV: NavItem[] = [
  { href: "/host", label: "My tournaments", match: "/host" },
  { href: "/host/new", label: "New tournament", match: "/host/new" },
];

const PLAYER_NAV: NavItem[] = [
  { href: "/play", label: "Open tournaments", match: "/play" },
];

function isCurrent(pathname: string | null, item: NavItem, items: NavItem[]): boolean {
  if (!pathname) return false;
  // "/host" must not stay highlighted on "/host/new".
  const moreSpecific = items.some(
    (other) =>
      other !== item &&
      other.match.startsWith(item.match) &&
      other.match.length > item.match.length &&
      (pathname === other.match || pathname.startsWith(`${other.match}/`))
  );
  if (moreSpecific) return false;
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}

function NavLinks({
  items,
  pathname,
  className,
}: {
  items: NavItem[];
  pathname: string | null;
  className?: string;
}) {
  return (
    <>
      {items.map((item) => {
        const current = isCurrent(pathname, item, items);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] px-3 type-small font-medium transition-colors duration-[var(--dur-fast)]",
              current ? "bg-pitch-tint text-pitch-dark" : "text-ink-2 hover:bg-chalk",
              className
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/**
 * The session comes from the server layout, so the right links render on the
 * first paint. Without `initialUser` the header resolves the session itself.
 */
export function AppHeader({ initialUser }: { initialUser?: SessionUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = React.useState<SessionUser | null | undefined>(initialUser);
  const [loggingOut, setLoggingOut] = React.useState(false);

  React.useEffect(() => {
    if (initialUser !== undefined) {
      setUser(initialUser);
      return;
    }
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [initialUser, pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const navItems = user?.role === "host" ? HOST_NAV : user?.role === "player" ? PLAYER_NAV : [];

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 type-h3 text-ink transition-colors duration-[var(--dur-fast)] hover:text-pitch"
          >
            <Flag className="h-5 w-5 text-pitch" strokeWidth={1.75} />
            <span>Umpra</span>
          </Link>

          {navItems.length > 0 && (
            <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
              <NavLinks items={navItems} pathname={pathname} />
            </nav>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {user === undefined ? null : user ? (
            <>
              <span className="inline-flex min-w-0 max-w-[10.5rem] items-center gap-1.5 rounded-full border border-line bg-chalk px-3 py-1 type-caption text-ink-2 sm:max-w-none">
                <UserIcon className="h-3.5 w-3.5 shrink-0 text-pitch" strokeWidth={1.75} />
                <span className="truncate">{user.displayName}</span>
                <span className="hidden text-muted sm:inline">({user.role})</span>
              </span>
              <Button
                variant="ghost"
                onClick={handleLogout}
                loading={loggingOut}
                aria-label="Sign out"
                className="px-3"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className="px-3">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild variant="secondary" className="px-3">
                <Link href="/register">Register</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {navItems.length > 0 && (
        <nav
          aria-label="Main navigation"
          className="border-t border-line md:hidden"
        >
          <div className="mx-auto flex max-w-[1120px] items-center gap-1 overflow-x-auto px-3 sm:px-5">
            <NavLinks items={navItems} pathname={pathname} />
          </div>
        </nav>
      )}
    </header>
  );
}
