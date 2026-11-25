import React, { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { flushPendingMutations } from '../services/apiClient';
import {
  clearPendingMutations,
  QueuedMobileMutation,
  subscribePendingMutations,
} from '../services/offlineSyncQueue';

interface OfflineIndicatorProps {
  onSynced?: (syncedCount: number) => void;
  onNotify?: (msg: string, tone?: 'success' | 'error') => void;
}

export function OfflineIndicator({ onSynced, onNotify }: OfflineIndicatorProps) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [pendingItems, setPendingItems] = useState<QueuedMobileMutation[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const unsub = subscribePendingMutations(setPendingItems);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      unsub();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRetryNow = async () => {
    setRetrying(true);
    try {
      const res = await flushPendingMutations();
      if (res.syncedCount > 0) {
        onSynced?.(res.syncedCount);
        onNotify?.(
          `Synced ${res.syncedCount} pending mobile change${res.syncedCount === 1 ? '' : 's'} without duplicates.`,
          'success'
        );
      } else if (res.lastError) {
        onNotify?.(res.lastError, 'error');
      }
    } finally {
      setRetrying(false);
    }
  };

  if (isOnline && pendingItems.length === 0) {
    return null;
  }

  return (
    <div
      className={`border-b px-4 py-2.5 text-xs ${
        !isOnline
          ? 'border-amber-300 bg-amber-50 text-amber-950'
          : 'border-blue-200 bg-blue-50 text-blue-950'
      }`}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {!isOnline ? (
            <CloudOff className="h-4 w-4 shrink-0 text-amber-700" />
          ) : (
            <Wifi className="h-4 w-4 shrink-0 text-blue-700" />
          )}
          <span>
            {!isOnline
              ? 'You are currently offline. New field entries will be queued safely on this device and retried automatically once reconnected.'
              : `${pendingItems.length} pending mobile change${
                  pendingItems.length === 1 ? '' : 's'
                } waiting to sync safely to the server.`}
          </span>
        </div>

        {pendingItems.length > 0 && (
          <div className="flex items-center gap-2">
            {isOnline && (
              <button
                type="button"
                disabled={retrying}
                onClick={handleRetryNow}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0B1F3A] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#132f55] disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Retrying...' : `Retry Sync (${pendingItems.length})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                clearPendingMutations();
                onNotify?.('Cleared local pending queue.', 'success');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-red-700"
              title="Discard failed local queue items"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
