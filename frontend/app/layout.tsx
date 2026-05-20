import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox, Mic, Sun, Users, LayoutDashboard } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CEO Assistant',
  description: 'NUtritunes & Ceylon Nutritionals',
};

const nav = [
  { href: '/', label: 'Today', icon: LayoutDashboard },
  { href: '/drafts', label: 'Drafts', icon: Inbox },
  { href: '/meetings', label: 'Meetings', icon: Mic },
  { href: '/briefings', label: 'Briefings', icon: Sun },
  { href: '/vips', label: 'VIPs', icon: Users },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex">
          <aside className="w-56 min-h-screen border-r border-[var(--border)] bg-white p-4">
            <div className="mb-8">
              <div className="text-sm uppercase tracking-wide text-[var(--ink-muted)]">CEO Assistant</div>
              <div className="text-base font-medium">Nalin · NJ</div>
            </div>
            <nav className="space-y-1">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[var(--ink)] hover:bg-[var(--bg)] transition"
                >
                  <Icon size={16} className="text-[var(--ink-muted)]" />
                  {label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 p-8 max-w-5xl">{children}</main>
        </div>
      </body>
    </html>
  );
}
