import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Installed pets, one folder per pet named after its id: %APPDATA%\ClaudePet\pets\<id>\.
export const userPetsDir = () => path.join(app.getPath('userData'), 'pets');

// A folder we can't create only means no installed pets; it must not stop the app.
export function ensurePetsDir(): void {
  try {
    fs.mkdirSync(userPetsDir(), { recursive: true });
  } catch (err) {
    console.error('Could not create the pets folder:', (err as Error).message);
  }
}

// Shipped with the app and read in place, like assets/tray.ico.
export const builtInPetsDir = path.join(__dirname, '../../assets/pets');
