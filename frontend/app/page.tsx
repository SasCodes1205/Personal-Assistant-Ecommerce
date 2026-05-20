import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';

async function getData() {
  // Tolerate offline backend during build/dev
  try {
    const [drafts, meetings, briefings] = await Promise.all([
      api.listPendingDrafts(),
      api.listMeetings(),
      api.listBriefings(),
    ]);
    return { drafts: drafts.drafts, meetings: meetings.meetings, briefings: briefings.briefings };
  } catch (e) {
    return { drafts: [], meetings: [], briefings: [], error: (e as Error).message };
  }
}

export default async function Home() {
  const { drafts, meetings, briefings, error } = await getData();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-[var(--ink-muted)] mt-1">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Backend unreachable: {error}
        </div>
      )}

      <section className="grid grid-cols-3 gap-4">
        <StatCard label="Drafts awaiting approval" value={drafts.length} href="/drafts" />
        <StatCard label="Meetings processed (7d)" value={meetings.length} href="/meetings" />
        <StatCard label="Briefings (total)" value={briefings.length} href="/briefings" />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Latest briefing</h2>
        {briefings[0] ? (
          <article className="prose prose-sm max-w-none rounded-md border border-[var(--border)] bg-white p-4 whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
            {briefings[0].bodyMarkdown}
          </article>
        ) : (
          <p className="text-sm text-[var(--ink-muted)]">No briefings yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Top pending drafts</h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">No drafts pending.</p>
        ) : (
          <ul className="space-y-2">
            {drafts.slice(0, 5).map((d: any) => (
              <li key={d.id} className="rounded-md border border-[var(--border)] bg-white p-3">
                <div className="flex justify-between items-baseline">
                  <Link href="/drafts" className="font-medium hover:underline">
                    {d.email.subject}
                  </Link>
                  <span className="text-xs text-[var(--ink-muted)]">
                    {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-xs text-[var(--ink-muted)] mt-1">
                  To: {d.email.from} · {d.email.category}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[var(--border)] bg-white p-4 hover:border-[var(--ink-muted)] transition"
    >
      <div className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
    </Link>
  );
}
