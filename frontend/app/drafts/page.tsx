'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Check, X, Edit3 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { drafts } = await api.listPendingDrafts();
      setDrafts(drafts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(draft: any) {
    const edited = editing === draft.id ? editBody : undefined;
    await api.approveDraft(draft.id, edited);
    setEditing(null);
    await load();
  }

  async function reject(draft: any) {
    const reason = window.prompt('Rejection reason?');
    if (!reason) return;
    await api.rejectDraft(draft.id, reason);
    await load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Drafts</h1>
        <p className="text-sm text-[var(--ink-muted)] mt-1">
          {drafts.length} pending · review and approve to send
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : drafts.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">Inbox zero on drafts. 🎉</p>
      ) : (
        <ul className="space-y-4">
          {drafts.map((d) => (
            <li key={d.id} className="rounded-md border border-[var(--border)] bg-white">
              <header className="border-b border-[var(--border)] p-4 flex justify-between items-start">
                <div>
                  <div className="font-medium">{d.email.subject}</div>
                  <div className="text-xs text-[var(--ink-muted)] mt-1">
                    To: {d.email.from} · <span className="font-mono">{d.email.category}</span> ·{' '}
                    <span className="font-mono">{d.email.businessUnit}</span> ·{' '}
                    {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (editing === d.id) {
                        setEditing(null);
                      } else {
                        setEditing(d.id);
                        setEditBody(d.bodyText);
                      }
                    }}
                    className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--bg)] flex items-center gap-1"
                  >
                    <Edit3 size={12} /> Edit
                  </button>
                  <button
                    onClick={() => reject(d)}
                    className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50 flex items-center gap-1"
                  >
                    <X size={12} /> Reject
                  </button>
                  <button
                    onClick={() => approve(d)}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--ink)] text-white hover:bg-[var(--ink-muted)] flex items-center gap-1"
                  >
                    <Check size={12} /> Approve & send
                  </button>
                </div>
              </header>

              <div className="p-4 grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wide text-[var(--ink-muted)] mb-2">
                    Original
                  </div>
                  <div className="text-sm whitespace-pre-wrap text-[var(--ink-muted)] max-h-64 overflow-y-auto">
                    {d.email.bodyText.slice(0, 1500)}
                    {d.email.bodyText.length > 1500 && '…'}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-[var(--ink-muted)] mb-2">
                    Draft (Claude {d.modelUsed})
                  </div>
                  {editing === d.id ? (
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="w-full h-64 p-2 text-sm font-mono border border-[var(--border)] rounded"
                    />
                  ) : (
                    <div className="text-sm whitespace-pre-wrap">{d.bodyText}</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
