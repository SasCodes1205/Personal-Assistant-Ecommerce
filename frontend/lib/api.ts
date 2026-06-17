const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // Emails
  listEmails: (category?: string) =>
    request<{ emails: any[] }>(`/emails${category ? `?category=${category}` : ''}`),
  listPendingDrafts: () =>
    request<{ drafts: any[] }>('/emails/drafts/pending'),
  approveDraft: (id: string, editedBody?: string) =>
    request(`/emails/drafts/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ editedBody }),
    }),
  rejectDraft: (id: string, reason: string) =>
    request(`/emails/drafts/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Meetings
  listMeetings: () => request<{ meetings: any[] }>('/meetings'),
  getMeeting: (id: string) => request<any>(`/meetings/${id}`),
  ingestMeeting: (payload: any) =>
    request('/meetings/ingest', { method: 'POST', body: JSON.stringify(payload) }),
  completeActionItem: (id: string) =>
    request(`/meetings/action-items/${id}/complete`, { method: 'POST' }),

  // Briefings
  listBriefings: () => request<{ briefings: any[] }>('/briefings'),
  generateMorning: () => request('/briefings/morning', { method: 'POST' }),

  // VIPs
  listVips: () => request<{ vips: any[] }>('/vips'),
  addVip: (vip: any) =>
    request('/vips', { method: 'POST', body: JSON.stringify(vip) }),
  deleteVip: (id: string) => request(`/vips/${id}`, { method: 'DELETE' }),
};
