import { api } from '@/lib/api';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export default async function BriefingsPage() {
  let briefings: any[] = [];
  try {
    briefings = (await api.listBriefings()).briefings;
  } catch {}

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Briefings</h1>
        <p className="text-sm text-[var(--ink-muted)] mt-1">
          Morning digests, EOD summaries, pre-meeting briefs
        </p>
      </header>

      {briefings.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">No briefings yet.</p>
      ) : (
        <ul className="space-y-4">
          {briefings.map((b) => (
            <li key={b.id} className="rounded-md border border-[var(--border)] bg-white p-4">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-mono text-[var(--ink-muted)]">{b.type}</span>
                <span className="text-xs text-[var(--ink-muted)]">
                  {format(new Date(b.generatedAt), 'PPpp')}
                </span>
              </div>
              <pre className="mt-3 text-[13px] whitespace-pre-wrap font-mono leading-relaxed">
                {b.bodyMarkdown}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
