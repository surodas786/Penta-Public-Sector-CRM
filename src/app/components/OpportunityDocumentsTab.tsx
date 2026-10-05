/**
 * An opportunity's Documents tab — the approved upload form and table, backed
 * by private server storage (SEC-010, SEC-011). Nothing is kept in the
 * browser: files stream to the server, and every download is an authorized
 * request that works only while the session can see the opportunity.
 *
 * A file can be downloaded only after a clean scan. The scan state is shown
 * on every revision, and the development test scanner is labelled as such.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArchiveIcon, DownloadIcon, FileIcon, PaperclipIcon, UploadIcon } from 'lucide-react';

import type { DocumentDto, DocumentPolicyDto, DocumentRevisionDto, StagedUploadDto } from '../../../shared/api.js';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from '../../../shared/enums.js';
import { ApiRequestError } from '../../api/client.js';
import {
  archiveDocument,
  documentDownloadUrl,
  fetchDocument,
  fetchDocumentPolicy,
  finalizeDocumentUpload,
  stageDocumentUpload,
  type fetchOpportunityDocuments,
} from '../../api/endpoints.js';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Field, inputCls } from '../../components/ui/FormFields';
import { tdCls, thCls } from '../../components/ui/Layout';
import { Modal } from '../../components/ui/Modal';
import { formatInstant, formatInstantCompact } from '../ui/dates.js';
import { ScanStateBadge } from '../ui/TenderBadges.js';
import { useApiResource } from '../useApiResource.js';
import { useSubmission } from '../useSubmission.js';
import { ErrorPanel, LoadingPanel } from './Feedback.js';
import { DialogAlert } from './FormBits.js';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UNAVAILABLE_REASON: Record<string, string> = {
  pending: 'Waiting for the malware scan. It can be downloaded once the scan passes.',
  failed: 'The scan could not check this file. Upload it again as a new revision.',
  infected: 'Rejected by the malware scan. It cannot be downloaded.',
};

/**
 * Stages the bytes once, then finalizes with the submission's idempotency
 * key. A retry after an uncertain failure reuses both the staged upload and
 * the key, so it can never create a second document.
 */
function useUpload(opportunityId: string) {
  const submission = useSubmission();
  const staged = useRef<{ file: File; upload: StagedUploadDto } | null>(null);

  const upload = async (file: File, body: { category?: string; documentId?: string; note?: string }) =>
    submission.run(async (key) => {
      if (!staged.current || staged.current.file !== file) {
        staged.current = { file, upload: await stageDocumentUpload(opportunityId, file) };
      }
      const result = await finalizeDocumentUpload(staged.current.upload.uploadId, body, key);
      staged.current = null;
      return result;
    });

  return { submission, upload };
}

function uploadPolicyText(policy: DocumentPolicyDto | null): string | undefined {
  if (!policy) return undefined;
  const scanning =
    policy.scanner === 'none'
      ? 'No malware scanner is configured, so uploaded files are kept but cannot be downloaded yet.'
      : 'Checked by the development test scanner before download — this is not real malware scanning.';
  return `Stored privately on the server. PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG or JPEG, up to ${formatFileSize(policy.maxUploadBytes)}. ${scanning}`;
}

