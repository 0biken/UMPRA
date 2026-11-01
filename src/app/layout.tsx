import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Umpra — Autonomous Tournament Umpire",
  description: "Grassroots gaming tournaments umpired by AI and paid out via PayPal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
