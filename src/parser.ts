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
// Relación "usa" entre un Table/TablePartial y el TablePartial que inyecta
// via `~nombre`. Solo directa (from -> to); una cadena consumer->A->B se
// representa como dos entradas (consumer->A, A->B), nunca aplanada — así el
// grafo se lee sin ambigüedad y no necesita resolución de cadenas.
export interface PartialUse {
  from: string; // tabla o partial que hace `~to`
  to: string; // partial inyectado
}
export interface Model {
  tables: Table[];
  partials: Table[];
  refs: Ref[];
  uses: PartialUse[];
}

// Dado el índice de una comilla simple en src, devuelve el índice del carácter
// SIGUIENTE al cierre de esa cadena. Soporta cadenas triple ('''...'''),
// escape \' y cadenas de una línea sin cerrar (corta en el salto de línea, lo
// que hace que un apóstrofo suelto no desincronice el resto del documento).
function skipString(src: string, i: number): number {
  if (src[i] === "'" && src[i + 1] === "'" && src[i + 2] === "'") {
    const end = src.indexOf("'''", i + 3);
    return end < 0 ? src.length : end + 3;
  }
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "'") return j + 1;
    if (ch === "\n") return j; // cadena de una línea sin cerrar: apóstrofo suelto
    j++;
  }
  return src.length;
}

// Quita comentarios de línea // respetando cadenas entre comillas simples
// (así un Note: 'ver http://x' o un default con // no se trunca).
function stripLineComments(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'") {
      const end = skipString(input, i);
      out += input.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue; // el salto de línea lo agrega la próxima vuelta
    }
    out += ch;
    i++;
  }
  return out;
}

