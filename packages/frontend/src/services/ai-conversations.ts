import type { AIMessage } from "@/types/ai";

const DB_NAME = "gateway-ai";
const DB_VERSION = 1;
const STORE_NAME = "conversations";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "name" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveConversation(name: string, messages: AIMessage[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ name, messages, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function restoreConversation(name: string): Promise<AIMessage[] | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(name);
    request.onsuccess = () => resolve(request.result?.messages ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function listConversations(): Promise<Array<{ name: string; savedAt: string }>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () =>
      resolve(
        (request.result || []).map((r: { name: string; savedAt: string }) => ({
          name: r.name,
          savedAt: r.savedAt,
        }))
      );
    request.onerror = () => reject(request.error);
  });
}

export async function dropConversation(name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
