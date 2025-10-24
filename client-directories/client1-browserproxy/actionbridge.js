// ActionBridge v4 - Sandboxed App Container with Minimal Status Bar
// High isolation: Apps run in sandboxed iframe, communicate via postMessage

(function() {
    'use strict';

    // ==================== Inline Worker Code ====================

    const workerCode = `
'use strict';

const worker = {
    dirHandle: null,
    commandsDirHandle: null, // Cache commands directory handle to avoid repeated getDirectoryHandle calls
    processing: false,
    currentCommand: null,
    currentFilename: null,
    pollInterval: 100,
    pollTimeoutId: null,
    polling: false,
    lastActivityTime: Date.now(),
    stepDuration: 2000, // Stay at each interval for 2 seconds before doubling
    stats: {
        processed: 0,
        succeeded: 0,
        failed: 0,
        timeout: 0
    },
    lastStatusWritten: null, // Track last written status to avoid unnecessary disk writes
    cachedHistorySize: 0, // Cache history count to avoid unnecessary directory iterations
    historyChanged: true, // Flag to track when history needs recounting
    cachedHasCommands: false, // Cache whether commands directory has files
    commandsCheckInterval: 2000, // Only check commands directory every 2000ms max
    lastCommandsCheck: 0, // Timestamp of last commands directory check
    config: {
        maxHistorySize: 100,
        fileStabilityChecks: 3,
        fileStabilityDelay: 10,
        maxReadAttempts: 10
    }
};

self.onmessage = async function(e) {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'SET_DIRECTORY':
                worker.dirHandle = data.handle;
                // Initialize cached commands directory handle to avoid repeated getDirectoryHandle calls
                try {
                    worker.commandsDirHandle = await worker.dirHandle.getDirectoryHandle('commands', { create: true });
                } catch (error) {
                    worker.commandsDirHandle = null;
                }
                postMessage({ type: 'DIRECTORY_SET', success: true });
                break;

            case 'START_POLLING':
                startPolling();
                break;

            case 'STOP_POLLING':
                stopPolling();
                break;

            case 'DATA_ACTIVITY':
                // Reset polling interval when data operations occur
                if (worker.polling) {
                    worker.pollInterval = 100;
                    console.log('🔄 Polling interval reset to 100ms due to data activity');
                }
                break;

            case 'EXECUTION_RESULT':
                await handleExecutionResult(data);
                break;

            case 'GET_STATS':
                postMessage({ type: 'STATS', data: worker.stats });
                break;

            default:
                postMessage({ type: 'ERROR', error: 'Unknown message type: ' + type });
        }
    } catch (error) {
        postMessage({
            type: 'ERROR',
            error: {
                message: error.message,
                stack: error.stack
            }
        });
    }
};

function startPolling() {
    if (worker.pollTimeoutId) {
        clearTimeout(worker.pollTimeoutId);
    }
    worker.pollInterval = 100;
    worker.polling = true;
    postMessage({ type: 'POLLING_STARTED' });
    poll();
}

function stopPolling() {
    if (worker.pollTimeoutId) {
        clearTimeout(worker.pollTimeoutId);
        worker.pollTimeoutId = null;
    }
    worker.polling = false;
    postMessage({ type: 'POLLING_STOPPED' });
}

async function poll() {
    if (!worker.dirHandle || !worker.polling) return;

    try {
        const hasCommands = await hasCommandFiles();

        if (hasCommands || worker.processing) {
            // Active: reset to fastest
            worker.pollInterval = 100;
        } else {
            // Idle: stepped degradation based on time since last activity
            const timeSinceActivity = Date.now() - worker.lastActivityTime;
            const step = Math.floor(timeSinceActivity / worker.stepDuration);

            // Each step doubles the interval: 100, 200, 400, 800, 1600, 2000 (max)
            // Step 0 (0-2s):   100ms
            // Step 1 (2-4s):   200ms
            // Step 2 (4-6s):   400ms
            // Step 3 (6-8s):   800ms
            // Step 4 (8-10s):  1600ms
            // Step 5+ (10s+):  2000ms
            worker.pollInterval = Math.min(100 * Math.pow(2, step), 2000);
        }

        if (!worker.processing && hasCommands) {
            await processNextCommand();
        }

        await updateStatus();

        postMessage({ type: 'POLL_TICK', interval: worker.pollInterval });
    } catch (error) {
        postMessage({ type: 'POLL_ERROR', error: error.message });
    }

    if (worker.polling) {
        worker.pollTimeoutId = setTimeout(() => poll(), worker.pollInterval);
    }
}

async function hasCommandFiles() {
    const now = Date.now();

    // Only check directory if enough time has passed since last check
    // This prevents excessive directory iteration during fast polling
    if (now - worker.lastCommandsCheck < worker.commandsCheckInterval) {
        return worker.cachedHasCommands;
    }

    // Use cached directory handle to avoid touching root directory
    if (!worker.commandsDirHandle) {
        return worker.cachedHasCommands;
    }

    try {
        for await (const entry of worker.commandsDirHandle.values()) {
            if (entry.kind === 'file' && entry.name.startsWith('cmd_')) {
                worker.cachedHasCommands = true;
                worker.lastCommandsCheck = now;
                return true;
            }
        }
        worker.cachedHasCommands = false;
        worker.lastCommandsCheck = now;
        return false;
    } catch (error) {
        return worker.cachedHasCommands;
    }
}

async function processNextCommand() {
    if (worker.processing) return;

    // Use cached directory handle
    if (!worker.commandsDirHandle) return;

    try {
        const commandFiles = [];

        // Collect all command files using cached handle
        for await (const entry of worker.commandsDirHandle.values()) {
            if (entry.kind === 'file' && entry.name.startsWith('cmd_')) {
                commandFiles.push(entry);
            }
        }

        if (commandFiles.length === 0) return;

        // Sort by filename (oldest first)
        commandFiles.sort((a, b) => a.name.localeCompare(b.name));

        // Take the first file
        const entry = commandFiles[0];
        worker.currentFilename = entry.name;

        try {
            const cmd = await readCompleteJSON(entry);
            worker.currentCommand = cmd;
            worker.processing = true;
            worker.lastActivityTime = Date.now(); // Keep polling fast during command bursts

            postMessage({ type: 'COMMAND_PROCESSING', commandId: cmd.id });

            if (!cmd.timeout_ms || typeof cmd.timeout_ms !== 'number') {
                throw new Error('MANDATORY timeout_ms missing or invalid');
            }

            postMessage({
                type: 'EXECUTE_COMMAND',
                data: {
                    id: cmd.id,
                    script: cmd.script,
                    type: cmd.type || 'execute',
                    timeout_ms: cmd.timeout_ms,
                    target: cmd.target,
                    startTime: Date.now()
                }
            });
        } catch (error) {
            // Malformed command file - delete it
            try {
                await commandsDir.removeEntry(entry.name);
            } catch (e) {
                // Ignore deletion error
            }
            worker.processing = false;
            worker.currentCommand = null;
            worker.currentFilename = null;
        }
    } catch (error) {
        worker.processing = false;
    }
}

async function handleExecutionResult(data) {
    const { id, status, result, error, executionTime, console } = data;

    worker.stats.processed++;
    if (status === 'success') {
        worker.stats.succeeded++;
    } else if (status === 'timeout') {
        worker.stats.timeout++;
    } else {
        worker.stats.failed++;
    }

    await writeResult(id, status, result, error, executionTime, console);

    if (status !== 'success') {
        await writeError(id, status, error, worker.currentCommand);
    }

    // Use the stored filename
    await moveToHistory(worker.currentFilename);
    await pruneHistory();

    // Mark that history has changed so status will recount on next update
    worker.historyChanged = true;

    // Force immediate commands check on next poll (command might have created new commands)
    worker.lastCommandsCheck = 0;

    worker.processing = false;
    worker.currentCommand = null;
    worker.currentFilename = null;

    // Update activity time to keep polling fast for sequential commands
    worker.lastActivityTime = Date.now();

    postMessage({
        type: 'COMMAND_COMPLETE',
        commandId: id,
        status: status,
        stats: worker.stats
    });
}

async function readCompleteJSON(fileHandle) {
    let lastContent = '';
    let stableCount = 0;
    let attempts = 0;

    while (stableCount < worker.config.fileStabilityChecks && attempts < worker.config.maxReadAttempts) {
        attempts++;
        const file = await fileHandle.getFile();
        const content = await file.text();

        if (content === lastContent) {
            stableCount++;
        } else {
            stableCount = 0;
            lastContent = content;
        }

        if (stableCount < worker.config.fileStabilityChecks) {
            await sleep(worker.config.fileStabilityDelay);
        }
    }

    if (attempts >= worker.config.maxReadAttempts) {
        throw new Error('File content unstable after ' + attempts + ' read attempts');
    }

    return JSON.parse(lastContent);
}

async function writeResult(cmdId, status, result, error, executionTime, consoleOutput) {
    try {
        const resultsDir = await worker.dirHandle.getDirectoryHandle('results', { create: true });
        const resultFile = await resultsDir.getFileHandle('result_' + cmdId + '.json', { create: true });

        const resultData = {
            command_id: cmdId,
            status: status,
            timestamp: Date.now(),
            execution_time_ms: executionTime
        };

        if (status === 'success') {
            resultData.result = result;
        } else {
            resultData.error = {
                name: error?.name || 'Error',
                message: error?.message || 'Unknown error',
                stack: error?.stack
            };
        }

        // Include console output if available
        if (consoleOutput && consoleOutput.length > 0) {
            resultData.console = consoleOutput;
        }

        const writable = await resultFile.createWritable();
        await writable.write(JSON.stringify(resultData, null, 2));
        await writable.close();
    } catch (error) {
        // Silent fail
    }
}

async function writeError(cmdId, phase, error, cmd) {
    try {
        const errorsDir = await worker.dirHandle.getDirectoryHandle('errors', { create: true });
        const errorFile = await errorsDir.getFileHandle('error_cmd_' + cmdId + '.json', { create: true });

        const errorData = {
            command_id: cmdId,
            timestamp: Date.now(),
            phase: phase,
            error: {
                name: error?.name || 'Error',
                message: error?.message || 'Unknown error',
                stack: error?.stack
            }
        };

        if (cmd) {
            errorData.command = {
                type: cmd.type,
                timeout_ms: cmd.timeout_ms,
                script: cmd.script?.substring(0, 200) + (cmd.script?.length > 200 ? '...' : '')
            };
        }

        const writable = await errorFile.createWritable();
        await writable.write(JSON.stringify(errorData, null, 2));
        await writable.close();
    } catch (err) {
        // Silent fail
    }
}

async function moveToHistory(cmdFileName) {
    try {
        // Use cached commands directory handle
        if (!worker.commandsDirHandle) return;

        const historyDir = await worker.dirHandle.getDirectoryHandle('history', { create: true });

        const cmdFile = await worker.commandsDirHandle.getFileHandle(cmdFileName);
        const file = await cmdFile.getFile();
        const content = await file.text();

        const historyFile = await historyDir.getFileHandle(cmdFileName, { create: true });
        const writable = await historyFile.createWritable();
        await writable.write(content);
        await writable.close();

        await worker.commandsDirHandle.removeEntry(cmdFileName);
    } catch (error) {
        // Silent fail - file may have already been deleted
    }
}

async function pruneHistory() {
    try {
        const historyDir = await worker.dirHandle.getDirectoryHandle('history', { create: true });
        const entries = [];

        for await (const entry of historyDir.values()) {
            if (entry.kind === 'file' && entry.name.startsWith('cmd_')) {
                entries.push(entry);
            }
        }

        entries.sort((a, b) => {
            const tsA = parseInt(a.name.match(/cmd_(\\d+)/)?.[1] || '0');
            const tsB = parseInt(b.name.match(/cmd_(\\d+)/)?.[1] || '0');
            return tsA - tsB;
        });

        while (entries.length > worker.config.maxHistorySize) {
            const oldest = entries.shift();
            await historyDir.removeEntry(oldest.name);
        }
    } catch (error) {
        // Silent fail
    }
}

async function updateStatus() {
    if (!worker.dirHandle) return;

    try {
        // Only recount history if it has changed since last update
        if (worker.historyChanged) {
            const historyDir = await worker.dirHandle.getDirectoryHandle('history', { create: true });
            let historySize = 0;
            for await (const entry of historyDir.values()) {
                if (entry.kind === 'file' && entry.name.startsWith('cmd_')) {
                    historySize++;
                }
            }
            worker.cachedHistorySize = historySize;
            worker.historyChanged = false;
        }

        const status = {
            bridge_active: true,
            last_poll: Date.now(),
            poll_interval_ms: worker.pollInterval,
            directory_permission: 'granted',
            processing: worker.processing,
            current_command: worker.currentCommand?.id || null,
            commands_processed: worker.stats.processed,
            commands_succeeded: worker.stats.succeeded,
            commands_failed: worker.stats.failed,
            commands_timeout: worker.stats.timeout,
            history_size: worker.cachedHistorySize
        };

        // Only write to disk if meaningful fields have changed
        // (Ignore last_poll timestamp for comparison)
        if (worker.lastStatusWritten) {
            const meaningful = (s) => ({
                poll_interval_ms: s.poll_interval_ms,
                processing: s.processing,
                current_command: s.current_command,
                commands_processed: s.commands_processed,
                commands_succeeded: s.commands_succeeded,
                commands_failed: s.commands_failed,
                commands_timeout: s.commands_timeout,
                history_size: s.history_size
            });

            const current = meaningful(status);
            const last = meaningful(worker.lastStatusWritten);

            // Skip write if nothing meaningful changed
            if (JSON.stringify(current) === JSON.stringify(last)) {
                return;
            }
        }

        // Write to disk only when status has meaningfully changed
        const statusFile = await worker.dirHandle.getFileHandle('status.json', { create: true });
        const writable = await statusFile.createWritable();
        await writable.write(JSON.stringify(status, null, 2));
        await writable.close();

        worker.lastStatusWritten = status;
    } catch (error) {
        // Silent fail
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
`;

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

    AB.initWorker = function() {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerURL = URL.createObjectURL(blob);
        AB.worker = new Worker(workerURL);

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

        console.log('✅ ActionBridge v4 initialized (Sandboxed App Container)');
    };

    // ==================== Command Queue System ====================
    // Ensures sequential execution per iframe (no concurrent commands)

    // Queue a command for an iframe
    AB.queueCommand = function(iframeId, commandFn) {
        iframeId = iframeId || 'default';

        if (!AB.iframes[iframeId]) {
            return Promise.reject(new Error('Iframe not found: ' + iframeId));
        }

        return new Promise((resolve, reject) => {
            const iframe = AB.iframes[iframeId];

            // Add to queue
            iframe.queue.push({ commandFn, resolve, reject });

            console.log(`📥 Command queued for iframe '${iframeId}' (queue length: ${iframe.queue.length})`);

            // Update queue count display
            AB.updateQueueCount(iframeId);

            // Start processing if not already in progress
            if (!iframe.executionInProgress) {
                AB.processNextCommand(iframeId);
            }
        });
    };

    // Process next command in iframe's queue
    AB.processNextCommand = function(iframeId) {
        iframeId = iframeId || 'default';

        const iframe = AB.iframes[iframeId];
        if (!iframe) {
            console.error('Iframe not found:', iframeId);
            return;
        }

        // Check if queue is empty
        if (iframe.queue.length === 0) {
            iframe.executionInProgress = false;
            AB.updateQueueCount(iframeId);
            console.log(`✅ Queue empty for iframe '${iframeId}'`);
            return;
        }

        // Mark as in progress
        iframe.executionInProgress = true;
        AB.updateQueueCount(iframeId);

        // Get next command
        const { commandFn, resolve, reject } = iframe.queue.shift();

        console.log(`⚙️  Executing command for iframe '${iframeId}' (${iframe.queue.length} remaining in queue)`);

        // Execute command
        commandFn()
            .then(result => {
                resolve(result);
                iframe.executionInProgress = false;
                AB.updateQueueCount(iframeId);
                // Process next command
                AB.processNextCommand(iframeId);
            })
            .catch(error => {
                reject(error);
                iframe.executionInProgress = false;
                AB.updateQueueCount(iframeId);
                // Process next command even on error
                AB.processNextCommand(iframeId);
            });
    };

    // Execute command on main thread or forward to iframe
    AB.executeCommandOnMainThread = function(commandData) {
        const { id, script, type, timeout_ms, startTime, target } = commandData;

        // Check if command should be executed in iframe
        if (target === 'iframe' || target === 'app') {
            console.log('🔀 Forwarding command to app iframe:', id);

            AB.executeJS(script, timeout_ms)
                .then(response => {
                    AB.worker.postMessage({
                        type: 'EXECUTION_RESULT',
                        data: {
                            id: id,
                            status: 'success',
                            result: response.result,
                            console: response.console,
                            executionTime: Date.now() - startTime
                        }
                    });
                })
                .catch(err => {
                    AB.worker.postMessage({
                        type: 'EXECUTION_RESULT',
                        data: {
                            id: id,
                            status: 'error',
                            error: {
                                name: err.name || 'Error',
                                message: err.message || 'Unknown error',
                                stack: err.stack
                            },
                            console: err.console || [],
                            executionTime: Date.now() - startTime
                        }
                    });
                });

            return;  // Exit early for iframe execution
        }

        // Execute in parent frame (default behavior)
        let completed = false;
        let result = null;
        let status = 'success';
        let error = null;

        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                status = 'timeout';
                error = {
                    name: 'TimeoutError',
                    message: 'Execution exceeded ' + timeout_ms + 'ms timeout'
                };

                AB.worker.postMessage({
                    type: 'EXECUTION_RESULT',
                    data: {
                        id: id,
                        status: status,
                        error: error,
                        executionTime: Date.now() - startTime
                    }
                });
            }
        }, timeout_ms);

        // Wrap in async IIFE to handle async handleAPICommand
        (async () => {
            try {
                // Check for special command types
                if (script.startsWith('ab.')) {
                    // ActionBridge API commands (async)
                    result = await AB.handleAPICommand(script);
                } else {
                    // Regular JavaScript execution
                    const executor = new Function(script);
                    result = executor();
                }

                if (!completed) {
                    completed = true;
                    clearTimeout(timeoutId);

                    AB.worker.postMessage({
                        type: 'EXECUTION_RESULT',
                        data: {
                            id: id,
                            status: 'success',
                            result: result,
                            executionTime: Date.now() - startTime
                        }
                    });
                }
            } catch (err) {
                if (!completed) {
                    completed = true;
                    clearTimeout(timeoutId);

                    AB.worker.postMessage({
                        type: 'EXECUTION_RESULT',
                        data: {
                            id: id,
                            status: 'error',
                            error: {
                                name: err.name,
                                message: err.message,
                                stack: err.stack
                            },
                            executionTime: Date.now() - startTime
                        }
                    });
                }
            }
        })();
    };

    // Handle ActionBridge API commands
    AB.handleAPICommand = async function(command) {
        const match = command.match(/^ab\.(\w+)\((.*)\)$/);
        if (!match) {
            throw new Error('Invalid ActionBridge API command');
        }

        const method = match[1];
        const argsStr = match[2];
        let args = [];

        if (argsStr.trim()) {
            try {
                args = JSON.parse('[' + argsStr + ']');
            } catch (e) {
                throw new Error('Invalid arguments for ActionBridge API command');
            }
        }

        switch (method) {
            case 'loadApp':
                return await AB.loadApp(args[0]);

            case 'sendToApp':
                return AB.sendToApp(args[0]);

            case 'getAppStatus':
                return AB.getAppStatus();

            case 'minimizeStatusBar':
                return AB.minimizeStatusBar();

            case 'expandStatusBar':
                return AB.expandStatusBar();

            default:
                throw new Error('Unknown ActionBridge API method: ' + method);
        }
    };

    // Load app into sandboxed iframe using query string pattern
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

    // Unload an app from an iframe
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

    // Load app with HTTPS bootstrap (for apps requiring origin)
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

    // Helper: Read file as text from connected directory
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

    // Helper: Inject code into bootstrap iframe via postMessage
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

    // Send message to app via postMessage (queued for sequential execution)
    AB.sendToApp = function(message, iframeId) {
        iframeId = iframeId || 'default';
        return AB.queueCommand(iframeId, () => AB._sendToAppInternal(message, iframeId));
    };

    // Internal implementation: Send message to app via postMessage
    AB._sendToAppInternal = function(message, iframeId) {
        iframeId = iframeId || 'default';

        const iframe = AB.iframes[iframeId];
        if (!iframe || !iframe.frameElement || !iframe.frameElement.contentWindow) {
            return Promise.reject(new Error('No app loaded in iframe: ' + iframeId));
        }

        iframe.frameElement.contentWindow.postMessage({
            type: 'AB_MESSAGE',
            data: message
        }, '*');

        return Promise.resolve({ sent: true, iframeId: iframeId });
    };

    // Execute JavaScript in app iframe (queued for sequential execution)
    // Returns a Promise that resolves with { result, console }
    AB.executeJS = function(code, timeout = 5000, iframeId) {
        iframeId = iframeId || 'default';
        return AB.queueCommand(iframeId, () => AB._executeJSInternal(code, timeout, iframeId));
    };

    // Internal implementation: Execute JavaScript in app iframe (via postMessage bridge)
    AB._executeJSInternal = function(code, timeout, iframeId) {
        iframeId = iframeId || 'default';

        const iframe = AB.iframes[iframeId];
        if (!iframe || !iframe.frameElement || !iframe.frameElement.contentWindow) {
            return Promise.reject(new Error('No app loaded in iframe: ' + iframeId));
        }

        return new Promise((resolve, reject) => {
            const requestId = 'exec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            let timeoutId;

            // Setup response listener
            const responseHandler = function(event) {
                const message = event.data;

                // Only handle our response
                if (message.type !== 'AB_EXECUTE_JS_RESPONSE' || message.requestId !== requestId) {
                    return;
                }

                // Clean up
                clearTimeout(timeoutId);
                window.removeEventListener('message', responseHandler);

                // Handle response
                if (message.success) {
                    // Return both result and console output
                    resolve({
                        result: message.result,
                        console: message.console || []
                    });
                } else {
                    // Include console output in error
                    const error = new Error(message.error || 'JavaScript execution failed');
                    error.console = message.console || [];
                    error.stack = message.stack;
                    reject(error);
                }
            };

            // Add listener
            window.addEventListener('message', responseHandler);

            // Set timeout
            timeoutId = setTimeout(() => {
                window.removeEventListener('message', responseHandler);
                reject(new Error('JavaScript execution timeout after ' + timeout + 'ms'));
            }, timeout);

            // Send execution request to iframe
            iframe.frameElement.contentWindow.postMessage({
                type: 'AB_EXECUTE_JS',
                requestId: requestId,
                code: code
            }, '*');
        });
    };

    // Get app status
    AB.getAppStatus = function() {
        return {
            hasApp: AB.appFrame && AB.appFrame.src !== '',
            appUrl: AB.appFrame ? AB.appFrame.src : null
        };
    };

    // Minimize status bar
    AB.minimizeStatusBar = function() {
        const statusBar = document.getElementById('ab-status-bar');
        statusBar.classList.add('minimized');
        return { minimized: true };
    };

    // Expand status bar
    AB.expandStatusBar = function() {
        const statusBar = document.getElementById('ab-status-bar');
        statusBar.classList.remove('minimized');
        return { minimized: false };
    };

    // Visualize poll tick
    AB.visualizePollTick = function() {
        const indicator = document.getElementById('poll-indicator');
        if (!indicator) return;

        // Flash the indicator
        indicator.classList.add('pulse');
        setTimeout(() => indicator.classList.remove('pulse'), 100);

        // Update interval display
        const intervalDisplay = document.getElementById('poll-interval');
        if (intervalDisplay) {
            intervalDisplay.textContent = AB.currentPollInterval + 'ms';

            // Color code by speed
            intervalDisplay.className = 'poll-interval';
            if (AB.currentPollInterval <= 50) {
                intervalDisplay.classList.add('fast');
            } else if (AB.currentPollInterval <= 400) {
                intervalDisplay.classList.add('medium');
            } else {
                intervalDisplay.classList.add('slow');
            }
        }
    };

    // IndexedDB functions
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

    // Populate all iframe dropdowns with available apps
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

    AB.startPolling = function() {
        AB.worker.postMessage({ type: 'START_POLLING' });
    };

    AB.stopPolling = function() {
        AB.worker.postMessage({ type: 'STOP_POLLING' });
    };

    AB.isPolling = function() {
        return AB.polling;
    };

    // ==================== Dynamic Iframe Management ====================

    AB.iframeCounter = 0;

    // Create a new iframe dynamically
    AB.createIframe = function() {
        const iframeId = AB.iframeCounter === 0 ? 'default' : 'iframe_' + AB.iframeCounter;
        AB.iframeCounter++;

        console.log(`📦 Creating iframe: ${iframeId}`);

        // Add to iframes object
        AB.iframes[iframeId] = {
            frameElement: null,
            queue: [],
            executionInProgress: false,
            currentApp: null
        };

        const iframe = AB.iframes[iframeId];

        // Create iframe wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'ab-iframe-wrapper';
        wrapper.dataset.iframeId = iframeId;

        // Create control bar
        const controlBar = document.createElement('div');
        controlBar.className = 'ab-iframe-controls';
        controlBar.innerHTML = `
            <div class="ab-control-left">
                <span class="ab-iframe-label">${iframeId}</span>
                <select class="ab-app-dropdown" data-iframe-id="${iframeId}" ${!AB.dirHandle ? 'disabled' : ''}>
                    <option value="">Select App...</option>
                </select>
            </div>
            <div class="ab-control-right">
                <button class="ab-btn-icon" data-action="reload" data-iframe-id="${iframeId}" title="Reload App" disabled>🔄</button>
                <button class="ab-btn-icon" data-action="reset-queue" data-iframe-id="${iframeId}" title="Reset Queue">
                    <span class="queue-count">0</span> 🗑️
                </button>
                <button class="ab-btn-icon" data-action="close" data-iframe-id="${iframeId}" title="Close">❌</button>
            </div>
        `;

        // Create iframe element
        const iframeElement = document.createElement('iframe');
        iframeElement.id = 'ab-iframe-' + iframeId;
        iframeElement.sandbox = 'allow-scripts allow-same-origin allow-modals';
        iframeElement.className = 'ab-app-iframe';

        iframe.frameElement = iframeElement;

        // Assemble structure
        wrapper.appendChild(controlBar);
        wrapper.appendChild(iframeElement);

        // Add to container
        const container = document.getElementById('ab-iframes-container');
        container.appendChild(wrapper);

        // Populate app dropdown
        AB.populateAppDropdown(iframeId);

        // Setup event listeners
        AB.setupIframeControls(iframeId);

        return iframeId;
    };

    // Populate app dropdown for an iframe
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

    // Setup event listeners for iframe controls
    AB.setupIframeControls = function(iframeId) {
        const wrapper = document.querySelector(`.ab-iframe-wrapper[data-iframe-id="${iframeId}"]`);
        if (!wrapper) return;

        // App dropdown
        const dropdown = wrapper.querySelector('.ab-app-dropdown');
        dropdown.addEventListener('change', async (e) => {
            const appName = e.target.value;
            if (appName) {
                try {
                    await AB.loadApp(appName, iframeId);
                    console.log(`📱 Loading app '${appName}' in iframe '${iframeId}'`);
                } catch (error) {
                    console.error('Failed to load app:', error);
                    alert('Failed to load app: ' + error.message);
                }
            }
        });

        // Reload button
        const reloadBtn = wrapper.querySelector('[data-action="reload"]');
        reloadBtn.addEventListener('click', () => AB.reloadIframe(iframeId));

        // Reset queue button
        const resetBtn = wrapper.querySelector('[data-action="reset-queue"]');
        resetBtn.addEventListener('click', () => AB.resetQueue(iframeId));

        // Close button
        const closeBtn = wrapper.querySelector('[data-action="close"]');
        closeBtn.addEventListener('click', () => AB.closeIframe(iframeId));
    };

    // Update queue count display for an iframe
    AB.updateQueueCount = function(iframeId) {
        const iframe = AB.iframes[iframeId];
        if (!iframe) return;

        const count = iframe.queue.length + (iframe.executionInProgress ? 1 : 0);
        const queueCountEl = document.querySelector(`[data-action="reset-queue"][data-iframe-id="${iframeId}"] .queue-count`);
        if (queueCountEl) {
            queueCountEl.textContent = count;
        }
    };

    // Reload iframe (clear queue and reload app)
    AB.reloadIframe = function(iframeId) {
        const iframe = AB.iframes[iframeId];
        if (!iframe || !iframe.currentApp) return;

        console.log(`🔄 Reloading iframe '${iframeId}'`);

        // Clear queue
        iframe.queue = [];
        iframe.executionInProgress = false;
        AB.updateQueueCount(iframeId);

        // Reload iframe
        const appName = iframe.currentApp;
        const appUrl = 'index.html?app=' + encodeURIComponent(appName);
        iframe.frameElement.src = appUrl;
    };

    // Reset queue for an iframe
    AB.resetQueue = function(iframeId) {
        const iframe = AB.iframes[iframeId];
        if (!iframe) return;

        const count = iframe.queue.length + (iframe.executionInProgress ? 1 : 0);
        if (count === 0) return;

        if (confirm(`Reset queue for ${iframeId}? This will cancel ${count} pending command(s).`)) {
            console.log(`🗑️  Resetting queue for iframe '${iframeId}' (${count} commands cancelled)`);
            iframe.queue = [];
            iframe.executionInProgress = false;
            AB.updateQueueCount(iframeId);
        }
    };

    // Close iframe
    AB.closeIframe = function(iframeId) {
        // Don't allow closing if it's the only iframe
        const iframeCount = Object.keys(AB.iframes).length;
        if (iframeCount <= 1) {
            alert('Cannot close the last iframe');
            return;
        }

        console.log(`❌ Closing iframe '${iframeId}'`);

        // Remove from DOM
        const wrapper = document.querySelector(`.ab-iframe-wrapper[data-iframe-id="${iframeId}"]`);
        if (wrapper) {
            wrapper.remove();
        }

        // Remove from iframes object
        delete AB.iframes[iframeId];

        // Ensure there's always an empty iframe at the end
        AB.ensureEmptyIframe();
    };

    // Ensure there's always one empty iframe available
    AB.ensureEmptyIframe = function() {
        // Check if there's at least one iframe without an app loaded
        const hasEmptyIframe = Object.values(AB.iframes).some(iframe => !iframe.currentApp);

        if (!hasEmptyIframe) {
            console.log('📦 Auto-creating empty iframe');
            AB.createIframe();
        }
    };

    AB.buildUI = function() {
        AB.injectStyles();

        // Status bar at top
        const statusBar = document.createElement('div');
        statusBar.id = 'ab-status-bar';
        statusBar.innerHTML = `
            <div class="ab-status-left">
                <span class="ab-logo">⚡ ActionBridge v4</span>
                <div class="ab-connection-status">
                    <div class="ab-status-dot" id="status-dot"></div>
                    <span id="status-text">Not Connected</span>
                </div>
                <div class="ab-poll-status" id="poll-status">
                    <div class="poll-indicator" id="poll-indicator"></div>
                    <span class="poll-interval" id="poll-interval">--</span>
                </div>
            </div>
            <div class="ab-status-right">
                <div class="ab-stat-item">
                    <span class="ab-stat-label">Processed:</span>
                    <span class="ab-stat-value" id="stat-processed">0</span>
                </div>
                <div class="ab-stat-item">
                    <span class="ab-stat-label">Success:</span>
                    <span class="ab-stat-value" id="stat-succeeded">0</span>
                </div>
                <div class="ab-stat-item">
                    <span class="ab-stat-label">Failed:</span>
                    <span class="ab-stat-value" id="stat-failed">0</span>
                </div>
                <button id="select-dir-btn" class="ab-btn-small">Select Directory</button>
            </div>
        `;
        document.body.appendChild(statusBar);

        // Iframes container (holds all app iframes)
        const iframesContainer = document.createElement('div');
        iframesContainer.id = 'ab-iframes-container';
        iframesContainer.style.cssText = 'position: fixed; top: 50px; left: 0; right: 0; bottom: 0; overflow-y: auto;';
        document.body.appendChild(iframesContainer);

        // Event listeners
        document.getElementById('select-dir-btn').addEventListener('click', () => AB.selectDirectory());

        // Listen for messages from app
        window.addEventListener('message', (event) => {
            if (!event.data) return;

            const { type } = event.data;

            if (type === 'AB_REQUEST') {
                AB.handleAppRequest(event);
            } else if (type === 'AB_IFRAME_HEIGHT') {
                AB.handleIframeHeightUpdate(event);
            } else if (type === 'API_TEST') {
                AB.handleAPITest(event);
            } else if (type === 'BOOTSTRAP_UPLOAD_SUCCESS') {
                // Log bootstrap upload info for debugging
                console.log('🚀 BOOTSTRAP UPLOAD SUCCESS!');
                console.log(`   Service: ${event.data.service}`);
                console.log(`   URL: ${event.data.url}`);

                // Redirect the iframe to the HTTPS URL
                const sourceFrame = event.source;
                for (const [iframeId, iframe] of Object.entries(AB.iframes)) {
                    if (iframe.frameElement && iframe.frameElement.contentWindow === sourceFrame) {
                        console.log(`🔄 Redirecting iframe '${iframeId}' to HTTPS...`);
                        iframe.frameElement.src = event.data.url;
                        break;
                    }
                }
            }
        });

        // Create first empty iframe
        AB.createIframe();
    };

    // Handle iframe height update from app
    AB.handleIframeHeightUpdate = function(event) {
        const { height } = event.data;
        const sourceFrame = event.source;

        // Find which iframe sent this message
        for (const [iframeId, iframe] of Object.entries(AB.iframes)) {
            if (iframe.frameElement && iframe.frameElement.contentWindow === sourceFrame) {
                // Update iframe height
                iframe.frameElement.style.height = height + 'px';
                console.log(`📏 Resized iframe '${iframeId}' to ${height}px`);
                return;
            }
        }
    };

    // Handle API test request from app (for testing CORS/null origin behavior)
    AB.handleAPITest = async function(event) {
        const { requestId, method, url, headers, body, timestamp } = event.data;
        const sourceFrame = event.source;

        console.log('🧪 API Test request:', { requestId, method, url });

        const startTime = performance.now();
        let response = {
            type: 'API_TEST_RESPONSE',
            requestId: requestId,
            success: false,
            status: null,
            statusText: null,
            data: null,
            error: null,
            duration: 0,
            corsError: false
        };

        try {
            // Build fetch options
            const fetchOptions = {
                method: method,
                headers: headers || {}
            };

            // Add body for POST, PUT, PATCH
            if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                fetchOptions.body = JSON.stringify(body);
                // Ensure Content-Type is set if body is provided
                if (!fetchOptions.headers['Content-Type']) {
                    fetchOptions.headers['Content-Type'] = 'application/json';
                }
            }

            // Make the fetch request from null origin (file://)
            const fetchResponse = await fetch(url, fetchOptions);

            response.success = true;
            response.status = fetchResponse.status;
            response.statusText = fetchResponse.statusText;

            // Try to parse as JSON, fall back to text
            const contentType = fetchResponse.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                response.data = await fetchResponse.json();
            } else {
                response.data = await fetchResponse.text();
            }

            console.log('✅ API Test succeeded:', { requestId, status: response.status });

        } catch (error) {
            response.success = false;
            response.error = error.message;

            // Detect CORS errors
            if (error.message.includes('CORS') ||
                error.message.includes('Failed to fetch') ||
                error.message.includes('Network request failed')) {
                response.corsError = true;
                response.error = 'CORS Error: API does not allow requests from null origin (file://)';
            }

            console.error('❌ API Test failed:', { requestId, error: error.message });
        }

        // Calculate duration
        response.duration = Math.round(performance.now() - startTime);

        // Send response back to the iframe
        if (sourceFrame) {
            sourceFrame.postMessage(response, '*');
        }
    };

    // Handle requests from sandboxed app
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

    // Save app data to filesystem
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

    // Load app data from filesystem
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

    // Delete app data
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

    // List all app data keys
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

    AB.updateStatusBar = function() {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        const selectBtn = document.getElementById('select-dir-btn');

        if (AB.dirHandle) {
            statusDot.className = 'ab-status-dot connected';
            statusText.textContent = AB.polling ? 'Connected & Polling' : 'Connected (Idle)';
            selectBtn.style.display = 'none';

            document.getElementById('stat-processed').textContent = AB.stats.processed;
            document.getElementById('stat-succeeded').textContent = AB.stats.succeeded;
            document.getElementById('stat-failed').textContent = AB.stats.failed;
        } else {
            statusDot.className = 'ab-status-dot disconnected';
            statusText.textContent = 'Not Connected';
            selectBtn.style.display = 'inline-block';
        }
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

    AB.init = async function() {
        try {
            document.title = 'ActionBridge v4 - Sandboxed App Container';
            AB.initWorker();
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
