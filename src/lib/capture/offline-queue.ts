const DB_NAME = 'intel-capture';
const STORE_NAME = 'pending-notes';
const DB_VERSION = 1;

interface PendingNote {
  id?: number;
  title: string;
  content: string;
  format: string;
  file?: { name: string; type: string; data: ArrayBuffer };
  createdAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueNote(note: Omit<PendingNote, 'id' | 'createdAt'>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({ ...note, createdAt: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingNotes(): Promise<PendingNote[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingNote(id: number): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function syncPendingNotes(): Promise<number> {
  const notes = await getPendingNotes();
  let synced = 0;

  for (const note of notes) {
    try {
      const form = new FormData();
      if (note.title) form.append('title', note.title);
      if (note.content) form.append('content', note.content);
      form.append('source', 'pwa');
      form.append('format', note.format);

      if (note.file) {
        const blob = new Blob([note.file.data], { type: note.file.type });
        form.append('file', new File([blob], note.file.name, { type: note.file.type }));
      }

      const res = await fetch('/api/jkai/intel/ingest', {
        method: 'POST',
        body: form,
      });

      if (res.ok) {
        await removePendingNote(note.id!);
        synced++;
      }
    } catch {
      break;
    }
  }

  return synced;
}
