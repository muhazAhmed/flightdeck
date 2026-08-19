import type { UpdateStatus } from '@shared/types';
import { http } from '@/lib/http';

export interface ApplyResponse {
  message: string;
  detail?: string;
  status: UpdateStatus;
}

export const updateApi = {
  /** Local read: where this install stands with what it already knows. */
  get: () => http.get<UpdateStatus>('/api/update'),
  /** Contacts the remote. The only outbound request Flight Deck makes for itself. */
  check: () => http.post<UpdateStatus>('/api/update/check'),
  apply: () => http.post<ApplyResponse>('/api/update/apply')
};
