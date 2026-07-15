// Minimal i18n: a flat dictionary per language and a t() lookup with {var}
// interpolation. The active language is module state set by the plugin from its
// settings (default English); menus/modals read it when they open.

export type Lang = "en" | "es";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

type Dict = Record<string, string>;

const en: Dict = {
  // render states / errors
  parseError: "Parse error: {msg}",
  noTables: "DBML has no tables.",
  rendering: "Rendering ERD…",
  layoutError: "Layout error: {msg}",
  includeError: "DBML @include: {msg}",
  // edge menu
  resetRoute: "Reset route",
  relOneToMany: "One to many (1 → ∞)",
  relManyToOne: "Many to one (∞ → 1)",
  relOneToOne: "One to one (1 → 1)",
  relManyToMany: "Many to many (∞ ↔ ∞)",
  deselect: "Deselect",
  deleteVertex: "Delete vertex",
  // header menu
  renameTable: "Rename table…",
  renameTablePrompt: "New table name",
  pickColor: "Pick color…",
  removeColor: "Remove color",
  deleteTableMenu: "Delete table…",
  deleteTableTitle: "Delete table",
  deleteTableBody:
    'Delete table "{name}" from the diagram? Its definition and the relationships that reference it will be removed.',
  deleteBtn: "Delete",
  // column menu
  renameColumn: "Rename column…",
  renameColumnPrompt: "New column name",
  changeType: "Change type…",
  changeTypePrompt: "New data type",
  // notices / failures
  locateBlockFail: "DBML ERD: could not locate the block to edit.",
  externalEditWarn:
    '"{name}" is defined in an included file (@include) and can\'t be edited from this block — edit it in that file.',
  externalRelWarn:
    "This relation ({rel}) is defined in an included file (@include) and can't be changed from this block — edit it in that file.",
  // modals
  cancel: "Cancel",
  save: "Save",
  // settings
  settingsLanguage: "Language",
  settingsLanguageDesc: "Interface language for menus, dialogs and notices.",
  settingsCrowFoot: "Crow's foot style",
  settingsCrowFootDesc:
    "Inverted opens the fan on the entity (clear crow's foot). Original converges on the entity (looks like an arrow on horizontal links).",
  crowFootInverted: "Inverted",
  crowFootOriginal: "Original",
};

const es: Dict = {
  parseError: "Error de parseo: {msg}",
  noTables: "DBML sin tablas.",
  rendering: "Renderizando ERD…",
  layoutError: "Error de layout: {msg}",
  includeError: "DBML @include: {msg}",
  resetRoute: "Restablecer ruta",
  relOneToMany: "Uno a muchos (1 → ∞)",
  relManyToOne: "Muchos a uno (∞ → 1)",
  relOneToOne: "Uno a uno (1 → 1)",
  relManyToMany: "Muchos a muchos (∞ ↔ ∞)",
  deselect: "Deseleccionar",
  deleteVertex: "Eliminar vértice",
  renameTable: "Renombrar tabla…",
  renameTablePrompt: "Nuevo nombre de la tabla",
  pickColor: "Elegir color…",
  removeColor: "Quitar color",
  deleteTableMenu: "Eliminar tabla…",
  deleteTableTitle: "Eliminar tabla",
  deleteTableBody:
    '¿Eliminar la tabla "{name}" del diagrama? Se borrará su definición y las relaciones que la referencian.',
  deleteBtn: "Eliminar",
  renameColumn: "Renombrar columna…",
  renameColumnPrompt: "Nuevo nombre de la columna",
  changeType: "Cambiar tipo…",
  changeTypePrompt: "Nuevo tipo de dato",
  locateBlockFail: "DBML ERD: no se pudo ubicar el bloque para editar.",
  externalEditWarn:
    '"{name}" está definida en un archivo incluido (@include) y no se puede editar desde este bloque — edítala en ese archivo.',
  externalRelWarn:
    "Esta relación ({rel}) está definida en un archivo incluido (@include) y no se puede cambiar desde este bloque — edítala en ese archivo.",
  cancel: "Cancelar",
  save: "Guardar",
  settingsLanguage: "Idioma",
  settingsLanguageDesc:
    "Idioma de la interfaz para menús, diálogos y avisos.",
  settingsCrowFoot: "Estilo de pata de gallo",
  settingsCrowFootDesc:
    "Invertido abre el abanico sobre la entidad (pata de gallo clara). Original converge en la entidad (parece una flecha en enlaces horizontales).",
  crowFootInverted: "Invertido",
  crowFootOriginal: "Original",
};

const dicts: Record<Lang, Dict> = { en, es };

let current: Lang = "en";

export function setLang(l: Lang) {
  current = l === "es" ? "es" : "en";
}
export function getLang(): Lang {
  return current;
}

export function t(key: string, vars?: Record<string, string>): string {
  let s = dicts[current][key] ?? en[key] ?? key;
  if (vars)
    for (const [k, v] of Object.entries(vars))
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  return s;
}