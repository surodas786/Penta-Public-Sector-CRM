/**
 * The Activity Log tab of Activities & Follow-ups (FR-040, FR-041): every
 * activity on an opportunity the viewer can access, newest first, searched
 * and paginated on the server.
 */
import { useCallback, useState } from 'react';
import { MessageSquarePlusIcon, SearchIcon } from 'lucide-react';

import type { ActivityDto } from '../../../shared/api.js';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from '../../../shared/enums.js';
import { fetchActivities } from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { FilterSelect, inputCls } from '../../components/ui/FormFields';
import { Pagination } from '../../components/ui/Layout';
import { useApiResource } from '../useApiResource.js';
import { ActivityDialog } from './ActivityDialog.js';
import { ActivityTimeline } from './ActivityTimeline.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';

export function ActivityLogTab() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [mine, setMine] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ open: boolean; activity: ActivityDto | null }>({ open: false, activity: null });

  const list = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        fetchActivities(
          { q: q || undefined, type: type || undefined, authoredBy: mine || undefined, page, pageSize: 20 },
          signal,
        ),
      [q, type, mine, page],
    ),
    [q, type, mine, page],
  );

  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-4 py-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">Search</span>
          <span className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(event) => reset(() => setQ(event.target.value))}
              placeholder="Subject, notes or opportunity…"
              className={inputCls(undefined, 'h-9 pl-8 text-[13px]')}
            />
          </span>
        </label>
        <FilterSelect label="Type" value={type} onChange={(value) => reset(() => setType(value))} className="w-44">
          <option value="">All types</option>
          {ACTIVITY_TYPES.map((value) => (
            <option key={value} value={value}>
              {ACTIVITY_TYPE_LABELS[value]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Logged by" value={mine} onChange={(value) => reset(() => setMine(value))} className="w-44">
          <option value="">Everyone in scope</option>
          <option value="me">Me</option>
        </FilterSelect>
        <Button variant="primary" icon={<MessageSquarePlusIcon className="h-4 w-4" />} onClick={() => setDialog({ open: true, activity: null })}>
          Log Activity
        </Button>
      </div>

      {list.error ? (
        <div className="p-4">
          <ErrorPanel error={list.error} onRetry={list.reload} />
        </div>
      ) : !list.data ? (
        <div className="p-4">
          <LoadingPanel label="Loading activities…" />
        </div>
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No activities found" description="Log a meeting, call or visit to start the record." />
      ) : (
        <>
          <div className="px-4 pt-4">
            <ActivityTimeline activities={list.data.items} showOpportunity onEdit={(activity) => setDialog({ open: true, activity })} />
          </div>
          <Pagination
            page={list.data.page}
            pageCount={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
            total={list.data.total}
            pageSize={list.data.pageSize}
            onChange={setPage}
          />
        </>
      )}

      <ActivityDialog
        open={dialog.open}
        activity={dialog.activity}
        onClose={() => setDialog({ open: false, activity: null })}
        onDone={() => {
          setDialog({ open: false, activity: null });
          list.reload();
        }}
      />
    </>
  );
}
