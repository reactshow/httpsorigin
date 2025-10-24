// ActionBridge Module: Directory Manager
// Directory selection, permissions, and handle management

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - directory-manager.js must be loaded after actionbridge.js');
        return;
    }

    AB.storeHandle = async function(handle) {
        if (!AB.db) await AB.openDatabase();
        return new Promise((resolve, reject) => {
            const tx = AB.db.transaction(['handles'], 'readwrite');
            const store = tx.objectStore('handles');
            const request = store.put(handle, 'main_directory');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    };

    AB.restoreHandle = async function() {
        if (!AB.db) await AB.openDatabase();
        return new Promise((resolve, reject) => {
            const tx = AB.db.transaction(['handles'], 'readonly');
            const store = tx.objectStore('handles');
            const request = store.get('main_directory');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    };

    AB.checkPermission = async function(handle) {
        if (!handle) return 'denied';
        try {
            return await handle.queryPermission({ mode: 'readwrite' });
        } catch (error) {
            return 'denied';
        }
    };

    AB.requestPermission = async function(handle) {
        if (!handle) return false;
        try {
            const permission = await handle.requestPermission({ mode: 'readwrite' });
            return permission === 'granted';
        } catch (error) {
            return false;
        }
    };

    AB.selectDirectory = async function() {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await AB.storeHandle(handle);
            AB.dirHandle = handle;

            AB.worker.postMessage({
                type: 'SET_DIRECTORY',
                data: { handle: handle }
            });

            AB.updateStatusBar();
            await AB.scanAvailableApps();
            AB.startPolling();

            console.log('✅ Directory selected and transferred to worker');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Directory selection failed:', error);
            }
        }
    };

    AB.tryRestoreDirectory = async function() {
        try {
            const handle = await AB.restoreHandle();
            if (!handle) return false;

            const permission = await AB.checkPermission(handle);

            if (permission === 'granted' || (permission === 'prompt' && await AB.requestPermission(handle))) {
                AB.dirHandle = handle;
                AB.worker.postMessage({
                    type: 'SET_DIRECTORY',
                    data: { handle: handle }
                });
                AB.updateStatusBar();
                await AB.scanAvailableApps();
                AB.startPolling();  // Auto-start polling when directory is restored
                console.log('✅ Directory restored and polling started');
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    };

})();
