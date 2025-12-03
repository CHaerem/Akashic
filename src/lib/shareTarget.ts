/**
 * Share Target utilities for handling photos shared from iOS/Android
 * Uses IndexedDB to store files temporarily until they can be uploaded
 */

const DB_NAME = 'akashic-share-target';
const STORE_NAME = 'shared-files';
const DB_VERSION = 1;

export interface SharedFile {
    id: string;
    file: File;
    timestamp: number;
}

/**
 * Open the IndexedDB database for share target storage
 */
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

/**
 * Store shared files in IndexedDB
 */
export async function storeSharedFiles(files: File[]): Promise<string[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const ids: string[] = [];

    for (const file of files) {
        const id = `share-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const sharedFile: SharedFile = {
            id,
            file,
            timestamp: Date.now(),
        };
        store.put(sharedFile);
        ids.push(id);
    }

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            db.close();
            resolve(ids);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Get all pending shared files from IndexedDB
 */
export async function getPendingSharedFiles(): Promise<SharedFile[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            db.close();
            resolve(request.result || []);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

/**
 * Clear all shared files from IndexedDB
 */
export async function clearSharedFiles(): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Remove specific shared files by IDs
 */
export async function removeSharedFiles(ids: string[]): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const id of ids) {
        store.delete(id);
    }

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Check if there are pending shared files
 */
export async function hasPendingShares(): Promise<boolean> {
    const files = await getPendingSharedFiles();
    return files.length > 0;
}
