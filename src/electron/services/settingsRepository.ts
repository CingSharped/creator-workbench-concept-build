import { readDatabase, updateDatabase } from "./database";

export function getAppSetting(key: string): string | null {
  return readDatabase().appSettings[key]?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  updateDatabase((store) => {
    store.appSettings[key] = {
      value,
      updatedAt: new Date().toISOString()
    };
  });
}

export function clearAppSetting(key: string): void {
  updateDatabase((store) => {
    delete store.appSettings[key];
  });
}
