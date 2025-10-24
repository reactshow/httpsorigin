window.WORKER_CODE = `
// ActionBridge Worker v4 - File System Polling and Command Processing
// This worker runs in a separate thread and handles:
// - Adaptive polling of command directory
// - Command file detection and processing
// - Result writing and history management
// - Status updates

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
            const tsA = parseInt(a.name.match(/cmd_(\d+)/)?.[1] || '0');
            const tsB = parseInt(b.name.match(/cmd_(\d+)/)?.[1] || '0');
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