function scanBrace(src: string, openIdx: number, skipStr: boolean): number {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (skipStr && ch === "'") {
      i = skipString(src, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Dado el índice de un '{', devuelve el índice de su '}' emparejado contando
// profundidad. Primero intenta saltando cadenas; si no cierra (comillas raras),
// reintenta contando llaves crudas para NUNCA descartar una tabla por completo.
function matchBrace(src: string, openIdx: number): number {
  const withStr = scanBrace(src, openIdx, true);
  return withStr >= 0 ? withStr : scanBrace(src, openIdx, false);
}

// Encuentra bloques `algo { ... }` que matchean headerRe (su grupo 1 debe ser
// el nombre), emparejando llaves con matchBrace. No re-escanea dentro de un
// cuerpo ya encontrado (headerRe.lastIndex salta al cierre). Se usa tanto para
// TablePartial como para Table — dos regex distintos, misma lógica de barrido.
function findNamedBlocks(
  src: string,
  headerRe: RegExp
): { name: string; start: number; end: number; bodyStart: number; bodyEnd: number; body: string }[] {
  const out: {
    name: string;
    start: number;
    end: number;
    bodyStart: number;
    bodyEnd: number;
    body: string;
  }[] = [];
  headerRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(src)) !== null) {
    const name = m[1];
    const braceIdx = m.index + m[0].length - 1;
    const closeIdx = matchBrace(src, braceIdx);
    if (closeIdx < 0) continue;
    out.push({
      name,
      start: m.index,
      end: closeIdx + 1,
      bodyStart: braceIdx + 1,
      bodyEnd: closeIdx,
      body: src.slice(braceIdx + 1, closeIdx),
    });
    headerRe.lastIndex = closeIdx + 1; // no re-escanear dentro del cuerpo
  }
  return out;
}

// Expande bloques `TablePartial nombre { ... }` y las líneas de inyección
// `~nombre` dentro de un `Table { ... }`, por sustitución textual, antes de
// que el resto de parseDBML escanee las tablas. También captura, ANTES de
// sustituir nada, el grafo de "quién inyecta a quién" (`uses`): una vez hecha
// la sustitución, esas líneas `~nombre` desaparecen del texto (se convierten
// en columnas reales), así que es el único momento en que esa información
// existe.
//
// Cada línea `~nombre` dentro de un Table real se sustituye por el cuerpo
// resuelto del partial (columnas ya "pegadas" en el orden correcto), así que
// el resto del parser no necesita saber que los partials existen para ese
// caso: Refs, FKs y orden de filas funcionan sin cambios.
//
// Además, cada bloque `TablePartial nombre { ... }` se reescribe en el propio
// texto como un `Table nombre { ... }` equivalente (con su cuerpo también ya
// resuelto, incluyendo partials anidados). Esto permite que el partial se
// escanee con la MISMA lógica de columnas que cualquier tabla — sin duplicar
// ese parseo — y el resultado se muestra en el diagrama como un nodo aparte.
// `parseDBML` separa después esas entradas de `tables` usando `partialNames`.
//
// Soporta partials anidados (uno que inyecta a otro) con detección de ciclos;
// un `~nombre` que no resuelve a ningún partial se borra en silencio (mismo
// criterio que este parser ya aplica a Refs inválidas), y no genera entrada
// en `uses`.
export function expandTablePartials(
  input: string
): { text: string; partialNames: Set<string>; uses: PartialUse[] } {
  const partialDeclRe =
    /(?:^|\n)[ \t]*TablePartial[ \t]+"?([A-Za-z0-9_]+)"?\s*\{/g;
  const partialBlocks = findNamedBlocks(input, partialDeclRe);
  if (partialBlocks.length === 0)
    return { text: input, partialNames: new Set(), uses: [] };

  const raw = new Map(partialBlocks.map((b) => [b.name, b.body]));
  const partialNames = new Set(raw.keys());

  const injectRe = /^[ \t]*~"?([A-Za-z0-9_]+)"?[ \t]*$/;
  const uses: PartialUse[] = [];
  function scanUses(from: string, body: string) {
    for (const line of body.split("\n")) {
      const im = line.match(injectRe);
      if (im && partialNames.has(im[1])) uses.push({ from, to: im[1] });
    }
  }
  // usos partial -> partial: sobre el cuerpo crudo (antes de resolver), así
  // solo se registra el uso DIRECTO, nunca la cadena aplanada.
  for (const b of partialBlocks) scanUses(b.name, b.body);

  const resolved = new Map<string, string>();
  function resolve(name: string, stack: string[]): string {
    if (resolved.has(name)) return resolved.get(name)!;
    if (stack.includes(name)) return ""; // ciclo: corta aquí en vez de recursión infinita
    const body = raw.get(name);
    if (body === undefined) return ""; // partial inexistente: la línea ~x desaparece
    const out = body
      .split("\n")
      .map((line) => {
        const im = line.match(injectRe);
        return im ? resolve(im[1], [...stack, name]) : line;
      })
      .join("\n");
    resolved.set(name, out);
    return out;
  }

  // 1) sustituye cada bloque `TablePartial nombre { ... }` por un bloque
  //    `Table nombre { ... }` con el cuerpo ya resuelto. De atrás hacia
  //    delante, para no invalidar los índices de los bloques anteriores.
  let out = input;
  for (const b of [...partialBlocks].sort((a, b2) => b2.start - a.start)) {
    const body = resolve(b.name, []);
    out = out.slice(0, b.start) + `\nTable ${b.name} {${body}\n}` + out.slice(b.end);
  }

  // 2) localiza los bloques `Table` reales en el texto ya sustituido (mismo
  //    patrón que el declRe principal de parseDBML — deben coincidir 1:1 con
  //    lo que ese escaneo encontrará después). Para cada uno que NO sea un
  //    partial-convertido-en-Table (esos ya están resueltos y no tienen líneas
  //    ~nombre), registra sus usos directos y sustituye su cuerpo.
  const tableDeclRe =
    /(?:^|\n)[ \t]*(?:Table[ \t]+)?"?([A-Za-z0-9_]+)"?\s*(?:as\s+\w+\s*)?(?:\[([^\]]*)\]\s*)?\{/g;
  const tableBlocks = findNamedBlocks(out, tableDeclRe);
  for (const b of tableBlocks) {
    if (partialNames.has(b.name)) continue; // ya resuelto en el paso 1
    scanUses(b.name, b.body);
  }
  // sustitución en el propio `out`, de atrás hacia delante (por posición de
  // cuerpo, no de bloque completo, para tocar solo el interior de las llaves).
  for (const b of [...tableBlocks].sort((a, b2) => b2.bodyStart - a.bodyStart)) {
    if (partialNames.has(b.name)) continue;
    const newBody = b.body
      .split("\n")
      .map((line) => {
        const im = line.match(injectRe);
        return im ? resolve(im[1], []) : line;
      })
      .join("\n");
    if (newBody !== b.body)
      out = out.slice(0, b.bodyStart) + newBody + out.slice(b.bodyEnd);
  }

  return { text: out, partialNames, uses };
}

export function parseDBML(input: string): Model {
  const { text, partialNames, uses } = expandTablePartials(
    stripLineComments(input)
  );
  const src = text;
  const tables: Table[] = [];
  const refs: Ref[] = [];

  const relRe =
    /(?:Ref:\s*)?([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*(<>|>|<|-)\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;
  // Declaración de tabla: 'Table' opcional, nombre (opc. entre comillas),
  // 'as alias' opcional, [settings] opcional, hasta la '{' de apertura.
  const declRe =
    /(?:^|\n)[ \t]*(?:Table[ \t]+)?"?([A-Za-z0-9_]+)"?\s*(?:as\s+\w+\s*)?(?:\[([^\]]*)\]\s*)?\{/g;

  const bodies: [number, number][] = [];
  let m: RegExpExecArray | null;

  while ((m = declRe.exec(src)) !== null) {
    const name = m[1];
    const settings = m[2] || "";
    const braceIdx = m.index + m[0].length - 1; // m[0] termina en '{'
    const closeIdx = matchBrace(src, braceIdx);
    if (closeIdx < 0) continue;
    const body = src.slice(braceIdx + 1, closeIdx);
    bodies.push([m.index, closeIdx + 1]);

    const cols: Column[] = [];
    let tableNote: string | undefined;
    const hcMatch = settings.match(
      /header[_ ]?color:\s*([#A-Za-z0-9(),.\s%]+?)\s*(?:,|$)/i
    );
    const headerColor = hcMatch ? hcMatch[1].trim() : undefined;

    let skipDepth = 0; // para saltar sub-bloques tipo indexes { ... }
    for (let line of body.split("\n")) {
      line = line.trim();
      if (skipDepth > 0) {
        for (const ch of line) {
          if (ch === "{") skipDepth++;
          else if (ch === "}") skipDepth--;
        }
        continue;
      }
      if (!line || line === "{" || line === "}") continue;
      const tn = line.match(/^Note:\s*'([^']*)'/i);
      if (tn) {
        tableNote = tn[1];
        continue;
      }
      if (/^indexes\b/i.test(line)) {
        // salta el bloque indexes { ... } si abre llave en esta o próximas líneas
        for (const ch of line) {
          if (ch === "{") skipDepth++;
          else if (ch === "}") skipDepth--;
        }
        continue;
      }
      const cm = line.match(/^([A-Za-z0-9_]+)\s+([^[\n]+?)\s*(\[.*\])?\s*$/);
      if (!cm) continue;
      const rawAttrs = cm[3] || "";
      const attrs = rawAttrs.toLowerCase();
      const noteM = rawAttrs.match(/note:\s*'([^']*)'/i);
      // pk / not null se detectan sobre los atributos sin la nota (evita falsos positivos)
      const flags = attrs.replace(/note:\s*'[^']*'/i, "");
      const col: Column = {
        name: cm[1],
        type: cm[2],
        pk: /\bpk\b|\bprimary key\b/.test(flags),
        fk: false,
        nn: /\bnot null\b/.test(flags),
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
      }
    }
    tables.push({ name, note: tableNote, headerColor, cols });
    declRe.lastIndex = closeIdx + 1; // no re-escanear dentro del cuerpo
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

  // Valida y deduplica refs: descarta las que apuntan a tablas/columnas
  // inexistentes (typos y "refs fantasma" de prosa) y las duplicadas.
  const byName = new Map(tables.map((t) => [t.name, t]));
  const seen = new Set<string>();
  const validRefs: Ref[] = [];
  for (const r of refs) {
    const tf = byName.get(r.from);
    const tt = byName.get(r.to);
    if (!tf || !tt) continue;
    if (!tf.cols.some((c) => c.name === r.fromCol)) continue;
    if (!tt.cols.some((c) => c.name === r.toCol)) continue;
    const key = `${r.from}.${r.fromCol}|${r.op}|${r.to}.${r.toCol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    validRefs.push(r);
  }

  // Los TablePartial se escanearon como si fueran tablas (para reusar el
  // parseo de columnas), pero no son tablas reales del diagrama: se separan
  // aquí. Cualquier Ref que involucre a uno de ellos se descarta — un partial
  // no es un extremo válido de relación (esto solo ocurre si el partial trae
  // un `ref:` inline en su propia definición, caso excepcional).
  const realTables = tables.filter((t) => !partialNames.has(t.name));
  const partials = tables.filter((t) => partialNames.has(t.name));
  const cleanRefs = validRefs.filter(
    (r) => !partialNames.has(r.from) && !partialNames.has(r.to)
  );

  // marca FKs (lado 'from' de cada relación) — sobre cleanRefs, para no
  // marcar como fk una columna de un partial cuya Ref se acaba de descartar.
  for (const r of cleanRefs) {
    const c = byName.get(r.from)?.cols.find((c) => c.name === r.fromCol);
    if (c) c.fk = true;
  }

  // filtro defensivo: `uses` se calculó sobre un escaneo de bloques paralelo
  // al de `tables`/`partials`; esto solo protege contra una divergencia
  // (p.ej. un bloque malformado que un escaneo aceptó y el otro no).
  const validNames = new Set([...realTables, ...partials].map((t) => t.name));
  const cleanUses = uses.filter(
    (u) => validNames.has(u.from) && partialNames.has(u.to)
  );

  return { tables: realTables, partials, refs: cleanRefs, uses: cleanUses };
}

// Reemplaza coincidencias de re en line solo FUERA de cadenas entre comillas
// simples (no toca el texto de notas).
function replaceOutsideStrings(
  line: string,
  re: RegExp,
  repl: string
): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const q = line.indexOf("'", i);
    if (q < 0) {
      out += line.slice(i).replace(re, repl);
      break;
    }
    out += line.slice(i, q).replace(re, repl);
    const end = line.indexOf("'", q + 1);
    if (end < 0) {
      out += line.slice(q); // comilla sin cerrar: deja el resto tal cual
      break;
    }
    out += line.slice(q, end + 1); // segmento de cadena intacto
    i = end + 1;
  }
  return out;
}

// Edita la línea de declaración de una tabla para fijar/quitar headercolor.
// Tolera la '{' en esta línea o en la siguiente (consistente con findTableRange).
// Devuelve la línea nueva, o null si la línea no declara esa tabla.
export function setHeaderColorInLine(
  line: string,
  tableName: string,
  color: string | null
): string | null {
  if (color !== null && /[\]',\n]|\/\//.test(color)) return null; // evita romper el bloque
  const e = esc(tableName);
  const re = new RegExp(
    `^(\\s*(?:Table\\s+)?"?${e}"?\\s*(?:as\\s+\\w+\\s*)?)(\\[[^\\]]*\\])?\\s*(\\{.*)?$`
  );
  const m = line.match(re);
  if (!m) return null;
  const head = m[1].replace(/\s+$/, "");
  const inner = (m[2] || "").replace(/^\[|\]$/g, "");
  const rest = m[3] ? " " + m[3].replace(/^\s*/, "") : "";

  // separa settings por coma respetando comillas simples
  const parts = inner
    ? inner
        .split(/,(?=(?:[^']*'[^']*')*[^']*$)/)
        .map((p) => p.trim())
        .filter(Boolean)
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

// localiza [lineaDeclaracion, lineaCierre] de una tabla dentro del rango del bloque.
// El conteo de llaves ignora las que aparezcan dentro de cadenas entre comillas.
function findTableRange(
  lines: string[],
  start: number,
  end: number,
  name: string
): [number, number] | null {
  const e = esc(name);
  const declRe = new RegExp(
    `^\\s*(?:Table\\s+)?"?${e}"?\\s*(?:as\\s+\\w+\\s*)?(?:\\[[^\\]]*\\]\\s*)?\\{?`
  );
  let decl = -1;
  for (let i = start; i <= end && i < lines.length; i++) {
    if (declRe.test(lines[i])) {
      decl = i;
      break;
    }
  }
  if (decl < 0) return null;
  // reúsa el emparejado robusto de matchBrace sobre el texto del rango
  const lastLine = Math.min(end, lines.length - 1);
  const seg = lines.slice(decl, lastLine + 1).join("\n");
  const openIdx = seg.indexOf("{");
  if (openIdx < 0) return null;
  const closeOff = matchBrace(seg, openIdx);
  if (closeOff < 0) return null;
  let close = decl;
  for (let k = 0; k < closeOff; k++) if (seg[k] === "\n") close++;
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
  // referencias tabla.col: solo fuera de cadenas y solo cuando hay columna detrás
  const refRe = new RegExp(`\\b${e}\\.(?=[A-Za-z0-9_])`, "g");
  const posRe = new RegExp(`^(\\s*//\\s*@pos\\s+)"?${e}"?(\\s)`);
  for (let i = start; i <= end && i < lines.length; i++) {
    if (i === decl) continue;
    const pos = lines[i].match(posRe);
    if (pos) {
      lines[i] = lines[i].replace(posRe, `$1${newName}$2`);
      continue; // los @pos no contienen refs reales
    }
    if (/^\s*\/\/\s*@edge\b/.test(lines[i])) {
      lines[i] = rewriteEdgeLine(lines[i], (f, fc, t, tc) => [
        f === oldName ? newName : f,
        fc,
        t === oldName ? newName : t,
        tc,
      ]);
      continue; // los @edge no contienen refs reales
    }
    lines[i] = replaceOutsideStrings(lines[i], refRe, `${newName}.`);
  }
  return true;
}

// Elimina una tabla del bloque: su declaración, los comentarios @pos/@edge que
// la mencionan y las relaciones Ref: independientes que la referencian en
// cualquier extremo. Muta lines (borrando líneas). Devuelve false si no existe.
export function deleteTableInBlock(
  lines: string[],
  start: number,
  end: number,
  name: string
): boolean {
  const range = findTableRange(lines, start, end, name);
  if (!range) return false;
  const [decl, close] = range;
  const e = esc(name);
  const toDelete = new Set<number>();
  for (let i = decl; i <= close; i++) toDelete.add(i);
  const refRe = new RegExp(`\\b${e}\\.[A-Za-z0-9_]+`);
  const posRe = new RegExp(`^\\s*//\\s*@pos\\s+"?${e}"?(\\s|$)`);
  const edgeRe = new RegExp(
    `^\\s*//\\s*@edge\\s+"?([A-Za-z0-9_]+)"?\\s+"?[A-Za-z0-9_]+"?\\s+"?([A-Za-z0-9_]+)"?\\s`
  );
  for (let i = start; i <= end && i < lines.length; i++) {
    if (toDelete.has(i)) continue;
    if (posRe.test(lines[i])) {
      toDelete.add(i);
      continue;
    }
    const em = lines[i].match(edgeRe);
    if (em) {
      if (em[1] === name || em[2] === name) toDelete.add(i);
      continue;
    }
    if (/^\s*Ref\s*:/i.test(lines[i]) && refRe.test(lines[i])) toDelete.add(i);
  }
  for (const i of [...toDelete].sort((a, b) => b - a)) lines.splice(i, 1);
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
    if (/^\s*\/\/\s*@edge\b/.test(lines[i])) {
      lines[i] = rewriteEdgeLine(lines[i], (f, fc, t, tc) => [
        f,
        f === table && fc === oldCol ? newCol : fc,
        t,
        t === table && tc === oldCol ? newCol : tc,
      ]);
      continue;
    }
    lines[i] = replaceOutsideStrings(lines[i], refRe, `${table}.${newCol}`);
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

// Cambia el operador de cardinalidad de una relación (<, >, -, <>). Busca tanto
// la forma independiente (`Ref: a.c > b.c`) como la inline dentro de la columna
// de origen (`c tipo [ref: > b.c]`). Muta lines. Devuelve false si no la halla.
export function setRefOpInBlock(
  lines: string[],
  start: number,
  end: number,
  ref: { from: string; fromCol: string; to: string; toCol: string },
  newOp: string
): boolean {
  if (!/^(<>|>|<|-)$/.test(newOp)) return false;
  const ef = esc(ref.from),
    efc = esc(ref.fromCol),
    et = esc(ref.to),
    etc = esc(ref.toCol);
  // 1) forma independiente: a.c OP b.c (con o sin "Ref:")
  const standalone = new RegExp(
    `^(\\s*(?:Ref:\\s*)?"?${ef}"?\\.${efc}\\s*)(<>|>|<|-)(\\s*"?${et}"?\\.${etc})`
  );
  for (let i = start; i <= end && i < lines.length; i++) {
    if (/^\s*\/\/\s*@/.test(lines[i])) continue;
    if (standalone.test(lines[i])) {
      lines[i] = lines[i].replace(standalone, `$1${newOp}$3`);
      return true;
    }
  }
  // 2) inline en la columna de origen dentro de la tabla `from`
  const range = findTableRange(lines, start, end, ref.from);
  if (range) {
    const [decl, close] = range;
    const colRe = new RegExp(`^\\s*${efc}\\s`);
    const inlineRe = new RegExp(
      `(ref:\\s*)(<>|>|<|-)(\\s*"?${et}"?\\.${etc})`,
      "i"
    );
    for (let i = decl + 1; i < close; i++) {
      if (colRe.test(lines[i]) && inlineRe.test(lines[i])) {
        lines[i] = lines[i].replace(inlineRe, `$1${newOp}$3`);
        return true;
      }
    }
  }
  return false;
}

// ---- posiciones / vista persistidas como comentarios ----

export function parsePositions(
  src: string
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const re =
    /\/\/\s*@pos\s+"?([A-Za-z0-9_]+)"?\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = { x: parseFloat(m[2]), y: parseFloat(m[3]) };
  }
  return out;
}

export function parseView(
  src: string
): { x: number; y: number; k: number } | null {
  const m = src.match(
    /\/\/\s*@view\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/
  );
  return m
    ? { x: parseFloat(m[1]), y: parseFloat(m[2]), k: parseFloat(m[3]) }
    : null;
}

export function parseSize(src: string): { w: number; h: number } | null {
  const m = src.match(/\/\/\s*@size\s+(\d+)\s+(\d+)/);
  return m ? { w: parseInt(m[1], 10), h: parseInt(m[2], 10) } : null;
}

// Rutas de aristas editadas a mano: // @edge FROM FCOL TO TCOL x1 y1 x2 y2 …
// (solo los waypoints intermedios; los extremos se reanclan a los puertos).
// Clave de salida: `FROM.FCOL->TO.TCOL`.
export function parseEdges(
  src: string
): Record<string, { x: number; y: number }[]> {
  const out: Record<string, { x: number; y: number }[]> = {};
  const re =
    /\/\/\s*@edge\s+"?([A-Za-z0-9_]+)"?\s+"?([A-Za-z0-9_]+)"?\s+"?([A-Za-z0-9_]+)"?\s+"?([A-Za-z0-9_]+)"?((?:\s+-?\d+(?:\.\d+)?){2,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const nums = m[5].trim().split(/\s+/).map(Number);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2)
      pts.push({ x: nums[i], y: nums[i + 1] });
    if (pts.length) out[`${m[1]}.${m[2]}->${m[3]}.${m[4]}`] = pts;
  }
  return out;
}

// Reescribe los identificadores de una línea // @edge (from/fcol/to/tcol),
// dejando intactos los waypoints. Devuelve la línea sin cambios si no es @edge.
function rewriteEdgeLine(
  line: string,
  fn: (from: string, fcol: string, to: string, tcol: string) => [string, string, string, string]
): string {
  const m = line.match(
    /^(\s*\/\/\s*@edge\s+)"?([A-Za-z0-9_]+)"?(\s+)"?([A-Za-z0-9_]+)"?(\s+)"?([A-Za-z0-9_]+)"?(\s+)"?([A-Za-z0-9_]+)"?(\s.*)?$/
  );
  if (!m) return line;
  const [f, fc, t, tc] = fn(m[2], m[4], m[6], m[8]);
  return `${m[1]}${f}${m[3]}${fc}${m[5]}${t}${m[7]}${tc}${m[9] ?? ""}`;
}
