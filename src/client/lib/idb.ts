const DB_NAME = "echowiki";
const DB_VERSION = 1;
const ASSETS_STORE = "assets";
const META_STORE = "meta";

export type EchoAsset = {
  path: string;
  blob: Blob;
  mimeType: string;
  mappedPath?: string;
};

export type EchoMeta = {
  key: string;
  engine: string;
  gameTitle: string;
  importedAt: number;
  assetCount: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ASSETS_STORE)) {
          db.createObjectStore(ASSETS_STORE, { keyPath: "path" });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

export async function storeAsset(path: string, blob: Blob, mimeType: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    const store = tx.objectStore(ASSETS_STORE);
    const asset: EchoAsset = { path, blob, mimeType };
    const request = store.put(asset);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function storeAssetBatch(
  assets: ReadonlyArray<{ path: string; blob: Blob; mimeType: string }>,
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    const store = tx.objectStore(ASSETS_STORE);
    for (const a of assets) {
      store.put({
        path: a.path,
        blob: a.blob,
        mimeType: a.mimeType,
      } satisfies EchoAsset);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAsset(path: string): Promise<EchoAsset | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readonly");
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.get(path);
    request.onsuccess = () => resolve(request.result as EchoAsset | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function hasAssets(): Promise<boolean> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readonly");
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.count();
    request.onsuccess = () => resolve(request.result > 0);
    request.onerror = () => reject(request.error);
  });
}

export async function getAssetCount(): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readonly");
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function wipeAll(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ASSETS_STORE, META_STORE], "readwrite");
    tx.objectStore(ASSETS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listAssetPaths(): Promise<string[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readonly");
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getMeta(): Promise<EchoMeta | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const request = store.get("config");
    request.onsuccess = () => resolve(request.result as EchoMeta | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function setMeta(meta: Omit<EchoMeta, "key">): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const record: EchoMeta = { key: "config", ...meta };
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function applyMapping(mapping: Record<string, string>): Promise<Map<string, string>> {
  const db = await getDB();
  const entries = Object.entries(mapping);
  const result = new Map<string, string>();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const asset = cursor.value as EchoAsset;

      for (const [key, value] of entries) {
        if (asset.path.includes(key)) {
          const mapped = asset.path.replace(key, value);
          if (mapped !== asset.path) {
            asset.mappedPath = mapped;
            result.set(asset.path, mapped);
            cursor.update(asset);
          }
          break;
        }
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}
