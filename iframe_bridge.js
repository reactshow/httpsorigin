// ActionBridge Router - Context-aware app loader
// Decides which module to load based on context (iframe vs top-level) and query string

(function() {
    'use strict';

    // Parse URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const requestedApp = urlParams.get('app');

    // Check if we're running in an iframe
    const isInIframe = window.parent !== window;

    console.log('🔀 Router initialized:', {
        isInIframe: isInIframe,
        requestedApp: requestedApp,
        url: window.location.href
    });

    // Determine which module to load
    let moduleToLoad = null;

    if (!isInIframe && !requestedApp) {
        // Top-level, no app specified → Load ActionBridge
        moduleToLoad = 'actionbridge.js';
        console.log('📦 Loading ActionBridge (top-level container)');
    } else if (isInIframe && requestedApp) {
        // Inside iframe with app specified → Load the app from client-directories/client1-browserproxy/apps/{app_name}/{app_name}.js
        // Note: apps/ is a symlink which doesn't work on file:// protocol, so use full path
        moduleToLoad = 'client-directories/client1-browserproxy/apps/' + requestedApp + '/' + requestedApp + '.js';
        console.log('📦 Loading app module:', moduleToLoad);
    } else if (!isInIframe && requestedApp) {
        // Top-level with app specified → Error (apps must run in iframe)
        console.error('❌ Apps can only run inside ActionBridge iframe');
        document.body.innerHTML = `
            <div style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #dc3545;">⚠️ Configuration Error</h1>
                <p>Apps must be loaded inside ActionBridge's iframe container.</p>
                <p>To use ActionBridge, navigate to <a href="index.html">index.html</a> (without query parameters).</p>
            </div>
        `;
        return;
    } else if (isInIframe && !requestedApp) {
        // Inside iframe without app specified → Error
        console.error('❌ No app specified in query string');
        document.body.innerHTML = `
            <div style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #dc3545;">⚠️ Configuration Error</h1>
                <p>When running in iframe, you must specify which app to load via query string.</p>
                <p>Example: <code>index.html?app=notes_app</code></p>
            </div>
        `;
        return;
    }

    // Dynamically load the appropriate module
    if (moduleToLoad) {
        const script = document.createElement('script');
        script.src = moduleToLoad;
        script.onerror = function() {
            console.error('❌ Failed to load module:', moduleToLoad);
            document.body.innerHTML = `
                <div style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #dc3545;">⚠️ Module Load Error</h1>
                    <p>Failed to load: <code>${moduleToLoad}</code></p>
                    <p>Make sure the file exists in the same directory as index.html.</p>
                </div>
            `;
        };
        script.onload = function() {
            console.log('✅ Module loaded successfully:', moduleToLoad);
        };
        document.head.appendChild(script);
    }

    // JavaScript Execution Bridge (for iframe contexts)
    // Allows parent frame to execute JavaScript in this iframe context
    if (isInIframe) {
        // Global error handler - catches all uncaught errors
        window.addEventListener('error', function(event) {
            // Send error to parent frame for logging
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

            // Don't prevent default - let error still appear in console
            return false;
        });

        // Unhandled promise rejection handler
        window.addEventListener('unhandledrejection', function(event) {
            // Send rejection to parent frame for logging
            window.parent.postMessage({
                type: 'AB_IFRAME_PROMISE_REJECTION',
                error: {
                    message: event.reason ? event.reason.message || String(event.reason) : 'Unknown rejection',
                    stack: event.reason ? event.reason.stack : null
                },
                timestamp: Date.now()
            }, '*');

            // Don't prevent default - let rejection still appear in console
            return false;
        });

        // Command execution handler with console capture
        window.addEventListener('message', function(event) {
            const message = event.data;

            // Only handle JS execution requests
            if (message.type !== 'AB_EXECUTE_JS') return;

            console.log('🔧 Executing JS in iframe:', message.requestId);

            const response = {
                type: 'AB_EXECUTE_JS_RESPONSE',
                requestId: message.requestId,
                success: false,
                result: null,
                error: null,
                console: []  // Captured console output
            };

            // Execute the JavaScript code (support both sync and async)
            (async function() {
                // Store original console methods
                const originalLog = console.log;
                const originalWarn = console.warn;
                const originalError = console.error;
                const capturedConsole = [];

                // Intercept console during execution
                console.log = function(...args) {
                    capturedConsole.push({
                        level: 'log',
                        message: args.map(a => String(a)).join(' '),
                        timestamp: Date.now()
                    });
                    originalLog.apply(console, args);  // Still log to console
                };

                console.warn = function(...args) {
                    capturedConsole.push({
                        level: 'warn',
                        message: args.map(a => String(a)).join(' '),
                        timestamp: Date.now()
                    });
                    originalWarn.apply(console, args);  // Still log to console
                };

                console.error = function(...args) {
                    capturedConsole.push({
                        level: 'error',
                        message: args.map(a => String(a)).join(' '),
                        timestamp: Date.now()
                    });
                    originalError.apply(console, args);  // Still log to console
                };

                try {
                    // Use Function constructor to avoid strict mode issues with eval
                    // Wrap in async function to support await
                    const executeCode = new Function('return (async function() { ' + message.code + ' })()');
                    const result = await executeCode();

                    response.success = true;
                    response.result = result;
                    response.console = capturedConsole;
                    console.log('✅ JS execution successful:', result);
                } catch (error) {
                    response.error = error.message;
                    response.stack = error.stack;
                    response.console = capturedConsole;
                    console.error('❌ JS execution failed:', error);
                } finally {
                    // Restore original console methods
                    console.log = originalLog;
                    console.warn = originalWarn;
                    console.error = originalError;
                }

                // Send response back to parent
                window.parent.postMessage(response, '*');
            })();
        });

        console.log('🔧 JavaScript execution bridge initialized with error capture');

        // Height auto-reporting for iframe resize
        let lastReportedHeight = 0;

        function reportHeight() {
            const height = Math.max(
                document.documentElement.scrollHeight,
                document.documentElement.offsetHeight,
                document.body.scrollHeight,
                document.body.offsetHeight
            );

            // Only report if height changed significantly (avoid spam)
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
                setTimeout(reportHeight, 100); // Small delay to ensure rendering
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
            // Fallback: Poll for height changes
            setInterval(reportHeight, 500);
        }

        // Also report on window resize
        window.addEventListener('resize', reportHeight);

        console.log('📏 Height auto-reporting initialized');
    }
})();
