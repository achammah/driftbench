/**
 * The planted code-interpreter agent of the blocks validator: a scripted fake that speaks the protocol of the
 * process adapter (docs/adapters/process.md). It holds no truth. It reads an action plan from the file named in
 * BLOCKS_AGENT_PLAN, which the harness writes outside the workspace, finds the entry whose marker the
 * instruction holds, and does what the entry says: writes files (csv, json, txt, xlsx, docx, pdf), records the
 * commands it ran with their exit codes, reports runtime events, prints its reply and exits with the planned
 * code. A planted fault is only ever an action of the plan (a wrong cell, a missing sheet, a file written
 * outside the workspace, a failing command behind a confident reply); this script decides nothing.
 *
 * No model, no network, no clock in any file it writes: the same plan and instruction give the same bytes.
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';

function readInstruction() {
  const file = process.env.DRIFTBENCH_STIMULUS_FILE;
  if (file) return readFileSync(file, 'utf8');
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** The files of the workspace, relative, sorted, the protocol files left out. */
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.name.startsWith('driftbench-')) continue;
    if (entry.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out.sort();
}

function record(path, line) {
  if (path) appendFileSync(path, `${JSON.stringify(line)}\n`);
}

function write(file) {
  mkdirSync(dirname(file.path), { recursive: true });
  const bytes = {
    txt: () => Buffer.from(String(file.data)),
    json: () => Buffer.from(`${JSON.stringify(file.data, null, 2)}\n`),
    csv: () => Buffer.from(`${file.data.map((row) => row.map(csvCell).join(',')).join('\n')}\n`),
    xlsx: () => xlsx(file.data.sheets),
    docx: () => docx(file.data.paragraphs),
    pdf: () => pdf(file.data.pages),
    bytes: () => Buffer.from(String(file.data), 'base64'),
  }[file.format];
  if (!bytes) throw new Error(`unknown format ${file.format}`);
  writeFileSync(file.path, bytes());
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const xml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A column name: 0 is A, 26 is AA. */
function column(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function xlsx(sheets) {
  const sheetXml = (rows) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((value, c) => {
              const ref = `${column(c)}${r + 1}`;
              if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
              if (typeof value === 'string' && value.startsWith('='))
                return `<c r="${ref}"><f>${xml(value.slice(1))}</f></c>`;
              return `<c r="${ref}" t="inlineStr"><is><t>${xml(value ?? '')}</t></is></c>`;
            })
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  const files = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ],
    ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows)]),
  ];
  return zip(files);
}

function docx(paragraphs) {
  return zip([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
        .map((text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`)
        .join('')}</w:body></w:document>`,
    ],
  ]);
}

/** A PDF of one page per entry, each page showing its text in Helvetica. */
function pdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objects.length + 1;
  objects.push('');
  const kids = pages.map((text) => {
    const escaped = String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
    );
  });
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of [name, text] entries, deflated, with the earliest DOS time so the bytes never depend on the clock. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Plays the plan entry of this turn. Called last, once every helper above is defined. */
function main() {
  const plan = JSON.parse(readFileSync(process.env.BLOCKS_AGENT_PLAN ?? '', 'utf8'));
  const instruction = readInstruction();
  const entry = Object.entries(plan.markers).find(([marker]) => instruction.includes(marker))?.[1];
  if (!entry) {
    process.stdout.write('I do not know this task.\n');
    process.exitCode = 0;
    return;
  }

  if (process.env.BLOCKS_AGENT_LOG) {
    // What reached the agent, for the items that check delivery: the marker and the history it read.
    let history = [];
    try {
      history = JSON.parse(readFileSync(process.env.DRIFTBENCH_HISTORY_FILE ?? '', 'utf8'));
    } catch {
      history = [];
    }
    const marker = Object.keys(plan.markers).find((each) => instruction.includes(each));
    appendFileSync(
      process.env.BLOCKS_AGENT_LOG,
      `${JSON.stringify({
        marker,
        history,
        files: listFiles('.'),
        digests: Object.fromEntries(
          listFiles('.').map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
        ),
      })}\n`,
    );
  }
  for (const file of entry.files ?? []) write(file);
  for (const path of entry.deletes ?? []) rmSync(path, { force: true });
  for (const link of entry.links ?? []) {
    mkdirSync(dirname(link.path), { recursive: true });
    symlinkSync(link.target, link.path);
  }
  for (const command of entry.commands ?? []) record(process.env.DRIFTBENCH_COMMANDS_FILE, command);
  for (const event of entry.runtime ?? []) record(process.env.DRIFTBENCH_RUNTIME_FILE, event);
  if (entry.reply) process.stdout.write(`${entry.reply}\n`);
  if (entry.stderr) process.stderr.write(`${entry.stderr}\n`);
  process.exitCode = entry.exit ?? 0;
}

main();
