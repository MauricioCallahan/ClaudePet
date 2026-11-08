import { app } from 'electron';

// Only one pet at a time: a second launch quits immediately. For now >:D
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(() => {
  console.log('ClaudePet ready');
});
