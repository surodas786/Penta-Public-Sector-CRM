# ADR 0006 — Tender cycles and private documents

**Status:** Accepted for development (Milestone 5). **Production storage and
scanning are unresolved** — see the last section.
**Date:** 05 October 2026
**Requirements:** FR-050–FR-052, FR-060–FR-062, BR-040, BR-050, SEC-010, SEC-011, AT-10, AT-11, AT-13

## Tenders

### One current notice, enforced by the database

`tenders_one_current_per_opportunity` is a partial unique index on
`opportunity_id WHERE is_current`. A CHECK ties the flag to the notice state
(`is_current = (notice_state = 'current')`), so a superseded or cancelled
notice can never be current. Adding a notice supersedes the previous current
one in the same transaction, after locking the opportunity row; two
simultaneous re-tenders therefore leave exactly one current notice (tested).
A mutation test that skipped the supersede step failed eight tests, including
the database refusal.

Earlier notices are never edited or deleted: the runtime role has no DELETE
on `tenders`, and the service refuses edits to a superseded or cancelled
notice. A superseded notice can be made current again; a cancelled one
cannot (a re-issued notice is a new record).

### Chronology and reasons (BR-040)

Each rule is checked by the service, as a field error, and again by a CHECK
constraint, so no future code path can store an inconsistent tender:

- the submission deadline, as a **Bangladesh calendar date**, is not before
  the publication date;
- the clarification deadline is not after the submission deadline;
- Not Participating has a reason (cleared when the status changes back);
- Submitted has a time, and nothing else has one;
- a submission time after the recorded deadline has an explanatory note —
  the CRM records the fact and does not judge whether the bid was accepted;
- the notice URL is http or https.

### Mark Submitted never moves the stage on its own (FR-051)

The prototype advanced the opportunity automatically. Production requires
`moveOpportunityToBidSubmitted` with **no default**: the request is refused
without an explicit answer. When the answer is yes, the tender and the stage
change are one transaction with two audit events; when no, the stage is kept
and the tender shows a mismatch indicator. The move is offered only while the
opportunity is Active and at an earlier pipeline stage; it never goes
backwards, never applies to On Hold, Cancelled or closed records, and nothing
in this path can set Awarded. Submission is idempotent by key; a replay
reports whether the stage moved by reading the audit trail, so it never
claims a change that did not happen.

### Responsible owner is derived

The tender has no owner column: the responsible owner is always the
opportunity's current owner (§7.1, BR-050), so a transfer moves tender
responsibility and visibility with no extra write. The prototype's owner
selector is replaced by a read-only field.

### Deadline indicators (FR-052)

Decided by the server against the real clock (`server/clock.ts`), never the
browser and never the demo date: red after the deadline, amber within 72
hours (inclusive of the deadline instant), neutral later, green when
Submitted, grey for Not Participating. Superseded and cancelled notices, and
tenders on Cancelled, Awarded or Lost opportunities, raise no alert; On Hold
keeps its alerts because the procurement deadline still exists (BR-014).
Every screen showing the colours shows the legend.

## Documents

### Upload is two steps

1. `POST /api/opportunities/:id/document-uploads` streams the raw body to
   private storage under a **server-generated UUID key**, enforcing the size
   limit while writing (413 at the limit plus one byte, with the partial file
   removed), then validates the content. Nothing is visible yet.
2. `POST /api/document-uploads/:id/finalize` (Idempotency-Key) re-checks the
   parent opportunity's scope, then creates the document or a new revision
   and its audit event in one transaction. A staged upload becomes at most
   one revision (unique index, and the upload row is locked), so a retry —
   with the same key or a new one, or two at once — returns the same
   document.

Only the person who staged an upload can finalize it. If their access ended
in between (a transfer), finalizing is the same 404 as a missing record.
Unfinalized uploads expire after `DOCUMENT_UPLOAD_TTL_MINUTES` (60) and are
removed with their files by `cleanupAbandonedUploads`, which also removes
stored files that no upload record refers to (a crash between writing bytes
and recording them). The API server runs it every 15 minutes, and
`npm run documents:maintain` runs it once.

