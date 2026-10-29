# Document upload: production setup

Files are stored in a private directory on the API server and scanned by a
ClamAV daemon (clamd) on the same server. A file can be downloaded only after
ClamAV reports it clean.

Assumes Ubuntu or Debian, one API server, and the API running as a system
user (shown below as `pcrm`; use your own). Run each step in order.

---

## Step 1. Check the server has enough memory

ClamAV keeps its signature database in memory.

```bash
free -h
```

Need **at least 3 GB available** on top of what the CRM and PostgreSQL use.

---

## Step 2. Install ClamAV

```bash
sudo apt update
sudo apt install -y clamav clamav-daemon clamav-freshclam
```

---

## Step 3. Download the virus signatures

```bash
sudo systemctl stop clamav-freshclam
sudo freshclam
sudo systemctl enable --now clamav-freshclam
ls -lh /var/lib/clamav/
```

The listing must show `main.cvd` (or `main.cld`), `daily.cvd` (or
`daily.cld`) and `bytecode.cvd`. If `freshclam` fails, the server cannot
reach `database.clamav.net`: open outbound HTTPS to it and rerun.

---

## Step 4. Configure clamd

Edit `/etc/clamav/clamd.conf`:

```bash
sudo nano /etc/clamav/clamd.conf
```

Set these lines (change the value if the line exists, add it if not):

```
TCPSocket 3310
TCPAddr 127.0.0.1
StreamMaxLength 30M
MaxFileSize 30M
MaxScanSize 100M
```

`TCPAddr 127.0.0.1` keeps clamd reachable from this server only.
`StreamMaxLength` must be larger than `DOCUMENT_MAX_UPLOAD_MB` (25).

Make systemd listen on the same TCP port:

```bash
sudo systemctl edit clamav-daemon.socket
```

In the editor, add between the comment lines and save:

```
[Socket]
ListenStream=127.0.0.1:3310
```

---

## Step 5. Start clamd

```bash
sudo systemctl daemon-reload
sudo systemctl enable clamav-daemon.socket clamav-daemon
sudo systemctl restart clamav-daemon.socket clamav-daemon
sudo systemctl status clamav-daemon --no-pager
```

Status must be `active (running)`. The first start takes up to a minute
while signatures load.

---

## Step 6. Check clamd is listening

```bash
sudo ss -ltnp | grep 3310
printf 'zPING\0' | nc -q 2 127.0.0.1 3310; echo
```

Expected: one line listening on `127.0.0.1:3310`, then `PONG`.

If nothing listens on 3310, see **Troubleshooting** at the end.

---

## Step 7. Check clamd finds malware

The EICAR test file is a harmless string every antivirus product reports as
infected.

```bash
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' | clamdscan --no-summary -
echo 'an ordinary text file' | clamdscan --no-summary -
```

Expected:

```
stream: Eicar-Test-Signature FOUND
stream: OK
```

(Some versions print `stdin:` instead of `stream:`.)

On a machine with the full project installed (`npm ci`) that can reach
clamd, `npm run ops:check-scanner` runs the same check through the CRM's
own scanner code.

---

## Step 8. Create the document directory

```bash
sudo mkdir -p /var/lib/penta-crm/documents
sudo chown pcrm:pcrm /var/lib/penta-crm/documents
sudo chmod 700 /var/lib/penta-crm/documents
ls -ld /var/lib/penta-crm/documents
```

Expected: `drwx------ ... pcrm pcrm ... /var/lib/penta-crm/documents`.

Rules for this directory:

- Never inside the web root, `dist/` or `public/`.
- Do **not** add it to on-access scanning (`clamonacc`) or any other
  antivirus that deletes or locks files: the CRM scans every file itself,
  and moves infected files to `quarantine/` inside this directory.
- Do not edit, move or delete files in it by hand.

---

## Step 9. Set the environment

In the API's `.env` (or its service environment), set:

```dotenv
DOCUMENT_STORAGE_DIR=/var/lib/penta-crm/documents
DOCUMENT_SCANNER=clamav
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_SECONDS=60
DOCUMENT_MAX_UPLOAD_MB=25
DOCUMENT_UPLOAD_TTL_MINUTES=60
```

`DOCUMENT_SCANNER=test` is refused in production. Do not use it.

---

## Step 10. Allow uploads through the web server

The web server in front of the CRM (nginx or Apache) has its own upload
limit. nginx's default is **1 MB**: a larger file is cut off mid-upload and
the CRM shows *"The server could not be reached"* (Firefox:
`NS_ERROR_NET_INTERRUPT`). Raise it above `DOCUMENT_MAX_UPLOAD_MB`.

Find which web server is running:

```bash
systemctl is-active nginx apache2
```

