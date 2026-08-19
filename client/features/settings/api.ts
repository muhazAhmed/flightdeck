import type { StorageUsage } from '@shared/types';
import { http } from '@/lib/http';

export const storageApi = {
  usage: () => http.get<StorageUsage>('/api/storage'),
  purgeAttachments: () => http.delete<{ deleted: number; freedBytes: number }>('/api/storage/attachments')
};
