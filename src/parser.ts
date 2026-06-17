// Parser DBML mínimo (subset suficiente para BD_SIOM).
// Soporta: Table, columnas con [pk, not null, note, ref inline],
// relaciones Ref: a.col > b.col, inline ref, y forma a.col <> b.col.

export interface Column {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  nn: boolean;
  note?: string;
}
export interface Table {
  name: string;
  note?: string;
  headerColor?: string;
  cols: Column[];
}
export type Cardinality = ">" | "<" | "<>" | "-";
export interface Ref {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
  op: Cardinality;
}
export interface Model {
  tables: Table[];
  refs: Ref[];
}

export function parseDBML(input: string): Model {
  // quita comentarios de línea //
  const src = input.replace(/\/\/[^\n]*/g, "");
  const tables: Table[] = [];
  const refs: Ref[] = [];

  const relRe =
    /(?:Ref:\s*)?([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*(<>|>|<|-)\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;
  const tableRe =
    /(?:Table\s+)?([A-Za-z0-9_"]+)\s*(?:as\s+\w+\s*)?(?:\[([^\]]*)\]\s*)?\{([\s\S]*?)\}/g;

  const bodies: [number, number][] = [];
  let m: RegExpExecArray | null;

  while ((m = tableRe.exec(src)) !== null) {
    const name = m[1].replace(/"/g, "");
    const settings = m[2] || "";
    const body = m[3];
    bodies.push([m.index, m.index + m[0].length]);
    const cols: Column[] = [];
    let tableNote: string | undefined;
    const hcMatch = settings.match(
      /header[_ ]?color:\s*([#A-Za-z0-9(),.\s%]+?)\s*(?:,|$)/i
    );
    const headerColor = hcMatch ? hcMatch[1].trim() : undefined;

    for (let line of body.split("\n")) {
      line = line.trim();
      if (!line || line === "{" || line === "}") continue;
      const tn = line.match(/^Note:\s*'([^']*)'/i);
      if (tn) {
        tableNote = tn[1];
        continue;
      }
      if (/^indexes/i.test(line)) continue;
      const cm = line.match(/^([A-Za-z0-9_]+)\s+([^[\n]+?)\s*(\[.*\])?\s*$/);
      if (!cm) continue;
      const rawAttrs = cm[3] || "";
      const attrs = rawAttrs.toLowerCase();
      const noteM = rawAttrs.match(/note:\s*'([^']*)'/i);
      const col: Column = {
        name: cm[1],
        type: cm[2],
        pk: /\bpk\b|primary key/.test(attrs),
        fk: false,
        nn: /not null/.test(attrs),
        note: noteM ? noteM[1] : undefined,
      };
      cols.push(col);
      const ir = rawAttrs.match(
        /ref:\s*(<>|>|<|-)\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/i
      );
      if (ir) {
        refs.push({
          from: name,
          fromCol: cm[1],
          op: ir[1] as Cardinality,
          to: ir[2],
          toCol: ir[3],
        });
        col.fk = true;
      }
    }
    tables.push({ name, note: tableNote, headerColor, cols });
  }

  while ((m = relRe.exec(src)) !== null) {
    const idx = m.index;
    if (bodies.some(([s, e]) => idx >= s && idx < e)) continue;
    refs.push({
      from: m[1],
      fromCol: m[2],
      op: m[3] as Cardinality,
      to: m[4],
      toCol: m[5],
    });
  }

  // marca FKs
  for (const r of refs) {
    const t = tables.find((t) => t.name === r.from);
    const c = t?.cols.find((c) => c.name === r.fromCol);
    if (c) c.fk = true;
  }

  return { tables, refs };
}

// Edita la línea de declaración de una tabla para fijar/quitar headercolor.
// Devuelve la línea nueva, o null si la línea no declara esa tabla.
export function setHeaderColorInLine(
  line: string,
  tableName: string,
  color: string | null
): string | null {
  const esc = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^(\\s*(?:Table\\s+)?"?${esc}"?\\s*(?:as\\s+\\w+\\s*)?)(\\[[^\\]]*\\])?(\\s*\\{.*)$`
  );
  const m = line.match(re);
  if (!m) return null;
  const head = m[1].replace(/\s+$/, "");
  const inner = (m[2] || "").replace(/^\[|\]$/g, "");
  const rest = " " + m[3].replace(/^\s*/, "");

  // separa settings por coma respetando comillas simples
  const parts = inner
    ? inner.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map((p) => p.trim()).filter(Boolean)
    : [];
  const filtered = parts.filter((p) => !/^header[_ ]?color\s*:/i.test(p));
  if (color) filtered.push(`headercolor: ${color}`);

  const bracket = filtered.length ? ` [${filtered.join(", ")}]` : "";
  return head + bracket + rest;
}

// ---- edición de textos (rename / tipo) sobre las líneas del bloque ----

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// localiza [lineaDeclaracion, lineaCierre] de una tabla dentro del rango del bloque
function findTableRange(
  lines: string[],
  start: number,
  end: number,
  name: string
): [number, number] | null {
  const e = esc(name);
  const declRe = new RegExp(
    `^\\s*(?:Table\\s+)?"?${e}"?\\s*(?:as\\s+\\w+\\s*)?(?:\\[[^\\]]*\\]\\s*)?\\{`
  );
  let decl = -1;
  for (let i = start; i <= end && i < lines.length; i++) {
    if (declRe.test(lines[i])) {
      decl = i;
      break;
    }
  }
  if (decl < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = decl; i <= end && i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close >= 0) break;
  }
  if (close < 0) return null;
  return [decl, close];
}

// Renombra una tabla y actualiza referencias y comentarios @pos. Muta lines.
export function renameTableInBlock(
  lines: string[],
  start: number,
  end: number,
  oldName: string,
  newName: string
): boolean {
  if (!/^[A-Za-z0-9_]+$/.test(newName)) return false;
  const range = findTableRange(lines, start, end, oldName);
  if (!range) return false;
  const [decl] = range;
  const e = esc(oldName);
  lines[decl] = lines[decl].replace(
    new RegExp(`^(\\s*(?:Table\\s+)?)"?${e}"?`),
    `$1${newName}`
  );
  const refRe = new RegExp(`\\b${e}\\.`, "g");
  const posRe = new RegExp(`^(\\s*//\\s*@pos\\s+)"?${e}"?(\\s)`);
  for (let i = start; i <= end && i < lines.length; i++) {
    if (i === decl) continue;
    lines[i] = lines[i].replace(refRe, `${newName}.`);
    lines[i] = lines[i].replace(posRe, `$1${newName}$2`);
  }
  return true;
}

// Renombra una columna de una tabla y actualiza referencias tabla.col. Muta lines.
export function renameColumnInBlock(
  lines: string[],
  start: number,
  end: number,
  table: string,
  oldCol: string,
  newCol: string
): boolean {
  if (!/^[A-Za-z0-9_]+$/.test(newCol)) return false;
  const range = findTableRange(lines, start, end, table);
  if (!range) return false;
  const [decl, close] = range;
  const ec = esc(oldCol);
  let found = false;
  for (let i = decl + 1; i < close; i++) {
    if (new RegExp(`^\\s*${ec}\\s+[A-Za-z0-9_(]`).test(lines[i])) {
      lines[i] = lines[i].replace(
        new RegExp(`^(\\s*)${ec}(?=\\s)`),
        `$1${newCol}`
      );
      found = true;
      break;
    }
  }
  if (!found) return false;
  const refRe = new RegExp(`\\b${esc(table)}\\.${ec}\\b`, "g");
  for (let i = start; i <= end && i < lines.length; i++) {
    lines[i] = lines[i].replace(refRe, `${table}.${newCol}`);
  }
  return true;
}

// Cambia el tipo de una columna. Muta lines.
export function setColumnTypeInBlock(
  lines: string[],
  start: number,
  end: number,
  table: string,
  col: string,
  newType: string
): boolean {
  if (!/^[A-Za-z0-9_(),. ]+$/.test(newType)) return false;
  const range = findTableRange(lines, start, end, table);
  if (!range) return false;
  const [decl, close] = range;
  const ecol = esc(col);
  for (let i = decl + 1; i < close; i++) {
    const m = lines[i].match(
      new RegExp(`^(\\s*${ecol}\\s+)([^[\\n]+?)\\s*(\\[.*\\])?\\s*$`)
    );
    if (m) {
      const settings = m[3] ? ` ${m[3]}` : "";
      lines[i] = `${m[1]}${newType.trim()}${settings}`;
      return true;
    }
  }
  return false;
}

// ---- posiciones / vista persistidas como comentarios ----

export function parsePositions(src: string): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const re =
    /\/\/\s*@pos\s+"?([A-Za-z0-9_]+)"?\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = { x: parseFloat(m[2]), y: parseFloat(m[3]) };
  }
  return out;
}

export function parseView(src: string): { x: number; y: number; k: number } | null {
  const m = src.match(
    /\/\/\s*@view\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/
  );
  return m
    ? { x: parseFloat(m[1]), y: parseFloat(m[2]), k: parseFloat(m[3]) }
    : null;
}
