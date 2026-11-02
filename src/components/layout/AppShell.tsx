"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flag, LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "host" | "player";
  paypalEmail?: string | null;
}

export function AppHeader({ initialUser }: { initialUser?: SessionUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = React.useState<SessionUser | null>(
    initialUser ?? null
  );
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
        if (!cancelled && data?.user) {
          setUser(data.user);
        }
      })
      .catch(() => undefined);
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

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 type-h3 text-ink hover:text-pitch transition-colors"
          >
            <Flag className="h-5 w-5 text-pitch" strokeWidth={1.75} />
            <span>Umpra</span>
          </Link>

          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1 sm:gap-2">
            {user?.role === "host" && (
              <>
                <Link
                  href="/host"
                  className={`inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-2.5 py-1.5 type-small font-medium transition-colors ${
                    pathname?.startsWith("/host")
                      ? "bg-pitch-tint text-pitch-dark"
                      : "text-ink-2 hover:bg-chalk"
                  }`}
                >
                  My tournaments
                </Link>
                <Link
                  href="/host/new"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-2.5 py-1.5 type-small font-medium text-ink-2 hover:bg-chalk transition-colors"
                >
                  New tournament
                </Link>
              </>
            )}
            <Link
              href="/play"
              className={`inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-2.5 py-1.5 type-small font-medium transition-colors ${
                pathname?.startsWith("/play")
                  ? "bg-pitch-tint text-pitch-dark"
                  : "text-ink-2 hover:bg-chalk"
              }`}
            >
              Open tournaments
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-chalk px-3 py-1 type-caption text-ink-2">
                <UserIcon className="h-3.5 w-3.5 text-pitch" strokeWidth={1.75} />
                <span>{user.displayName}</span>
                <span className="text-muted">({user.role})</span>
              </span>
              <Button
                variant="ghost"
                size="compact"
                onClick={handleLogout}
                loading={loggingOut}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4 sm:mr-1.5" strokeWidth={1.75} />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="compact">
                  Sign in
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="secondary" size="compact">
                  Register
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
