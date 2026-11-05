import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { AppHeader, type SessionUser } from "@/components/layout/AppShell";
import { getSession } from "@/server/auth/session";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Umpra: autonomous tournament umpire",
  description:
    "Set up an 8-player tournament, verify match screenshots with AI, and release the prize pool via PayPal.",
};

/** Resolve the session on the server so the header renders the right links on first paint. */
async function loadHeaderUser(): Promise<SessionUser | null> {
  try {
    const user = await getSession();
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      paypalEmail: user.paypalEmail,
    };
  } catch {
    // A failed lookup shows the signed-out header; protected routes still enforce auth.
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await loadHeaderUser();
  return (
    <html lang="en" className={`${bricolage.variable} ${publicSans.variable}`}>
      <body className="min-h-screen bg-chalk text-ink antialiased">
        <ToastProvider>
          <AppHeader initialUser={user} />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
