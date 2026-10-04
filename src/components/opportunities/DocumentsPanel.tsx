import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileIcon, PaperclipIcon, UploadIcon } from 'lucide-react';
import type { DocCategory, DocumentRecord, User } from '../../types/crm';
import { useCrm } from '../../contexts/CrmContext';
import { DOC_CATEGORIES } from '../../data/options';
import { formatDateTime, formatFileSize } from '../../utils/format';
import { userName } from '../../utils/lookup';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Feedback';
import { Field, inputCls } from '../ui/FormFields';
import { Modal } from '../ui/Modal';
import { tdCls, thCls } from '../ui/Layout';

const MAX_STORED_BYTES = 1024 * 1024;

export function DocumentsPanel({ oppId, documents, users }: {oppId: string;documents: DocumentRecord[];users: User[];}) {
  const { addDocument } = useCrm();
  const [category, setCategory] = useState<DocCategory | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DocumentRecord | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!file) errs.file = 'Choose a file to upload.';
    if (!category) errs.category = 'Select a document category.';
    setErrors(errs);
    if (!file || !category) return;
    setBusy(true);
    let dataUrl: string | null = null;
    if (file.size <= MAX_STORED_BYTES) {
      dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }
    const res = addDocument({
      oppId,
      filename: file.name,
      category,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
      isDemo: false,
      demoContent: '',
      dataUrl
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Upload failed.');
      return;
    }
    toast.success('Document uploaded', {
      description: dataUrl ? `${file.name} saved in this browser.` : `${file.name}: metadata saved; files over 1 MB are not stored in demo storage.`
    });
    setFile(null);
    setCategory('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={upload} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-[1fr_200px_auto]" noValidate>
        <Field label="File" htmlFor="doc-file" required error={errors.file} hint="Stored locally in this browser (up to 1 MB per file).">
          <input
            id="doc-file"
            ref={inputRef}
            type="file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setErrors((er) => ({ ...er, file: '' }));
            }}
            className="block w-full text-[13px] text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 file:ring-1 file:ring-slate-300 hover:file:bg-slate-100" />
          
        </Field>
        <Field label="Category" htmlFor="doc-cat" required error={errors.category}>
          <select id="doc-cat" className={inputCls(errors.category)} value={category} onChange={(e) => setCategory(e.target.value as DocCategory)}>
            <option value="">Select…</option>
            {DOC_CATEGORIES.map((c) =>
            <option key={c}>{c}</option>
            )}
          </select>
        </Field>
        <Button type="submit" variant="primary" icon={<UploadIcon className="h-4 w-4" />} disabled={busy} className="sm:mb-[18px]">
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
      </form>

      {documents.length === 0 ?
      <EmptyState icon={<PaperclipIcon className="h-8 w-8" />} title="No documents attached" description="Upload tender documents, requirements, notes or proposals." compact /> :

      <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr>
                <th className={`${thCls} pl-4`}>Filename</th>
                <th className={thCls}>Category</th>
                <th className={thCls}>Uploaded by</th>
                <th className={thCls}>Uploaded</th>
                <th className={`${thCls} pr-4 text-right`}>Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) =>
            <tr key={d.id}>
                  <td className={`${tdCls} pl-4`}>
                    <button type="button" onClick={() => setPreview(d)} className="flex items-center gap-2 text-left font-semibold text-brand-dark hover:underline">
                      <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      {d.filename}
                    </button>
                    {d.isDemo && <span className="ml-6 mt-0.5 inline-block rounded bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-800">Demo document</span>}
                  </td>
                  <td className={tdCls}>{d.category}</td>
                  <td className={tdCls}>{userName(users, d.uploadedBy)}</td>
                  <td className={`${tdCls} whitespace-nowrap tabular-nums text-slate-600`}>{formatDateTime(d.uploadedAt)}</td>
                  <td className={`${tdCls} pr-4 text-right tabular-nums text-slate-600`}>{formatFileSize(d.sizeBytes)}</td>
                </tr>
            )}
            </tbody>
          </table>
        </div>
      }
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>);

}

function DocumentPreview({ doc, onClose }: {doc: DocumentRecord | null;onClose: () => void;}) {
  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      size="lg"
      title={doc?.filename ?? ''}
      description={doc ? `${doc.category}${doc.isDemo ? ' · Demo document (synthetic content)' : ''}` : undefined}
      footer={
      <>
          {doc?.dataUrl &&
        <a href={doc.dataUrl} download={doc.filename} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Download
            </a>
        }
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }>
      
      {doc?.isDemo ?
      <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 font-sans text-[13px] leading-relaxed text-slate-700">{doc.demoContent}</pre> :
      doc?.dataUrl ?
      doc.mimeType.startsWith('image/') ?
      <img src={doc.dataUrl} alt={doc.filename} className="mx-auto max-h-[60vh] rounded-md border border-slate-200" /> :
      doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('text/') ?
      <iframe title={doc.filename} src={doc.dataUrl} className="h-[60vh] w-full rounded-md border border-slate-200" /> :

      <p className="text-sm text-slate-600">Inline preview isn’t available for this file type. Use Download to open the locally stored copy.</p> :


      <p className="text-sm text-slate-600">Only metadata was stored for this file because it exceeds the 1 MB demo storage limit.</p>
      }
    </Modal>);

}