export function DocumentsTab({
  resource,
  opportunityId,
  showArchived,
  onShowArchived,
  onChanged,
}: {
  resource: ReturnType<typeof useApiResource<Awaited<ReturnType<typeof fetchOpportunityDocuments>>>>;
  opportunityId: string;
  showArchived: boolean;
  onShowArchived: (value: boolean) => void;
  onChanged: () => void;
}) {
  const policy = useApiResource(useCallback((signal: AbortSignal) => fetchDocumentPolicy(signal), []), []);
  const { submission, upload } = useUpload(opportunityId);
  const [category, setCategory] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<DocumentDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errors = { ...submission.fieldErrors, ...localErrors };

  if (resource.loading && !resource.data) return <LoadingPanel label="Loading documents…" />;
  if (resource.error) return <ErrorPanel error={resource.error} onRetry={resource.reload} />;
  const items = resource.data?.items ?? [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!file) found.file = 'Choose a file to upload.';
    else if (policy.data && file.size > policy.data.maxUploadBytes) {
      found.file = `The file is larger than the ${formatFileSize(policy.data.maxUploadBytes)} limit.`;
    }
    if (!category) found.category = 'Select a document category.';
    setLocalErrors(found);
    if (!file || Object.keys(found).length > 0) return;

    const result = await upload(file, { category });
    if (result) {
      toast.success('Document uploaded', {
        description: result.latest.downloadable
          ? `${result.latest.fileName} passed the scan and is available.`
          : `${result.latest.fileName} is stored. ${UNAVAILABLE_REASON[result.latest.scanState] ?? ''}`,
      });
      setFile(null);
      setCategory('');
      if (inputRef.current) inputRef.current.value = '';
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="grid grid-cols-1 items-end gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-[1fr_200px_auto]"
        noValidate
      >
        <div className="sm:col-span-3">
          <DialogAlert message={submission.formError} />
        </div>
        <Field label="File" htmlFor="doc-file" required error={errors.file} hint={uploadPolicyText(policy.data)}>
          <input
            id="doc-file"
            ref={inputRef}
            type="file"
            accept={policy.data?.acceptedExtensions.map((extension) => `.${extension}`).join(',')}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setLocalErrors((current) => ({ ...current, file: '' }));
              submission.clearField('file');
            }}
            className="block w-full text-[13px] text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 file:ring-1 file:ring-slate-300 hover:file:bg-slate-100"
          />
        </Field>
        <Field label="Category" htmlFor="doc-cat" required error={errors.category}>
          <select
            id="doc-cat"
            className={inputCls(errors.category)}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setLocalErrors((current) => ({ ...current, category: '' }));
            }}
          >
            <option value="">Select…</option>
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="primary" icon={<UploadIcon className="h-4 w-4" />} disabled={submission.submitting} className="sm:mb-[18px]">
          {submission.submitting ? 'Uploading…' : 'Upload'}
        </Button>
      </form>

      <label className="flex items-center gap-2 self-end text-[12px] text-slate-600">
        <input type="checkbox" checked={showArchived} onChange={(event) => onShowArchived(event.target.checked)} />
        Show archived documents
      </label>

      {items.length === 0 ? (
        <EmptyState
          icon={<PaperclipIcon className="h-8 w-8" />}
          title="No documents attached"
          description="Upload tender documents, requirements, notes or proposals."
          compact
        />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr>
                <th className={`${thCls} pl-4`}>Filename</th>
                <th className={thCls}>Category</th>
                <th className={thCls}>Uploaded by</th>
                <th className={thCls}>Uploaded (UTC+6)</th>
                <th className={`${thCls} text-right`}>Size</th>
                <th className={thCls}>Scan</th>
                <th className={`${thCls} pr-4 text-right`}>Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((document) => (
                <tr key={document.id} className={document.archivedAt ? 'bg-slate-50/70' : undefined}>
                  <td className={`${tdCls} pl-4`}>
                    <button
                      type="button"
                      onClick={() => setSelected(document)}
                      className="flex items-center gap-2 text-left font-semibold text-brand-dark hover:underline"
                    >
                      <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      {document.latest.fileName}
                    </button>
                    <span className="ml-6 mt-0.5 flex flex-wrap gap-1">
                      {document.revisionCount > 1 && (
                        <span className="rounded bg-slate-100 px-1.5 text-[10.5px] font-semibold text-slate-600">
                          Revision {document.revisionCount}
                        </span>
                      )}
                      {document.archivedAt && (
                        <span className="rounded bg-slate-200 px-1.5 text-[10.5px] font-semibold text-slate-600">Archived</span>
                      )}
                    </span>
                  </td>
                  <td className={tdCls}>{DOCUMENT_CATEGORY_LABELS[document.category]}</td>
                  <td className={tdCls}>{document.latest.uploadedByName}</td>
                  <td className={`${tdCls} whitespace-nowrap tabular-nums text-slate-600`}>{formatInstantCompact(document.latest.uploadedAt)}</td>
                  <td className={`${tdCls} text-right tabular-nums text-slate-600`}>{formatFileSize(document.latest.byteSize)}</td>
                  <td className={tdCls}>
                    <ScanStateBadge state={document.latest.scanState} scanner={document.latest.scanner} />
                  </td>
                  <td className={`${tdCls} pr-4 text-right`}>
                    <DownloadLink revision={document.latest} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocumentDialog
        document={selected}
        opportunityId={opportunityId}
        policy={policy.data}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          onChanged();
        }}
      />
    </div>
  );
}

function DownloadLink({ revision }: { revision: DocumentRevisionDto }) {
  if (!revision.downloadable) {
    return (
      <span className="text-[11.5px] text-slate-400" title={UNAVAILABLE_REASON[revision.scanState]}>
        Unavailable
      </span>
    );
  }
  return (
    <a
      href={documentDownloadUrl(revision.id)}
      className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-dark hover:underline"
      aria-label={`Download ${revision.fileName}`}
    >
      <DownloadIcon className="h-3.5 w-3.5" />
      Download
    </a>
  );
}

