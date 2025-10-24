// ActionBridge v4 - Sandboxed App Container with Minimal Status Bar
// High isolation: Apps run in sandboxed iframe, communicate via postMessage

(function() {
    'use strict';

    // ==================== Inline Worker Code ====================
    // Worker code has been extracted to worker/worker.js for better modularity

    // ==================== Main Thread Code ====================

    window.ActionBridge = {
        dirHandle: null,
        db: null,
        worker: null,

        // Multi-iframe support structure
        iframes: {
            // Default iframe (backwards compatible with single iframe setup)
            'default': {
                frameElement: null,
                queue: [],
                executionInProgress: false,
                currentApp: null
            }
        },

        // Backwards compatibility: appFrame getter/setter for default iframe
        get appFrame() {
            return this.iframes.default.frameElement;
        },
        set appFrame(frame) {
            this.iframes.default.frameElement = frame;
        },

        currentPollInterval: 100,
        stats: {
            processed: 0,
            succeeded: 0,
            failed: 0,
            timeout: 0
        },
        polling: false,
        availableApps: []
    };

    const AB = window.ActionBridge;

    // Load ActionBridge modules
    AB.loadModules = function() {
        return new Promise((resolve, reject) => {
            const modules = [
                'database.js',
                'directory-manager.js',
                'command-queue.js',
                'messaging.js',
                'iframe-manager.js',
                'app-loader.js',
                'ui-manager.js'
            ];

            let loadedCount = 0;
            const errors = [];

            function checkComplete() {
                if (loadedCount + errors.length === modules.length) {
                    if (errors.length > 0) {
                        reject(new Error('Failed to load modules: ' + errors.join(', ')));
                    } else {
                        console.log('✅ All modules loaded successfully');
                        resolve();
                    }
                }
            }

            modules.forEach(moduleName => {
                const script = document.createElement('script');
                script.src = moduleName;

                script.onload = function() {
                    loadedCount++;
                    console.log(`✓ Loaded ${moduleName}`);
                    checkComplete();
                };

                script.onerror = function() {
                    errors.push(moduleName);
                    console.error(`✗ Failed to load ${moduleName}`);
                    checkComplete();
                };

                document.head.appendChild(script);
            });
        });
    };

    AB.initWorker = function() {
        return new Promise((resolve, reject) => {
            // Load worker code by adding script tag to DOM
            // worker.js sets window.WORKER_CODE as a template literal
            const script = document.createElement('script');
            script.src = 'worker.js';

            script.onload = function() {
                try {
                    // worker.js has set window.WORKER_CODE
                    if (!window.WORKER_CODE) {
                        throw new Error('window.WORKER_CODE not found');
                    }

                    const blob = new Blob([window.WORKER_CODE], { type: 'application/javascript' });
                    const workerURL = URL.createObjectURL(blob);
                    AB.worker = new Worker(workerURL);

                    // Set up worker message handler
                    AB.worker.onmessage = function(e) {
            const { type, data, error, commandId, status, interval } = e.data;

            switch (type) {
                case 'DIRECTORY_SET':
                    console.log('✅ Worker received directory handle');
                    break;

                case 'POLLING_STARTED':
                    AB.polling = true;
                    AB.updateStatusBar();
                    console.log('🟢 Polling started');
                    break;

                case 'POLLING_STOPPED':
                    AB.polling = false;
                    AB.updateStatusBar();
                    console.log('🔴 Polling stopped');
                    break;

                case 'POLL_TICK':
                    AB.currentPollInterval = interval;
                    AB.visualizePollTick();
                    break;

                case 'COMMAND_QUEUED':
                    console.log(`📥 Command ${commandId} queued`);
                    break;

                case 'COMMAND_PROCESSING':
                    console.log(`⚙️  Processing command ${commandId}`);
                    break;

                case 'EXECUTE_COMMAND':
                    AB.executeCommandOnMainThread(data);
                    break;

                case 'COMMAND_COMPLETE':
                    AB.stats = data?.stats || AB.stats;
                    AB.updateStatusBar();
                    console.log(`✅ Command ${commandId} complete: ${status}`);
                    break;

                case 'STATS':
                    AB.stats = data;
                    AB.updateStatusBar();
                    break;

                case 'ERROR':
                    console.error('❌ Worker error:', error);
                    break;

                case 'POLL_ERROR':
                    console.error('⚠️ Polling error:', error);
                    break;
            }
                    };

                    AB.worker.onerror = function(error) {
                        console.error('Worker error:', error);
                    };

                    console.log('✅ Worker initialized');
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            script.onerror = function() {
                reject(new Error('Failed to load worker.js'));
            };

            document.head.appendChild(script);
        });
    };

    // Ensures sequential execution per iframe (no concurrent commands)

    // Queue a command for an iframe

    // Process next command in iframe's queue

    // Execute command on main thread or forward to iframe

    // Handle ActionBridge API commands

    // Load app into sandboxed iframe using query string pattern

    // Unload an app from an iframe

    // Load app with HTTPS bootstrap (for apps requiring origin)

    // Helper: Read file as text from connected directory

    // Helper: Inject code into bootstrap iframe via postMessage

    // Send message to app via postMessage (queued for sequential execution)

    // Internal implementation: Send message to app via postMessage

    // Execute JavaScript in app iframe (queued for sequential execution)
    // Returns a Promise that resolves with { result, console }

    // Internal implementation: Execute JavaScript in app iframe (via postMessage bridge)

    // Get app status

    // Minimize status bar

    // Expand status bar

    // Visualize poll tick

    // IndexedDB functions







    // Populate all iframe dropdowns with available apps


    AB.startPolling = function() {
        AB.worker.postMessage({ type: 'START_POLLING' });
    };

    AB.stopPolling = function() {
        AB.worker.postMessage({ type: 'STOP_POLLING' });
    };

    AB.isPolling = function() {
        return AB.polling;
    };


    AB.iframeCounter = 0;

    // Create a new iframe dynamically

    // Populate app dropdown for an iframe

    // Setup event listeners for iframe controls

    // Update queue count display for an iframe

    // Reload iframe (clear queue and reload app)

    // Reset queue for an iframe

    // Close iframe

    // Ensure there's always one empty iframe available


    // Handle iframe height update from app

    // Handle API test request from app (for testing CORS/null origin behavior)

    // Handle requests from sandboxed app

    // Save app data to filesystem

    // Load app data from filesystem

    // Delete app data

    // List all app data keys





    AB.init = async function() {
        try {
            document.title = 'ActionBridge v4 - Sandboxed App Container';

            // Load all modules first
            console.log('📦 Loading ActionBridge modules...');
            await AB.loadModules();

            // Then initialize worker, database, UI
            await AB.initWorker();
            await AB.openDatabase();
            AB.buildUI();
            await AB.tryRestoreDirectory();
            console.log('✅ ActionBridge v4 initialized');
        } catch (error) {
            console.error('Initialization error:', error);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', AB.init);
    } else {
        AB.init();
    }

})();
