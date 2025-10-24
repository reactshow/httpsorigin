// ActionBridge Module: Command Queue
// Command queuing and execution

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - command-queue.js must be loaded after actionbridge.js');
        return;
    }

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

    AB.updateQueueCount = function(iframeId) {
        const iframe = AB.iframes[iframeId];
        if (!iframe) return;

        const count = iframe.queue.length + (iframe.executionInProgress ? 1 : 0);
        const queueCountEl = document.querySelector(`[data-action="reset-queue"][data-iframe-id="${iframeId}"] .queue-count`);
        if (queueCountEl) {
            queueCountEl.textContent = count;
        }
    };

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

})();
