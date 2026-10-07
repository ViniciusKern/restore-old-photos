import { isRestorationId } from "@/app/_lib/restoration-id";

export type LocalCheckout = {
  restorationId: string;
  croppedPhoto: Blob;
  clientSecret: string;
  sessionId: string;
};
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("photo-restoration", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("orders")) request.result.createObjectStore("orders");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Please enable browser storage to continue."));
  });
}
async function accessCheckout(id: string, value?: LocalCheckout): Promise<LocalCheckout | undefined> {
  if (!isRestorationId(id)) throw new Error("Invalid restoration link.");
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("orders", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("orders");
      const request = value ? store.put(value, id) : store.get(id);
      transaction.oncomplete = () => {
        const record = value || request.result;
        resolve(record?.restorationId === id ? record : undefined);
      };
      transaction.onerror = () => reject(new Error("We could not save checkout on this device."));
    });
  } finally { db.close(); }
}

export const readCheckout = (id: string) => accessCheckout(id);
export const saveCheckout = (value: LocalCheckout) => accessCheckout(value.restorationId, value);
