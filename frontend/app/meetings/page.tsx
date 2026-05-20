import Link from 'next/link';
import { api } from '@/lib/api';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  UPLOADED: 'text-[var(--ink-muted)]',
  TRANSCRIBING: 'text-amber-700',
  TRANSCRIBED: 'text-blue-700',
  EXTRACTING: 'text-blue-700',
  COMPLETED: 'text-emerald-700',
  FAILED: 'text-red-700',
};

export default async function MeetingsPage() {
  let meetings: any[] = [];
  let error: string | null = null;
  try {
    meetings = (await api.listMeetings()).meetings;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">Meetings</h1>
          <p className="text-sm text-[var(--ink-muted)] mt-1">
            Transcribed via AssemblyAI · extracted by Claude
          </p>
        </div>
        <Link
          href="/meetings/new"
          className="text-sm px-3 py-1.5 rounded bg-[var(--ink)] text-white"
        >
          Upload audio
        </Link>
      </header>

      {error && <div className="text-sm text-red-700">Backend error: {error}</div>}

      {meetings.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">No meetings processed yet.</p>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <li key={m.id} className="rounded-md border border-[var(--border)] bg-white p-4">
              <div className="flex justify-between items-start">
                <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">
                  {m.title}
                </Link>
                <span className={`text-xs font-mono ${statusColor[m.status] ?? ''}`}>{m.status}</span>
              </div>
              <div className="text-xs text-[var(--ink-muted)] mt-1">
                {format(new Date(m.meetingDate), 'PPpp')} · {m.businessUnit}
              </div>
              {m.summary && (
                <p className="text-sm mt-2 text-[var(--ink-muted)] line-clamp-2">{m.summary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
