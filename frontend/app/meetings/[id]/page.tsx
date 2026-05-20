import { api } from '@/lib/api';
import { format } from 'date-fns';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MeetingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let meeting: any;
  try {
    meeting = await api.getMeeting(id);
  } catch {
    notFound();
  }
  if (!meeting) notFound();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{meeting.title}</h1>
        <p className="text-sm text-[var(--ink-muted)] mt-1">
          {format(new Date(meeting.meetingDate), 'PPpp')} · {meeting.businessUnit} ·{' '}
          <span className="font-mono">{meeting.status}</span>
        </p>
      </header>

      {meeting.summary && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-[var(--ink-muted)] mb-2">Summary</h2>
          <p className="text-sm leading-relaxed">{meeting.summary}</p>
        </section>
      )}

      {meeting.ceoCommitments?.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-[var(--ink-muted)] mb-2">
            CEO Commitments
          </h2>
          <ul className="space-y-2">
            {meeting.ceoCommitments.map((c: any, i: number) => (
              <li key={i} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="font-medium">{c.commitment}</div>
                <div className="text-xs text-[var(--ink-muted)] mt-1">
                  To: {c.recipient} · Due: {c.deadline}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meeting.keyDecisions?.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-[var(--ink-muted)] mb-2">
            Key Decisions
          </h2>
          <ul className="space-y-2">
            {meeting.keyDecisions.map((d: any, i: number) => (
              <li key={i} className="rounded border border-[var(--border)] bg-white p-3 text-sm">
                <div className="font-medium">{d.decision}</div>
                <div className="text-xs text-[var(--ink-muted)] mt-1">
                  Owner: {d.owner} · {d.context}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meeting.actionItems?.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-[var(--ink-muted)] mb-2">
            Action Items
          </h2>
          <ul className="space-y-1">
            {meeting.actionItems.map((a: any) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" defaultChecked={a.completed} className="mt-1" readOnly />
                <span className={a.completed ? 'line-through text-[var(--ink-muted)]' : ''}>
                  {a.text} <span className="text-[var(--ink-muted)]">— {a.owner}</span>
                  {a.dueDate && (
                    <span className="text-xs text-[var(--ink-muted)] ml-2">
                      ({format(new Date(a.dueDate), 'MMM d')})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meeting.openQuestions?.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-[var(--ink-muted)] mb-2">
            Open Questions
          </h2>
          <ul className="space-y-1 text-sm">
            {meeting.openQuestions.map((q: any, i: number) => (
              <li key={i}>
                {q.question} <span className="text-[var(--ink-muted)]">— {q.raisedBy}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meeting.transcriptText && (
        <details>
          <summary className="text-sm cursor-pointer text-[var(--ink-muted)] hover:text-[var(--ink)]">
            Show raw transcript
          </summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap bg-white border border-[var(--border)] rounded p-3 max-h-96 overflow-y-auto">
            {meeting.transcriptText}
          </pre>
        </details>
      )}
    </div>
  );
}
