// IndexedDB key/value store: imported models, background assets (asset:*) and saved takes (take:*).
const ST = 'models';
// FIX: a new connection was opened (and never closed) for every read/write; keep one and reopen if the browser closes it.
let dbp: Promise<IDBDatabase> | null = null;
const open = () => {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('mocapstudio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => { r.result.onclose = () => { dbp = null; }; r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
};
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => { const r = fn(db.transaction(ST, mode).objectStore(ST)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
};
export const putRaw = (key: string, v: unknown) => tx('readwrite', (s) => s.put(v, key));
export const getRaw = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key));
export const delRaw = (key: string) => tx('readwrite', (s) => s.delete(key));
export const keys = (prefix?: string) => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => k.map(String).filter((x) => (prefix ? x.startsWith(prefix) : !x.includes(':'))));
// models (keys without a prefix)
export const saveModel = (f: File) => putRaw(f.name, f);
export const listModels = () => keys();
export const getModel = (name: string) => getRaw<File>(name);
export const deleteModel = (name: string) => delRaw(name);
