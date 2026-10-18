/**
 * The fingerprint normal form of docs/estate-pointer-reader.md section 4, written for the oracles: NFC, white
 * space collapsed, container marks (bullets, `>`, pipes, ATX hashes) stripped. Case and emphasis are kept, and
 * there is no NFKC. The oracles compare two texts in this form; they never read the reader's own fingerprints
 * except to compare them with each other.
 */

const BULLET = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;

/** Strips the marks a container puts before its text, line by line. */
function stripMarks(text: string, container?: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  const out = lines.map((line, index) => {
    let current = line;
    // quote marks, any depth
    current = current.replace(/^\s*(?:>\s?)+/, '');
    if (index === 0 && container !== 'sentence') current = current.replace(BULLET, '');
    return current;
  });
  return out.join('\n');
}

/** The comparable form of a unit's text. `container` selects the marks that can occur in it. */
export function norm(text: string, container?: string): string {
  let current = text.normalize('NFC');
  if (container === 'heading') {
    // setext underline on the last line, ATX hashes on both ends
    current = current.replace(/\r?\n\s*[=-]{2,}\s*$/, '');
    current = current.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
  } else if (container === 'table_cell') {
    current = current.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  } else if (container === 'front_matter') {
    current = current.replace(/^\s*[>|][-+]?\s*\n/, '');
    current = current.trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(current);
    if (quoted) current = quoted[2] ?? current;
  } else if (container === 'block_quote' || container === 'list_item') {
    current = stripMarks(current, container);
  }
  return current.replace(/\s+/g, ' ').trim();
}

/** The same text with every white space run collapsed: for comparing unit texts that need no mark stripping. */
export function squash(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}
