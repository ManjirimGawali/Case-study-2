import { CFG } from '../config.js';
import { fileStore } from './fileStore.js';

export let store = fileStore;
export async function initStore() {
  if (CFG.MONGO_URL) store = (await import('./mongoStore.js')).mongoStore;
  await store.init();
  return store;
}
