/**
 * File acceptance rules (SEC-010).
 *
 * The extension decides what a file claims to be; the bytes must agree. The
 * browser's declared content type is ignored — it is whatever the client says
 * — and the stored MIME type comes from this table. Executables and
 * macro-enabled Office files are refused outright, with a message that says
 * so, whatever extension they arrive under.
 */
import { inflateRawSync } from 'node:zlib';

export interface AcceptedType {
  extension: string;
  mimeType: string;
  /** SEC-011: formats the browser can show safely inline under a sandbox CSP. */
  previewable: boolean;
}

const ACCEPTED: Record<string, AcceptedType> = {
  // Downloaded, not previewed: a browser PDF viewer will not run under the sandbox CSP.
  pdf: { extension: 'pdf', mimeType: 'application/pdf', previewable: false },
  docx: {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    previewable: false,
  },
  xlsx: {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    previewable: false,
  },
  pptx: {
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    previewable: false,
  },
  txt: { extension: 'txt', mimeType: 'text/plain', previewable: false },
  csv: { extension: 'csv', mimeType: 'text/csv', previewable: false },
  png: { extension: 'png', mimeType: 'image/png', previewable: true },
  jpg: { extension: 'jpg', mimeType: 'image/jpeg', previewable: true },
  jpeg: { extension: 'jpeg', mimeType: 'image/jpeg', previewable: true },
};

export const ACCEPTED_EXTENSIONS = Object.keys(ACCEPTED);

/** Named so the refusal can say why, rather than "unsupported type". */
const EXECUTABLE_OR_MACRO = new Set([
  'exe', 'dll', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'hta', 'cpl', 'jar', 'sh', 'bash', 'app', 'apk', 'bin', 'elf', 'lnk', 'reg', 'iso', 'img', 'dmg',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xlsb', 'pptm', 'potm', 'ppsm', 'ppam', 'sldm',
]);

export class FileRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileRejectedError';
  }
}

const NOT_ACCEPTED_MESSAGE = 'This file type is not accepted. Use PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG or JPEG.';
const EXECUTABLE_MESSAGE = 'Executable and macro-enabled files are not accepted.';

/**
 * Keeps the name a person recognises, without path parts, control or
 * reserved characters, or a leading dot. The stored file never uses this name;
 * it is shown in the interface and offered on download only.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  let cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    // Zero-width and bidirectional-override characters can disguise an extension.
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  if (cleaned.length > 150) {
    const dot = cleaned.lastIndexOf('.');
    const extension = dot > 0 ? cleaned.slice(dot) : '';
    cleaned = cleaned.slice(0, 150 - extension.length).trimEnd() + extension;
  }
  return cleaned;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** Decides from the name alone, before any bytes are read. */
export function acceptedTypeForName(fileName: string): AcceptedType {
  if (!fileName) throw new FileRejectedError('The file needs a name.');
  const extension = extensionOf(fileName);
  if (EXECUTABLE_OR_MACRO.has(extension)) throw new FileRejectedError(EXECUTABLE_MESSAGE);
  const accepted = ACCEPTED[extension];
  if (!accepted) throw new FileRejectedError(NOT_ACCEPTED_MESSAGE);
  return accepted;
}

export function acceptedTypeForMime(mimeType: string): AcceptedType | undefined {
  return Object.values(ACCEPTED).find((type) => type.mimeType === mimeType);
}

const startsWith = (content: Buffer, signature: number[]) =>
  content.length >= signature.length && signature.every((byte, index) => content[index] === byte);

