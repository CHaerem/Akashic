/**
 * Share Target handler for service worker
 * Intercepts POST requests to /share-target and stores files in IndexedDB
 */

const DB_NAME = 'akashic-share-target';
const STORE_NAME = 'shared-files';
const DB_VERSION = 1;

// Open IndexedDB
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

// Store files in IndexedDB
async function storeFiles(files) {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const file of files) {
        const id = `share-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        store.put({ id, file, timestamp: Date.now() });
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

// Handle share target POST requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle POST requests to /share-target
    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        event.respondWith(handleShareTarget(event.request));
    }
});

async function handleShareTarget(request) {
    try {
        const formData = await request.formData();
        const files = formData.getAll('photos');

        if (files.length > 0) {
            // Filter to only File objects (not strings)
            const imageFiles = files.filter(f => f instanceof File && f.type.startsWith('image/'));

            if (imageFiles.length > 0) {
                await storeFiles(imageFiles);
            }
        }

        // Redirect to the app with a flag indicating shared files are waiting
        return Response.redirect('/?shared=pending', 303);
    } catch (error) {
        console.error('Share target error:', error);
        // Redirect to app even on error
        return Response.redirect('/?shared=error', 303);
    }
}
