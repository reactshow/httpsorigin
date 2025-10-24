// ActionBridge Module: Messaging
// PostMessage communication and JS execution

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - messaging.js must be loaded after actionbridge.js');
        return;
    }

    AB.executeJS = function(code, timeout = 5000, iframeId) {
        iframeId = iframeId || 'default';
        return AB.queueCommand(iframeId, () => AB._executeJSInternal(code, timeout, iframeId));
    };

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

    AB.sendToApp = function(message, iframeId) {
        iframeId = iframeId || 'default';
        return AB.queueCommand(iframeId, () => AB._sendToAppInternal(message, iframeId));
    };

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

})();
