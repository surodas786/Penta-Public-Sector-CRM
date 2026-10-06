/**
 * Synthetic test files, built in memory. Nothing here is a real document, and
 * the "infected" file carries only the harmless EICAR test string.
 */
import { crc32, deflateRawSync } from 'node:zlib';

import { EICAR_SIGNATURE, TEST_SCANNER_FAILURE_MARKER } from '../../documents/scanner.js';

export const PDF = Buffer.from('%PDF-1.4\n% Synthetic test document\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

/** A valid 1×1 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('synthetic jpeg body')]);

export const TEXT = Buffer.from('Synthetic meeting notes.\nসিদ্ধান্ত: পরবর্তী সভা বৃহস্পতিবার।\n', 'utf8');

export const CSV = Buffer.from('item,quantity\nServer,4\nStorage,2\n', 'utf8');

/** Contains the EICAR test string, not at the start, so workstation scanners leave it alone. */
export const EICAR_TEXT = Buffer.from(`Synthetic scanner test file.\n${EICAR_SIGNATURE}\n`, 'latin1');

export const SCANNER_FAILURE_TEXT = Buffer.from(`Synthetic file.\n${TEST_SCANNER_FAILURE_MARKER}\n`, 'utf8');

export const WINDOWS_EXECUTABLE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x90)]);

interface ZipEntry {
  name: string;
  data: Buffer | string;
}

/** A minimal ZIP writer: deflated entries, one central directory. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const WORD_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const MACRO_WORD_TYPES = WORD_TYPES.replace(
  'wordprocessingml.document.main+xml',
  'ms-word.document.macroEnabled.main+xml',
);

export const DOCX = buildZip([
  { name: '[Content_Types].xml', data: WORD_TYPES },
  { name: 'word/document.xml', data: '<w:document><w:body><w:p>Synthetic proposal</w:p></w:body></w:document>' },
]);

/** A macro-enabled document renamed to .docx: it still carries a VBA project. */
export const DOCX_WITH_MACROS = buildZip([
  { name: '[Content_Types].xml', data: MACRO_WORD_TYPES },
  { name: 'word/document.xml', data: '<w:document/>' },
  { name: 'word/vbaProject.bin', data: Buffer.from('synthetic vba project placeholder') },
]);

/** Declares macros in its content types only. */
export const DOCX_DECLARING_MACROS = buildZip([
  { name: '[Content_Types].xml', data: MACRO_WORD_TYPES },
  { name: 'word/document.xml', data: '<w:document/>' },
]);

export const XLSX = buildZip([
  {
    name: '[Content_Types].xml',
    data: '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
  },
  { name: 'xl/workbook.xml', data: '<workbook/>' },
]);