**nginx.** Find the CRM's site file:

```bash
sudo grep -rl "crm.pentabd.com" /etc/nginx/
```

Edit that file and add this line inside its `server { ... }` block for
`crm.pentabd.com` (the `listen 443` one):

```nginx
    client_max_body_size 30m;
```

Then check and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` must say `syntax is ok` and `test is successful`.

**Apache.** In the CRM's `<VirtualHost *:443>` block, add:

```apache
    LimitRequestBody 31457280
```

Then:

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

If a proxy or firewall sits in front of this server as well (a load
balancer, Cloudflare, a WAF), allow at least 30 MB request bodies there too.

---

## Step 11. Deploy and restart the API

Deploy a build that contains the ClamAV scanner (this guide's commit or
later), then restart the API:

```bash
sudo systemctl restart <crm api service>
sudo journalctl -u <crm api service> -n 30 --no-pager
```

The log must contain:

```
DOCUMENT_SCANNER=clamav: scanning documents with clamd at 127.0.0.1:3310.
```

If it says `DOCUMENT_SCANNER=none`, the environment from Step 9 was not
loaded.

---

## Step 12. Test in the CRM

1. Sign in as a Salesperson or Section Lead.
2. Open an opportunity you own → **Documents** → upload a small PDF.
3. The upload form's note must say: *"Each file is scanned for malware and
   can be downloaded once the scan is clean."*
4. The file shows **Scanned** (refresh if it shows *Awaiting scan*).
5. Download it. It must open.
6. Check the file is on disk:

   ```bash
   sudo find /var/lib/penta-crm/documents/objects -type f | head
   ```

Files uploaded earlier, while the scanner was `none`, are scanned
automatically within 15 minutes of the restart.

---

## Step 13. Include the documents in backups

Back up `/var/lib/penta-crm/documents` together with the database, every
time, as described in `backup-and-restore.md`. A database restored without
its files leaves documents that cannot be downloaded.

---

## Step 14. Monitor

| Check | Command | Healthy |
| --- | --- | --- |
| clamd running | `systemctl is-active clamav-daemon` | `active` |
| Signatures updating | `sudo journalctl -u clamav-freshclam --since "1 day ago" \| tail` | an update or "up-to-date" within the last day |
| Scanner errors in the CRM | `sudo journalctl -u <crm api service> --since "1 day ago" \| grep -i "document scan"` | no lines |
| Disk space | `df -h /var/lib/penta-crm` | below 80% used |

---

## What users see

| Badge | Meaning | What to do |
| --- | --- | --- |
| **Awaiting scan** | Not scanned yet. Also shown while clamd is down | Nothing. Retried every 15 minutes. If it lasts longer, check clamd (Step 14) |
| **Scanned** | Clean. Can be downloaded | — |
| **Rejected by scan** | ClamAV found malware. Moved to `quarantine/` and never downloadable | Tell the uploader. Do not restore the file |
| **Scan failed** | ClamAV could not check the file (e.g. larger than `StreamMaxLength`) | The user uploads it again as a new revision after the cause is fixed. A failed file is not rescanned |

---

## Troubleshooting

**Nothing listens on port 3310 (Step 6).**
Check the socket override was saved:

```bash
systemctl cat clamav-daemon.socket
```

It must show `ListenStream=127.0.0.1:3310`. Repeat Step 4 (the
`systemctl edit` part) and Step 5.

**`clamav-daemon` fails to start.**

```bash
sudo journalctl -u clamav-daemon -n 50 --no-pager
```

- *"No supported database files found"*: rerun Step 3.
- Killed / out of memory: add memory (Step 1), or add
  `ConcurrentDatabaseReload no` to `clamd.conf` and restart.

**Upload fails with *"The server could not be reached"*; the browser's
Network tab shows `NS_ERROR_NET_INTERRUPT` or status 413.**
The web server's upload limit is too small. Confirm:

```bash
sudo grep -i "too large body" /var/log/nginx/error.log | tail -5
```

A line *"client intended to send too large body"* confirms it. Do Step 10.

**Files stay on *Awaiting scan*.**
The API log shows `Document scanner unavailable`. Check clamd (Steps 5–6) and
`CLAMAV_HOST`/`CLAMAV_PORT` (Step 9). Once clamd answers, files are scanned
within 15 minutes.

**Every file shows *Scan failed*.**
The API log shows `Document scan failed` with ClamAV's reason. A size limit
reason means `StreamMaxLength` (Step 4) is smaller than the upload limit.

**The API does not start after Step 9.**
`DOCUMENT_SCANNER must be none, test or clamav`: fix the spelling.
`must not be used in production`: `DOCUMENT_SCANNER` is `test`; set
`clamav`.