function looksExecutable(content: Buffer): boolean {
  return (
    startsWith(content, [0x4d, 0x5a]) || // MZ: Windows PE
    startsWith(content, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(content, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O universal / Java class
    startsWith(content, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(content, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(content, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(content, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(content, [0x23, 0x21]) // #! script
  );
}

/** Verifies the bytes match the extension. Throws FileRejectedError otherwise. */
export function validateContent(content: Buffer, type: AcceptedType): void {
  if (content.length === 0) throw new FileRejectedError('The file is empty.');
  if (looksExecutable(content)) throw new FileRejectedError(EXECUTABLE_MESSAGE);

  const mismatch = () =>
    new FileRejectedError(`The file's content is not a valid ${type.extension.toUpperCase()} file.`);

  switch (type.extension) {
    case 'pdf':
      if (!startsWith(content, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw mismatch(); // %PDF-
      return;
    case 'png':
      if (!startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw mismatch();
      return;
    case 'jpg':
    case 'jpeg':
      if (!startsWith(content, [0xff, 0xd8, 0xff])) throw mismatch();
      return;
    case 'txt':
    case 'csv':
      validateText(content, mismatch);
      return;
    case 'docx':
      validateOfficeOpenXml(content, 'word/document.xml', mismatch);
      return;
    case 'xlsx':
      validateOfficeOpenXml(content, 'xl/workbook.xml', mismatch);
      return;
    case 'pptx':
      validateOfficeOpenXml(content, 'ppt/presentation.xml', mismatch);
      return;
    default:
      throw new FileRejectedError(NOT_ACCEPTED_MESSAGE);
  }
}

function validateText(content: Buffer, mismatch: () => Error): void {
  if (content.includes(0)) throw mismatch();
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new FileRejectedError('Text and CSV files must be saved as UTF-8.');
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/** Reads the ZIP central directory. Nothing is extracted except the content-types part. */
function readZipEntries(content: Buffer): ZipEntry[] | null {
  const EOCD = 0x06054b50;
  const searchFrom = Math.max(0, content.length - 65_557);
  let eocd = -1;
  for (let offset = content.length - 22; offset >= searchFrom; offset -= 1) {
    if (content.readUInt32LE(offset) === EOCD) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;

  const total = content.readUInt16LE(eocd + 10);
  let cursor = content.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > content.length || content.readUInt32LE(cursor) !== 0x02014b50) return null;
    const nameLength = content.readUInt16LE(cursor + 28);
    const extraLength = content.readUInt16LE(cursor + 30);
    const commentLength = content.readUInt16LE(cursor + 32);
    entries.push({
      method: content.readUInt16LE(cursor + 10),
      compressedSize: content.readUInt32LE(cursor + 20),
      localHeaderOffset: content.readUInt32LE(cursor + 42),
      name: content.toString('utf8', cursor + 46, cursor + 46 + nameLength),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(content: Buffer, entry: ZipEntry): Buffer | null {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > content.length || content.readUInt32LE(offset) !== 0x04034b50) return null;
  const start = offset + 30 + content.readUInt16LE(offset + 26) + content.readUInt16LE(offset + 28);
  const data = content.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) return null;
  try {
    return inflateRawSync(data, { maxOutputLength: 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * DOCX, XLSX and PPTX are ZIP packages. A macro-enabled package renamed to the
 * plain extension still carries a VBA project and a macroEnabled content
 * type; either is refused. Encrypted Office files are not ZIP packages and
 * fail the structure check.
 */
function validateOfficeOpenXml(content: Buffer, mainPart: string, mismatch: () => Error): void {
  if (!startsWith(content, [0x50, 0x4b, 0x03, 0x04])) throw mismatch();
  const entries = readZipEntries(content);
  if (!entries) throw mismatch();

  const names = entries.map((entry) => entry.name.toLowerCase());
  if (names.some((name) => /(^|\/)vbaproject\.bin$/.test(name) || /(^|\/)vbadata\.xml$/.test(name))) {
    throw new FileRejectedError(EXECUTABLE_MESSAGE);
  }
  if (!names.includes(mainPart)) throw mismatch();

  const contentTypes = entries.find((entry) => entry.name === '[Content_Types].xml');
  if (!contentTypes) throw mismatch();
  const xml = readZipEntry(content, contentTypes);
  if (!xml) throw mismatch();
  if (/macroenabled|vbaproject/i.test(xml.toString('utf8'))) throw new FileRejectedError(EXECUTABLE_MESSAGE);
}
