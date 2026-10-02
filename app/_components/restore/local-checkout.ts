export type LocalCheckout = { croppedPhoto: Blob; clientSecret: string; sessionId?: string };
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("photo-restoration", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checkout");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Please enable browser storage to continue."));
  });
}
export async function localCheckout(value?: LocalCheckout | null): Promise<LocalCheckout | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("checkout", value === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("checkout");
      const request = value === undefined ? store.get("active") : value === null ? store.delete("active") : store.put(value, "active");
      transaction.oncomplete = () => resolve(value === undefined ? request.result : value || undefined);
      transaction.onerror = () => reject(new Error("We could not save checkout on this device."));
    });
  } finally { db.close(); }
}