/** Revisions, a new revision, and management's archive action (FR-061). */
function DocumentDialog({
  document,
  opportunityId,
  policy,
  onClose,
  onChanged,
}: {
  document: DocumentDto | null;
  opportunityId: string;
  policy: DocumentPolicyDto | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useApiResource(
    useCallback(
      (signal: AbortSignal) => (document ? fetchDocument(document.id, signal) : Promise.resolve(null)),
      [document],
    ),
    [document?.id],
  );
  const { submission, upload } = useUpload(opportunityId);
  const archive = useSubmission();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setFile(null);
    setNote('');
    setArchiving(false);
    setReason('');
    submission.reset();
    archive.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id]);

  if (!document) return null;
  const data = detail.data;
  const preview = data?.revisions[0]?.previewable ? data.revisions[0] : null;

  const addRevision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    const result = await upload(file, { documentId: document.id, note: note || undefined });
    if (result) {
      toast.success('New revision uploaded', { description: `Revision ${result.revisionCount}; earlier revisions are kept.` });
      onChanged();
    }
  };

  const confirmArchive = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await archive.run(() => archiveDocument(document.id, { version: document.version, reason }));
    if (result) {
      toast.success('Document archived', { description: 'It stays available to the same people under “Show archived”.' });
      onChanged();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={document.latest.fileName}
      description={`${DOCUMENT_CATEGORY_LABELS[document.category]} · ${document.revisionCount} revision${document.revisionCount === 1 ? '' : 's'}`}
      footer={
        <>
          {document.canArchive && !archiving && (
            <Button icon={<ArchiveIcon className="h-4 w-4" />} onClick={() => setArchiving(true)}>
              Archive
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {document.archivedAt && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            Archived {formatInstant(document.archivedAt)} by {document.archivedByName}: {document.archiveReason}
          </p>
        )}
        {detail.error && <ErrorPanel error={detail.error as ApiRequestError} onRetry={detail.reload} />}
        {preview && (
          <img
            src={documentDownloadUrl(preview.id, true)}
            alt={preview.fileName}
            className="mx-auto max-h-[40vh] rounded-md border border-slate-200"
          />
        )}
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr>
                <th className={`${thCls} pl-4`}>Revision</th>
                <th className={thCls}>File</th>
                <th className={thCls}>Uploaded (UTC+6)</th>
                <th className={thCls}>Scan</th>
                <th className={`${thCls} pr-4 text-right`}>Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.revisions.map((revision) => (
                <tr key={revision.id}>
                  <td className={`${tdCls} pl-4 tabular-nums`}>{revision.revisionNumber}</td>
                  <td className={tdCls}>
                    <span className="block font-medium text-slate-900">{revision.fileName}</span>
                    <span className="block text-[11.5px] text-slate-500">
                      {formatFileSize(revision.byteSize)}
                      {revision.note ? ` · ${revision.note}` : ''}
                    </span>
                  </td>
                  <td className={`${tdCls} whitespace-nowrap text-slate-600`}>
                    {revision.uploadedByName}
                    <span className="block text-[11.5px] tabular-nums">{formatInstantCompact(revision.uploadedAt)}</span>
                  </td>
                  <td className={tdCls}>
                    <ScanStateBadge state={revision.scanState} scanner={revision.scanner} />
                  </td>
                  <td className={`${tdCls} pr-4 text-right`}>
                    <DownloadLink revision={revision} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!document.archivedAt && !archiving && (
          <form onSubmit={(event) => void addRevision(event)} className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3" noValidate>
            <DialogAlert message={submission.formError} />
            <p className="text-[13px] font-semibold text-slate-700">Upload a new revision</p>
            <Field label="File" htmlFor="rev-file" required error={submission.fieldErrors.file} hint={uploadPolicyText(policy)}>
              <input
                id="rev-file"
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-[13px] text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 file:ring-1 file:ring-slate-300"
              />
            </Field>
            <Field label="What changed" htmlFor="rev-note" error={submission.fieldErrors.note}>
              <input id="rev-note" className={inputCls(submission.fieldErrors.note)} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div>
              <Button type="submit" icon={<UploadIcon className="h-4 w-4" />} disabled={!file || submission.submitting}>
                {submission.submitting ? 'Uploading…' : 'Upload revision'}
              </Button>
            </div>
          </form>
        )}

        {archiving && (
          <form onSubmit={(event) => void confirmArchive(event)} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3" noValidate>
            <DialogAlert message={archive.formError} conflict={archive.conflict} />
            <p className="text-[13px] text-slate-600">
              Archiving removes the document from the list. Every revision is kept and stays available to the same people.
            </p>
            <Field label="Reason for archiving" htmlFor="arc-reason" required error={archive.fieldErrors.reason}>
              <textarea id="arc-reason" rows={2} className={inputCls(archive.fieldErrors.reason)} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={() => setArchiving(false)} disabled={archive.submitting}>
                Keep document
              </Button>
              <Button type="submit" variant="primary" disabled={archive.submitting}>
                {archive.submitting ? 'Archiving…' : 'Archive document'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