### File acceptance (SEC-010)

- Extensions: PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG, JPG/JPEG. Executables and
  macro-enabled Office extensions are refused **by name**, with a message
  that says so.
- The bytes must match the extension (magic numbers; OOXML packages must be
  ZIPs containing their main part). The browser's declared content type is
  ignored, and the stored MIME type comes from the server's table.
- Executable signatures (PE, ELF, Mach-O, `#!`) are refused under any name.
- A macro-enabled document renamed to `.docx`/`.xlsx`/`.pptx` is refused: a
  VBA project part, or a `macroEnabled` content type, is detected.
- TXT and CSV must be UTF-8 without NUL bytes.
- Filenames are normalised and stripped of path parts, control and reserved
  characters, zero-width and bidirectional-override characters, and leading
  dots, and shortened to 150 characters. The name is shown and offered on
  download only; it is never used for storage.

### Scanning before availability

A revision starts `pending`. Only `clean` is downloadable; `pending`,
`failed` (the scanner could not decide) and `infected` are refused with 409
`document_unavailable`. Scanning runs after the finalize transaction commits,
so a slow scanner never holds the opportunity lock. The verdict is written
only if the revision is still pending, with the scanner's name and a
`document.scanned` audit event attributed to the system. An infected file is
moved to a quarantine area outside the serving path.

Two scanner adapters exist (`server/documents/scanner.ts`):

| `DOCUMENT_SCANNER` | Behaviour |
| --- | --- |
| `none` (default) | Reports itself unavailable. Files are stored but **stay pending and can never be downloaded**. The pending-scan retry does nothing. |
| `test` | **Development only, refused at startup in production.** Flags the EICAR test string and fails on a marker so the failure path can be exercised. It does not detect malware. Its verdicts are recorded as `test-scanner` and the interface labels them "(test scanner)". |

A scanner that throws marks the file `failed`, never clean (tested with a
substitute scanner).

### Download (SEC-011)

`GET /api/document-revisions/:id/download` re-checks the parent
opportunity's scope on **every** request, then the scan verdict, then streams
the file with `Content-Disposition: attachment` (RFC 6266 with a UTF-8
`filename*`, so Bangla names survive), the stored MIME type, `nosniff`,
`Cache-Control: private, no-store`, a sandboxing CSP and same-origin resource
policy. There is no public, signed or permanent URL: an old link stops
working as soon as a transfer removes access. PNG and JPEG may be previewed
inline under the same headers; PDFs are downloaded, because a browser PDF
viewer will not run under the sandbox CSP. Archived documents remain
downloadable within the same scope (FR-061).

### Revisions and archiving (FR-061)

A document is a series of revisions; a replacement adds one and never
overwrites. Uploading a revision is open to anyone who can edit the
opportunity; archiving is management-only, with a reason, and keeps every
revision. The runtime role has no DELETE on `documents` or
`document_revisions`; it may DELETE `document_uploads` rows, which are never
visible and are only removed by the abandoned-upload cleanup.

## Unresolved for production — not decided, not claimed ready

The plan requires storage and scanning infrastructure to be selected before
the feature is enabled. None has been. What exists is a **development
implementation** behind adapters:

- **Storage:** a private local directory (`DOCUMENT_STORAGE_DIR`, default
  `./var/documents`, git-ignored). Undecided: object storage or server disk;
  encryption at rest and key management; backup and restore of files with the
  database; retention and legal hold; capacity; antivirus on the storage host;
  multi-instance access (local disk does not work behind more than one API
  instance).
- **Scanning:** no production scanner. Undecided: product (e.g. a ClamAV
  daemon or a managed scanning service), signature updates, timeouts and
  retry policy, and what happens to files left `failed`. With
  `DOCUMENT_SCANNER=none`, production uploads would be stored but never
  downloadable.
- **Deferred inspection:** PDF active content (JavaScript, launch actions)
  and embedded OLE objects in Office files are not inspected; that is left to
  the real scanner once chosen.
- **Limits:** 25 MB per file is the configured default
  (`DOCUMENT_MAX_UPLOAD_MB`); a per-opportunity or per-user quota is not set.
