# Backup and restore drill — 2026-10-06T09:38:10.586Z

Source: the isolated TEST database, reseeded with synthetic fixtures; documents uploaded through the application.

Uploaded 4 files (one a revision, one with a Bangla name); the EICAR test file was infected and quarantined.
Backup: 1070 ms; database dump 110971 bytes; 3 files; 1 quarantined file not copied.
The encrypted dump contains no readable account or opportunity text.
Restore into `penta_crm_restore_check`: 2314 ms.
- ok: manifest and database dump decrypt and authenticate; dump checksum matches
- ok: pg_restore completed in a single transaction
- ok: 3 document files restored, each matching its database checksum
- ok: 19 tables, 186 rows: every count matches the snapshot
- ok: 8 applied migrations recorded, as in the source
- ok: every non-quarantined document revision has its file
- ok: runtime role: audit events still append-only (INSERT yes; UPDATE, DELETE, TRUNCATE no)
- ok: signed in on the restored copy; "Municipal Service Portal" with 8 history events, 1 follow-ups and 2 linked contacts
- ok: all 3 documents (including the earlier revision) download from the restored copy, byte-identical
- ok: the restored copy accepts new work (reference OPP-001000 continues the sequence)
- ok: a backup with one altered byte is refused before anything is restored

Capacity database (NFR-010 envelope, database only — its documents are metadata without files): encrypted dump 16722619 bytes in 4925 ms; decrypt and restore in 7899 ms.

Scratch database dropped; working files in C:\Users\Milton\AppData\Local\Temp\penta-restore-drill-3ErHFk (temporary directory).
