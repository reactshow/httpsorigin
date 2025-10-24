// ActionBridge Module: App Loader
// App loading and management

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - app-loader.js must be loaded after actionbridge.js');
        return;
    }

    AB.loadApp = async function(appName, iframeId) {
        iframeId = iframeId || 'default';

        const iframe = AB.iframes[iframeId];
        if (!iframe || !iframe.frameElement) {
            throw new Error('App frame not initialized for iframe: ' + iframeId);
        }

        // SECURITY: Prevent apps from loading until directory is connected
        if (!AB.dirHandle) {
            throw new Error('Cannot load app: No directory connected. Please select a directory first.');
        }

        // RESTRICTION: One app per iframe - check if app is already loaded elsewhere
        for (const [otherId, otherIframe] of Object.entries(AB.iframes)) {
            if (otherId !== iframeId && otherIframe.currentApp === appName) {
                alert(`App "${appName}" is already loaded in iframe "${otherId}". Only one instance per app is allowed.`);
                // Reset dropdown to empty
                const dropdown = document.querySelector(`.ab-app-dropdown[data-iframe-id="${iframeId}"]`);
                if (dropdown) dropdown.value = '';
                throw new Error(`App "${appName}" is already loaded in iframe "${otherId}"`);
            }
        }

        // Use query string pattern: index.html?app=APP_NAME
        const appUrl = 'index.html?app=' + encodeURIComponent(appName);
        iframe.frameElement.src = appUrl;
        iframe.currentApp = appName;

        // Enable reload button
        const reloadBtn = document.querySelector(`[data-action="reload"][data-iframe-id="${iframeId}"]`);
        if (reloadBtn) {
            reloadBtn.disabled = false;
        }

        // Ensure there's always an empty iframe available
        AB.ensureEmptyIframe();

        return { loaded: true, method: 'src', app: appName, iframeId: iframeId };
    };

    AB.unloadApp = function(appName, iframeId) {
        // If iframeId provided, use it directly
        // If only appName provided, find which iframe has that app
        let targetIframeId = iframeId;

        if (!targetIframeId && appName) {
            // Search for the iframe containing this app
            for (const [id, iframe] of Object.entries(AB.iframes)) {
                if (iframe.currentApp === appName) {
                    targetIframeId = id;
                    break;
                }
            }
        }

        if (!targetIframeId) {
            throw new Error(`Cannot unload: App "${appName}" is not currently loaded`);
        }

        const iframe = AB.iframes[targetIframeId];
        if (!iframe || !iframe.frameElement) {
            throw new Error('Iframe not found: ' + targetIframeId);
        }

        const unloadedApp = iframe.currentApp;

        console.log(`🗑️ Unloaded app "${unloadedApp}" from iframe "${targetIframeId}"`);

        // Close the iframe entirely (same as clicking close button)
        // This removes the wrapper from DOM and deletes from iframes object
        AB.closeIframe(targetIframeId);

        return { unloaded: true, app: unloadedApp, iframeId: targetIframeId };
    };

    AB.loadAppWithHTTPSBootstrap = async function(appName, bootstrapUrl, iframeId) {
        iframeId = iframeId || 'default';

        const iframe = AB.iframes[iframeId];
        if (!iframe || !iframe.frameElement) {
            throw new Error('App frame not initialized for iframe: ' + iframeId);
        }

        // SECURITY: Prevent apps from loading until directory is connected
        if (!AB.dirHandle) {
            throw new Error('Cannot load app: No directory connected. Please select a directory first.');
        }

        console.log('🚀 Loading app with HTTPS bootstrap:', appName);
        console.log('   Bootstrap URL:', bootstrapUrl);

        // Step 1: Load bootstrap HTML from HTTPS URL
        iframe.frameElement.src = bootstrapUrl;
        iframe.currentApp = appName;

        // Step 2: Wait for BOOTSTRAP_READY message
        console.log('⏳ Waiting for BOOTSTRAP_READY from bootstrap HTML...');
        const bootstrapReady = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Bootstrap timeout: No BOOTSTRAP_READY received'));
            }, 10000);

            const handler = (event) => {
                if (event.data.type === 'BOOTSTRAP_READY') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);
                    console.log('✅ BOOTSTRAP_READY received');
                    console.log('   Origin:', event.data.origin);
                    console.log('   Protocol:', event.data.protocol);
                    resolve(event.data);
                }
            };

            window.addEventListener('message', handler);
        });

        // Step 3: Read app JavaScript file from filesystem
        console.log('📖 Reading app code from filesystem...');
        const appCode = await AB.readFileAsText(`apps/${appName}/${appName}.js`);
        console.log('✅ Read app code:', appCode.length, 'bytes');

        // Step 4: Combine iframe infrastructure + app code into single injection
        console.log('💉 Preparing combined injection (infrastructure + app)...');
        const iframeInfraCode = `
            // Iframe Infrastructure for HTTPS Bootstrap
            (function() {
                'use strict';

                console.log('🔧 Setting up iframe infrastructure...');

                // Global error handler - catches all uncaught errors
                window.addEventListener('error', function(event) {
                    window.parent.postMessage({
                        type: 'AB_IFRAME_ERROR',
                        error: {
                            message: event.message,
                            filename: event.filename,
                            lineno: event.lineno,
                            colno: event.colno,
                            stack: event.error ? event.error.stack : null
                        },
                        timestamp: Date.now()
                    }, '*');
                    return false;
                });

                // Unhandled promise rejection handler
                window.addEventListener('unhandledrejection', function(event) {
                    window.parent.postMessage({
                        type: 'AB_IFRAME_PROMISE_REJECTION',
                        error: {
                            message: event.reason ? event.reason.message || String(event.reason) : 'Unknown rejection',
                            stack: event.reason ? event.reason.stack : null
                        },
                        timestamp: Date.now()
                    }, '*');
                    return false;
                });

                // Command execution handler with console capture
                window.addEventListener('message', function(event) {
                    const message = event.data;
                    if (message.type !== 'AB_EXECUTE_JS') return;

                    const response = {
                        type: 'AB_EXECUTE_JS_RESPONSE',
                        requestId: message.requestId,
                        success: false,
                        result: null,
                        error: null,
                        console: []
                    };

                    (async function() {
                        const originalLog = console.log;
                        const originalWarn = console.warn;
                        const originalError = console.error;
                        const capturedConsole = [];

                        console.log = function(...args) {
                            capturedConsole.push({ level: 'log', message: args.map(a => String(a)).join(' '), timestamp: Date.now() });
                            originalLog.apply(console, args);
                        };
                        console.warn = function(...args) {
                            capturedConsole.push({ level: 'warn', message: args.map(a => String(a)).join(' '), timestamp: Date.now() });
                            originalWarn.apply(console, args);
                        };
                        console.error = function(...args) {
                            capturedConsole.push({ level: 'error', message: args.map(a => String(a)).join(' '), timestamp: Date.now() });
                            originalError.apply(console, args);
                        };

                        try {
                            const func = new Function('return (async function() { ' + message.code + ' })()');
                            response.result = await func();
                            response.success = true;
                        } catch (error) {
                            response.error = error.message;
                            response.success = false;
                        } finally {
                            response.console = capturedConsole;
                            console.log = originalLog;
                            console.warn = originalWarn;
                            console.error = originalError;
                        }

                        window.parent.postMessage(response, '*');
                    })();
                });

                console.log('🔧 JavaScript execution bridge initialized');

                // Height auto-reporting for iframe resize
                let lastReportedHeight = 0;

                function reportHeight() {
                    const height = Math.max(
                        document.documentElement.scrollHeight,
                        document.documentElement.offsetHeight,
                        document.body.scrollHeight,
                        document.body.offsetHeight
                    );

                    if (Math.abs(height - lastReportedHeight) > 5) {
                        lastReportedHeight = height;
                        window.parent.postMessage({
                            type: 'AB_IFRAME_HEIGHT',
                            height: height
                        }, '*');
                    }
                }

                // Initial height report
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        setTimeout(reportHeight, 100);
                    });
                } else {
                    setTimeout(reportHeight, 100);
                }

                // Monitor height changes with ResizeObserver
                if (typeof ResizeObserver !== 'undefined') {
                    const resizeObserver = new ResizeObserver(() => {
                        reportHeight();
                    });
                    resizeObserver.observe(document.body);
                } else {
                    setInterval(reportHeight, 500);
                }

                window.addEventListener('resize', reportHeight);

                console.log('📏 Height auto-reporting initialized');
            })();

            // Now load the app code
            ${appCode}
        `;

        // Step 5: Inject combined code via single postMessage
        console.log('💉 Injecting combined code (infrastructure + app) via postMessage...');
        await AB.injectCodeToBootstrap(iframeInfraCode, iframe.frameElement);
        console.log('✅ Combined code injected - iframe infrastructure + app running with HTTPS origin!');

        console.log('✅ App loaded successfully with HTTPS bootstrap!');

        // Enable reload button
        const reloadBtn = document.querySelector(`[data-action="reload"][data-iframe-id="${iframeId}"]`);
        if (reloadBtn) {
            reloadBtn.disabled = false;
        }

        // Ensure there's always an empty iframe available
        AB.ensureEmptyIframe();

        return { loaded: true, method: 'https_bootstrap', app: appName, iframeId: iframeId };
    };

    AB.injectCodeToBootstrap = async function(code, iframeElement) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Code injection timeout: No CODE_INJECTED response'));
            }, 5000);

            const handler = (event) => {
                if (event.data.type === 'CODE_INJECTED') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);

                    if (event.data.success) {
                        console.log('✅ Code injection successful');
                        resolve(event.data);
                    } else {
                        console.error('❌ Code injection failed:', event.data.error);
                        reject(new Error('Code injection failed: ' + event.data.error));
                    }
                }
            };

            window.addEventListener('message', handler);

            // Send INJECT_CODE message
            iframeElement.contentWindow.postMessage({
                type: 'INJECT_CODE',
                code: code
            }, '*');
        });
    };

    AB.getAppStatus = function() {
        return {
            hasApp: AB.appFrame && AB.appFrame.src !== '',
            appUrl: AB.appFrame ? AB.appFrame.src : null
        };
    };

    AB.scanAvailableApps = async function() {
        if (!AB.dirHandle) {
            console.log('No directory handle available for scanning apps');
            return;
        }

        try {
            // Try to get the apps/ directory
            const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: false });
            const apps = [];

            // Scan all subdirectories in apps/ directory
            for await (const entry of appsDir.values()) {
                if (entry.kind === 'directory') {
                    // Each app has its own directory
                    const appName = entry.name;

                    // Check if the app's .js file exists
                    try {
                        const appDir = await appsDir.getDirectoryHandle(appName);
                        const appFile = await appDir.getFileHandle(appName + '.js');
                        apps.push(appName);
                    } catch (e) {
                        console.warn(`App directory '${appName}' found but ${appName}.js not found, skipping`);
                    }
                }
            }

            // Sort alphabetically
            apps.sort();

            AB.availableApps = apps;
            AB.populateAllAppDropdowns();

            console.log('📱 Available apps:', apps);
        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log('No apps/ directory found in selected directory');
                AB.availableApps = [];
                AB.populateAllAppDropdowns();
            } else {
                console.error('Error scanning apps:', error);
            }
        }
    };

    AB.populateAllAppDropdowns = function() {
        // Update all existing iframe dropdowns
        Object.keys(AB.iframes).forEach(iframeId => {
            AB.populateAppDropdown(iframeId);
        });

        // Enable all dropdowns if we have apps
        document.querySelectorAll('.ab-app-dropdown').forEach(dropdown => {
            dropdown.disabled = AB.availableApps.length === 0 || !AB.dirHandle;
        });
    };

    AB.populateAppDropdown = function(iframeId) {
        const dropdown = document.querySelector(`.ab-app-dropdown[data-iframe-id="${iframeId}"]`);
        if (!dropdown) return;

        // Clear existing options except first
        dropdown.innerHTML = '<option value="">Select App...</option>';

        // Add apps
        AB.availableApps.forEach(appName => {
            const option = document.createElement('option');
            option.value = appName;
            option.textContent = appName;
            dropdown.appendChild(option);
        });
    };

    AB.handleAppRequest = async function(event) {
        const { action, data, requestId } = event.data;
        console.log('📨 Request from app:', action, data);

        let response = { requestId, success: false, error: null, data: null };

        try {
            // Extract appName from request (if provided)
            const appName = data.appName || null;

            switch (action) {
                case 'SAVE_DATA':
                    response.data = await AB.saveAppData(data.key, data.value, appName);
                    response.success = true;
                    // Notify worker of data activity to reset polling interval
                    AB.worker.postMessage({ type: 'DATA_ACTIVITY' });
                    break;

                case 'LOAD_DATA':
                    response.data = await AB.loadAppData(data.key, appName);
                    response.success = true;
                    // Notify worker of data activity to reset polling interval
                    AB.worker.postMessage({ type: 'DATA_ACTIVITY' });
                    break;

                case 'LOAD_TEST':
                    // Load test file from app's tests/ directory
                    if (!data.testKey) {
                        response.error = 'testKey is required';
                        response.success = false;
                    } else if (!data.appName) {
                        response.error = 'appName is required';
                        response.success = false;
                    } else {
                        response.data = await AB.loadAppTest(data.testKey, data.appName);
                        response.success = true;
                    }
                    break;

                case 'DELETE_DATA':
                    await AB.deleteAppData(data.key, appName);
                    response.success = true;
                    // Notify worker of data activity to reset polling interval
                    AB.worker.postMessage({ type: 'DATA_ACTIVITY' });
                    break;

                case 'LIST_DATA':
                    response.data = await AB.listAppData(appName);
                    response.success = true;
                    // Notify worker of data activity to reset polling interval
                    AB.worker.postMessage({ type: 'DATA_ACTIVITY' });
                    break;

                case 'LIST_TESTS':
                    // List test files from app's tests/ directory
                    if (!data.appName) {
                        response.error = 'appName is required';
                        response.success = false;
                    } else {
                        response.data = await AB.listAppTests(data.appName);
                        response.success = true;
                    }
                    break;

                case 'LOAD_APP':
                    // Load an app in a specific iframe
                    let targetIframeId = data.iframeId;

                    // If no iframe specified, find the first available empty iframe
                    if (!targetIframeId) {
                        const candidates = ['iframe_1', 'iframe_2', 'iframe_3'];

                        // First, try to find an iframe that EXISTS and is empty
                        for (const candidate of candidates) {
                            if (AB.iframes[candidate] && !AB.iframes[candidate].currentApp) {
                                // This iframe exists and is empty
                                targetIframeId = candidate;
                                break;
                            }
                        }

                        // If no existing empty iframe found, create a new one if possible
                        if (!targetIframeId) {
                            AB.ensureEmptyIframe(); // This will create iframe_1, iframe_2, or iframe_3
                            // Now find the newly created empty iframe
                            for (const candidate of candidates) {
                                if (AB.iframes[candidate] && !AB.iframes[candidate].currentApp) {
                                    targetIframeId = candidate;
                                    break;
                                }
                            }
                        }

                        // If all numbered iframes are full, use default
                        if (!targetIframeId) {
                            targetIframeId = 'default';
                        }
                    }

                    const loadResult = await AB.loadApp(data.appName, targetIframeId);
                    response.success = true;
                    response.data = loadResult; // Returns { loaded, url, app, iframeId }
                    break;

                case 'UNLOAD_APP':
                    // Unload an app from an iframe
                    // Can specify appName (will find iframe) or iframeId (will unload whatever is there)
                    const unloadResult = AB.unloadApp(data.appName, data.iframeId);
                    response.success = true;
                    response.data = unloadResult; // Returns { unloaded, app, iframeId }
                    break;

                case 'EXECUTE_JS':
                    // Execute JavaScript - can target by iframe ID or app name
                    let targetIframe = data.iframeId;

                    // If appName is provided, find which iframe has that app
                    if (data.appName && !data.iframeId) {
                        for (const [id, iframe] of Object.entries(AB.iframes)) {
                            if (iframe.currentApp === data.appName) {
                                targetIframe = id;
                                break;
                            }
                        }
                        if (!targetIframe) {
                            throw new Error(`App '${data.appName}' is not currently loaded in any iframe`);
                        }
                    }

                    const result = await AB.executeJS(data.code, data.timeout || 5000, targetIframe || 'default');
                    response.success = true;
                    response.data = result;
                    break;

                default:
                    response.error = 'Unknown action: ' + action;
            }
        } catch (error) {
            response.error = error.message;
            console.error('Error handling app request:', error);
        }

        // Send response back to the iframe that made the request
        const sourceFrame = event.source;
        if (sourceFrame) {
            sourceFrame.postMessage({
                type: 'AB_RESPONSE',
                ...response
            }, '*');
        }
    };

    AB.saveAppData = async function(key, value, appName) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        let appDataDir;
        if (appName) {
            // New structure: apps/{appName}/data/
            const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: true });
            const appDir = await appsDir.getDirectoryHandle(appName, { create: true });
            appDataDir = await appDir.getDirectoryHandle('data', { create: true });
        } else {
            // Legacy structure: app_data/ (backwards compatibility)
            appDataDir = await AB.dirHandle.getDirectoryHandle('app_data', { create: true });
        }

        const dataFile = await appDataDir.getFileHandle(key + '.json', { create: true });

        const writable = await dataFile.createWritable();
        await writable.write(JSON.stringify({
            key: key,
            value: value,
            timestamp: Date.now(),
            updated: new Date().toISOString()
        }, null, 2));
        await writable.close();

        console.log('💾 Saved app data:', key, appName ? `(${appName})` : '');
        return { saved: true, key: key };
    };

    AB.loadAppData = async function(key, appName) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        try {
            let appDataDir;
            if (appName) {
                // New structure: apps/{appName}/data/
                const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: true });
                const appDir = await appsDir.getDirectoryHandle(appName, { create: false });
                appDataDir = await appDir.getDirectoryHandle('data', { create: false });
            } else {
                // Legacy structure: app_data/
                appDataDir = await AB.dirHandle.getDirectoryHandle('app_data', { create: true });
            }

            const dataFile = await appDataDir.getFileHandle(key + '.json');
            const file = await dataFile.getFile();
            const content = await file.text();
            const parsed = JSON.parse(content);

            console.log('📖 Loaded app data:', key, appName ? `(${appName})` : '');
            return parsed;
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return null;  // File doesn't exist yet
            }
            throw error;
        }
    };

    AB.deleteAppData = async function(key, appName) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        let appDataDir;
        if (appName) {
            // New structure: apps/{appName}/data/
            const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: true });
            const appDir = await appsDir.getDirectoryHandle(appName, { create: false });
            appDataDir = await appDir.getDirectoryHandle('data', { create: false });
        } else {
            // Legacy structure: app_data/
            appDataDir = await AB.dirHandle.getDirectoryHandle('app_data', { create: true });
        }

        await appDataDir.removeEntry(key + '.json');

        console.log('🗑️  Deleted app data:', key, appName ? `(${appName})` : '');
    };

    AB.listAppData = async function(appName) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        let appDataDir;
        if (appName) {
            // New structure: apps/{appName}/data/
            try {
                const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: true });
                const appDir = await appsDir.getDirectoryHandle(appName, { create: false });
                appDataDir = await appDir.getDirectoryHandle('data', { create: false });
            } catch (error) {
                if (error.name === 'NotFoundError') {
                    return [];  // No data directory yet
                }
                throw error;
            }
        } else {
            // Legacy structure: app_data/
            appDataDir = await AB.dirHandle.getDirectoryHandle('app_data', { create: true });
        }

        const keys = [];

        for await (const entry of appDataDir.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                keys.push(entry.name.replace('.json', ''));
            }
        }

        return keys;
    };

    AB.listAppTests = async function(appName) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        if (!appName) {
            throw new Error('appName is required for listAppTests');
        }

        let appTestsDir;
        try {
            // New structure: apps/{appName}/tests/
            const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: true });
            const appDir = await appsDir.getDirectoryHandle(appName, { create: false });
            appTestsDir = await appDir.getDirectoryHandle('tests', { create: false });
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return [];  // No tests directory yet
            }
            throw error;
        }

        const testFiles = [];

        for await (const entry of appTestsDir.values()) {
            if (entry.kind === 'file') {
                // Include both .js and .json test files
                if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
                    testFiles.push({
                        name: entry.name,
                        key: entry.name.replace(/\.(js|json)$/, ''),
                        ext: entry.name.endsWith('.js') ? 'js' : 'json'
                    });
                }
            }
        }

        return testFiles;
    };

    AB.loadAppTest = async function(testKey, appName) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        if (!appName) {
            throw new Error('appName is required for loadAppTest');
        }

        try {
            // Read from: apps/{appName}/tests/
            const appsDir = await AB.dirHandle.getDirectoryHandle('apps', { create: true });
            const appDir = await appsDir.getDirectoryHandle(appName, { create: false });
            const appTestsDir = await appDir.getDirectoryHandle('tests', { create: false });

            // Try .js first, then .json
            let testFile, testContent, ext;

            try {
                testFile = await appTestsDir.getFileHandle(testKey + '.js');
                ext = 'js';
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    testFile = await appTestsDir.getFileHandle(testKey + '.json');
                    ext = 'json';
                } else {
                    throw err;
                }
            }

            const file = await testFile.getFile();
            const content = await file.text();

            if (ext === 'json') {
                // Parse JSON and return the structure (should have 'value' property)
                const parsed = JSON.parse(content);
                console.log('📖 Loaded test (JSON):', testKey, `(${appName})`);
                return parsed;
            } else {
                // Return raw JavaScript code wrapped in expected structure
                console.log('📖 Loaded test (JS):', testKey, `(${appName})`);
                return { value: content };
            }
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return null;  // File doesn't exist
            }
            throw error;
        }
    };

    AB.readFileAsText = async function(filePath) {
        if (!AB.dirHandle) {
            throw new Error('No directory connected');
        }

        const parts = filePath.split('/');
        let currentHandle = AB.dirHandle;

        // Navigate through directories
        for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
        }

        // Get file
        const fileName = parts[parts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const text = await file.text();

        return text;
    };

    AB.injectStyles = function() {
        const style = document.createElement('style');
        style.textContent = `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
            }

            /* Status Bar */
            #ab-status-bar {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 50px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 20px;
                z-index: 10000;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }

            #ab-status-bar.minimized {
                height: 30px;
                font-size: 12px;
            }

            .ab-status-left {
                display: flex;
                align-items: center;
                gap: 20px;
            }

            .ab-logo {
                font-weight: 700;
                font-size: 16px;
            }

            .ab-connection-status {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .ab-status-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: #dc3545;
            }

            .ab-status-dot.connected {
                background: #28a745;
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            /* Poll Status Visualization */
            .ab-poll-status {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 12px;
                background: rgba(255,255,255,0.1);
                border-radius: 12px;
            }

            .poll-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255,255,255,0.5);
            }

            .poll-indicator.pulse {
                animation: pollPulse 0.1s ease-out;
            }

            @keyframes pollPulse {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.5); opacity: 0.8; }
                100% { transform: scale(1); opacity: 1; }
            }

            .poll-interval {
                font-size: 12px;
                font-weight: 600;
                min-width: 45px;
            }

            .poll-interval.fast { color: #28a745; }
            .poll-interval.medium { color: #ffc107; }
            .poll-interval.slow { color: #ff6b6b; }

            .ab-status-right {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .ab-stat-item {
                font-size: 13px;
            }

            .ab-stat-label {
                opacity: 0.8;
                margin-right: 4px;
            }

            .ab-stat-value {
                font-weight: 700;
            }

            .ab-btn-small {
                padding: 6px 12px;
                background: rgba(255,255,255,0.2);
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
                transition: background 0.2s;
            }

            .ab-btn-small:hover {
                background: rgba(255,255,255,0.3);
            }

            /* App Selector Bar */
            #ab-app-selector-bar {
                position: fixed;
                top: 50px;
                left: 0;
                right: 0;
                height: 40px;
                background: #2a2a2a;
                border-bottom: 1px solid #3a3a3a;
                display: flex;
                align-items: center;
                padding: 0 20px;
                z-index: 9999;
            }

            .ab-selector-container {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .ab-selector-label {
                font-size: 13px;
                font-weight: 600;
                color: #e0e0e0;
            }

            /* App Dropdown */
            .ab-app-dropdown {
                padding: 6px 12px;
                background: #3a3a3a;
                color: #e0e0e0;
                border: 1px solid #4a4a4a;
                border-radius: 4px;
                font-size: 13px;
                cursor: pointer;
                min-width: 250px;
                transition: all 0.2s;
                font-family: inherit;
            }

            .ab-app-dropdown:hover:not(:disabled) {
                border-color: #667eea;
                box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
            }

            .ab-app-dropdown:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                background: #2a2a2a;
            }

            .ab-app-dropdown:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
            }

            /* Iframe Container */
            #ab-iframes-container {
                background: #1a1a1a;
            }

            /* Iframe Wrapper */
            .ab-iframe-wrapper {
                border: 2px solid #3a3a3a;
                background: #2a2a2a;
                overflow: hidden;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }

            /* Iframe Controls Bar */
            .ab-iframe-controls {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: #2a2a2a;
                border-bottom: 1px solid #3a3a3a;
            }

            .ab-control-left {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .ab-control-right {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .ab-iframe-label {
                font-size: 12px;
                font-weight: 600;
                color: #e0e0e0;
                min-width: 80px;
            }

            /* Icon Buttons */
            .ab-btn-icon {
                padding: 4px 8px;
                background: #3a3a3a;
                color: #e0e0e0;
                border: 1px solid #4a4a4a;
                border-radius: 4px;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .ab-btn-icon:hover:not(:disabled) {
                background: #4a4a4a;
                border-color: #5a5a5a;
            }

            .ab-btn-icon:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .queue-count {
                font-size: 11px;
                font-weight: 700;
                color: #667eea;
                min-width: 12px;
                text-align: center;
            }

            /* Iframe Element */
            .ab-app-iframe {
                width: 100%;
                min-height: 200px;
                border: none;
                display: block;
            }
        `;
        document.head.appendChild(style);
    };

})();
