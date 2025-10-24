// ActionBridge Module: Database
// IndexedDB operations for storing directory handles

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - database.js must be loaded after actionbridge.js');
        return;
    }

    // Open IndexedDB database
    AB.openDatabase = async function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ActionBridgeDB', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                AB.db = request.result;
                resolve(AB.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles');
                }
            };
        });
    };

})();
