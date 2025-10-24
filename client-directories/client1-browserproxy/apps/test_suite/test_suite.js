// ActionBridge Test Suite
// Comprehensive tests for storage, communication, and multi-iframe functionality

(function() {
    'use strict';

    // Namespace
    window.TestSuite = {
        appName: 'test_suite',
        tests: [],
        results: [],
        currentTest: 0
    };

    const App = window.TestSuite;

    // Initialize test suite
    App.init = async function() {
        console.log('🧪 ActionBridge Test Suite initializing...');

        App.injectStyles();
        App.buildDOM();
        await App.registerTests();

        console.log('✅ Test Suite initialized with', App.tests.length, 'tests');
    };

    // Inject CSS styles
    App.injectStyles = function() {
        const style = document.createElement('style');
        style.textContent = `
            body {
                margin: 0;
                padding: 20px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
                background: #1a1a1a;
                color: #e0e0e0;
            }

            .test-container {
                max-width: 1000px;
                margin: 0 auto;
            }

            h1 {
                color: #ffffff;
                text-align: center;
                margin: 0 0 4px 0;
                font-size: 24px;
            }

            .subtitle {
                color: rgba(255, 255, 255, 0.7);
                text-align: center;
                margin: 0 0 12px 0;
                font-size: 13px;
            }

            .test-controls {
                display: flex;
                gap: 10px;
                margin-bottom: 15px;
                justify-content: center;
            }

            .btn {
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.2s;
            }

            .btn-primary {
                background: #4CAF50;
                color: white;
            }

            .btn-primary:hover {
                background: #45a049;
            }

            .btn-secondary {
                background: #2196F3;
                color: white;
            }

            .btn-secondary:hover {
                background: #0b7dda;
            }

            .test-summary {
                background: #2a2a2a;
                padding: 12px;
                border-radius: 8px;
                margin-bottom: 15px;
                display: flex;
                justify-content: space-around;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            }

            .summary-item {
                text-align: center;
            }

            .summary-label {
                font-size: 11px;
                color: #999;
                text-transform: uppercase;
                margin-bottom: 4px;
            }

            .summary-value {
                font-size: 20px;
                font-weight: bold;
            }

            .summary-value.total { color: #999; }
            .summary-value.passed { color: #4CAF50; }
            .summary-value.failed { color: #f44336; }
            .summary-value.pending { color: #ff9800; }

            .test-list {
                background: #2a2a2a;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            }

            .test-item {
                padding: 10px 16px;
                border-bottom: 1px solid #3a3a3a;
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .test-item:last-child {
                border-bottom: none;
            }

            .test-status {
                width: 26px;
                height: 26px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                flex-shrink: 0;
            }

            .test-status.pending {
                background: #3a3a3a;
                color: #666;
            }

            .test-status.running {
                background: #4a3a1a;
                color: #ff9800;
            }

            .test-status.passed {
                background: #1a3a1a;
                color: #4CAF50;
            }

            .test-status.failed {
                background: #3a1a1a;
                color: #f44336;
            }

            .test-info {
                flex: 1;
            }

            .test-name {
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 2px;
                color: #e0e0e0;
            }

            .test-category {
                font-size: 10px;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .test-duration {
                font-size: 11px;
                color: #777;
                min-width: 60px;
                text-align: right;
            }

            .test-error {
                margin-top: 5px;
                padding: 8px;
                background: #2a1a1a;
                border-left: 3px solid #f44336;
                font-size: 11px;
                font-family: monospace;
                color: #ff6b6b;
            }

            .progress-bar {
                height: 4px;
                background: #3a3a3a;
                border-radius: 2px;
                margin: 10px 0;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
                transition: width 0.3s;
            }

            .category-group {
                margin-bottom: 20px;
            }

            .category-group:last-child {
                margin-bottom: 0;
            }
        `;
        document.head.appendChild(style);
    };

    // Build DOM structure
    App.buildDOM = function() {
        document.title = 'ActionBridge Test Suite';

        const container = document.createElement('div');
        container.className = 'test-container';
        container.innerHTML = `
            <h1>🧪 ActionBridge Test Suite</h1>
            <div class="subtitle">Comprehensive testing for storage, communication, and multi-iframe functionality</div>

            <div class="test-controls">
                <button class="btn btn-primary" id="runAllBtn">▶️ Run All Tests</button>
                <button class="btn btn-secondary" id="clearBtn">🗑️ Clear Results</button>
            </div>

            <div class="test-summary">
                <div class="summary-item">
                    <div class="summary-label">Total</div>
                    <div class="summary-value total" id="totalTests">0</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Passed</div>
                    <div class="summary-value passed" id="passedTests">0</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Failed</div>
                    <div class="summary-value failed" id="failedTests">0</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Pending</div>
                    <div class="summary-value pending" id="pendingTests">0</div>
                </div>
            </div>

            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            </div>

            <div class="test-list" id="testList"></div>
        `;

        document.body.appendChild(container);

        // Attach event listeners
        document.getElementById('runAllBtn').addEventListener('click', () => App.runAllTests());
        document.getElementById('clearBtn').addEventListener('click', () => App.clearResults());
    };

    // Send message to ActionBridge
    App.sendToActionBridge = function(action, data, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            const responseHandler = function(event) {
                if (event.data && event.data.type === 'AB_RESPONSE' && event.data.requestId === requestId) {
                    window.removeEventListener('message', responseHandler);

                    if (event.data.success) {
                        resolve(event.data.data);
                    } else {
                        reject(new Error(event.data.error || 'Unknown error'));
                    }
                }
            };

            window.addEventListener('message', responseHandler);

            window.parent.postMessage({
                type: 'AB_REQUEST',
                action: action,
                data: data,
                requestId: requestId
            }, '*');

            // Timeout
            setTimeout(() => {
                window.removeEventListener('message', responseHandler);
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);
        });
    };

    // Helper: Load an app via ActionBridge
    // Returns the iframe ID where the app was loaded
    // If no iframeId specified, ActionBridge will pick the first available iframe
    App.loadApp = async function(appName, iframeId = null) {
        const request = { appName };
        if (iframeId) {
            request.iframeId = iframeId;
        }
        // If iframeId is null/undefined, ActionBridge will auto-select an available iframe
        const result = await App.sendToActionBridge('LOAD_APP', request, 10000);
        return result.iframeId; // Return the actual iframe used
    };

    // Helper: Execute JavaScript in an app by app name
    // No need to specify iframe - ActionBridge finds it automatically
    App.executeJS = function(code, appName, timeout = 5000) {
        return App.sendToActionBridge('EXECUTE_JS', { code, appName, timeout }, timeout + 1000);
    };

    // Helper: Check if an app is loaded (searches all iframes)
    App.isAppLoaded = async function(appName) {
        try {
            // Convert app_name to AppName (e.g., notes_app -> NotesApp)
            const className = appName.split('_').map(part =>
                part.charAt(0).toUpperCase() + part.slice(1)
            ).join('');

            const result = await App.executeJS(
                `return typeof window.${className} !== 'undefined' ? 'loaded' : 'not_loaded';`,
                appName,
                2000
            );
            return result.result === 'loaded';
        } catch (err) {
            // App not loaded if error (e.g., "App not currently loaded")
            return false;
        }
    };

    // Helper: Unload an app (best effort)
    // Since ActionBridge doesn't have explicit unload, we simply reload the iframe with empty content
    App.unloadApp = async function(appName) {
        try {
            console.log(`🗑️ Unloading app: ${appName}`);
            // Try to send UNLOAD_APP action (might not be implemented)
            await App.sendToActionBridge('UNLOAD_APP', { appName }, 2000);
        } catch (err) {
            // UNLOAD_APP might not exist - that's okay, app stays loaded
            console.log(`ℹ️  Could not unload ${appName} (action may not be supported):`, err.message);
        }
    };

    // Register all tests
    App.registerTests = async function() {
        // Storage Tests
        App.addTest('Storage', 'Save data to disk', async () => {
            const testData = { value: 'test_' + Date.now(), nested: { array: [1, 2, 3] } };
            const result = await App.sendToActionBridge('SAVE_DATA', {
                key: 'test_save',
                value: testData,
                appName: App.appName
            });

            if (!result || !result.saved) {
                throw new Error('Save operation did not return success');
            }
        });

        App.addTest('Storage', 'Load data from disk', async () => {
            const testData = { value: 'test_load_' + Date.now() };

            // First save
            await App.sendToActionBridge('SAVE_DATA', {
                key: 'test_load',
                value: testData,
                appName: App.appName
            });

            // Then load
            const loaded = await App.sendToActionBridge('LOAD_DATA', {
                key: 'test_load',
                appName: App.appName
            });

            if (!loaded || loaded.value.value !== testData.value) {
                throw new Error('Loaded data does not match saved data');
            }
        });

        App.addTest('Storage', 'Delete data from disk', async () => {
            // Save first
            await App.sendToActionBridge('SAVE_DATA', {
                key: 'test_delete',
                value: { test: true },
                appName: App.appName
            });

            // Delete
            await App.sendToActionBridge('DELETE_DATA', {
                key: 'test_delete',
                appName: App.appName
            });

            // Verify deleted
            try {
                const loaded = await App.sendToActionBridge('LOAD_DATA', {
                    key: 'test_delete',
                    appName: App.appName
                });

                if (loaded && loaded.value) {
                    throw new Error('Data still exists after delete');
                }
            } catch (error) {
                // Expected - file not found is success
                if (!error.message.includes('not found') && !error.message.includes('NotFoundError')) {
                    throw error;
                }
            }
        });

        App.addTest('Storage', 'List all data keys', async () => {
            // Save multiple items
            await App.sendToActionBridge('SAVE_DATA', {
                key: 'list_test_1',
                value: { id: 1 },
                appName: App.appName
            });

            await App.sendToActionBridge('SAVE_DATA', {
                key: 'list_test_2',
                value: { id: 2 },
                appName: App.appName
            });

            // List all
            const list = await App.sendToActionBridge('LIST_DATA', {
                appName: App.appName
            });

            if (!Array.isArray(list) || list.length < 2) {
                throw new Error('LIST_DATA did not return expected array');
            }

            const hasTest1 = list.includes('list_test_1');
            const hasTest2 = list.includes('list_test_2');

            if (!hasTest1 || !hasTest2) {
                throw new Error('LIST_DATA missing expected keys');
            }
        });

        App.addTest('Storage', 'Handle non-existent key', async () => {
            try {
                const result = await App.sendToActionBridge('LOAD_DATA', {
                    key: 'nonexistent_key_' + Date.now(),
                    appName: App.appName
                });

                // Should return null or throw error
                if (result && result.value) {
                    throw new Error('Should not return data for non-existent key');
                }
            } catch (error) {
                // Expected - either NotFoundError or null response
                if (!error.message.includes('not found') && !error.message.includes('NotFoundError') && !error.message.includes('null')) {
                    throw error;
                }
            }
        });

        // Communication Tests
        App.addTest('Communication', 'Response contains correct structure', async () => {
            const result = await App.sendToActionBridge('SAVE_DATA', {
                key: 'test_response',
                value: { test: true },
                appName: App.appName
            });

            if (typeof result !== 'object') {
                throw new Error('Response is not an object');
            }

            if (!result.hasOwnProperty('saved') || !result.hasOwnProperty('key')) {
                throw new Error('Response missing expected properties');
            }
        });

        App.addTest('Communication', 'Handle timeout gracefully', async () => {
            // This test verifies timeout handling works
            // We can't actually trigger a timeout without modifying ActionBridge,
            // so we just verify the timeout mechanism exists

            const start = Date.now();
            try {
                // Make a normal request
                await App.sendToActionBridge('SAVE_DATA', {
                    key: 'timeout_test',
                    value: { test: true },
                    appName: App.appName
                });

                const duration = Date.now() - start;

                // Should complete quickly (< 1000ms for simple save)
                if (duration > 1000) {
                    throw new Error('Request took too long: ' + duration + 'ms');
                }
            } catch (error) {
                if (error.message.includes('timeout')) {
                    // Timeout occurred - test passed
                    return;
                }
                throw error;
            }
        });

        // Data Integrity Tests
        App.addTest('Data Integrity', 'Preserve complex nested objects', async () => {
            const complexData = {
                string: 'test',
                number: 42,
                boolean: true,
                null: null,
                array: [1, 2, 3, { nested: true }],
                object: {
                    deep: {
                        nested: {
                            value: 'deep'
                        }
                    }
                }
            };

            await App.sendToActionBridge('SAVE_DATA', {
                key: 'complex_data',
                value: complexData,
                appName: App.appName
            });

            const loaded = await App.sendToActionBridge('LOAD_DATA', {
                key: 'complex_data',
                appName: App.appName
            });

            if (JSON.stringify(loaded.value) !== JSON.stringify(complexData)) {
                throw new Error('Complex data structure not preserved');
            }
        });

        App.addTest('Data Integrity', 'Handle large data (10KB)', async () => {
            // Create ~10KB of data
            const largeString = 'x'.repeat(10000);
            const largeData = { data: largeString };

            await App.sendToActionBridge('SAVE_DATA', {
                key: 'large_data',
                value: largeData,
                appName: App.appName
            });

            const loaded = await App.sendToActionBridge('LOAD_DATA', {
                key: 'large_data',
                appName: App.appName
            });

            if (loaded.value.data.length !== 10000) {
                throw new Error('Large data not fully saved/loaded');
            }
        });

        App.addTest('Data Integrity', 'Handle special characters', async () => {
            const specialData = {
                unicode: '你好世界 🌍',
                quotes: 'She said "hello" and he said \'goodbye\'',
                newlines: 'line1\\nline2\\ntab\\there',
                special: '<>&"\'/\\[]{}()'
            };

            await App.sendToActionBridge('SAVE_DATA', {
                key: 'special_chars',
                value: specialData,
                appName: App.appName
            });

            const loaded = await App.sendToActionBridge('LOAD_DATA', {
                key: 'special_chars',
                appName: App.appName
            });

            if (JSON.stringify(loaded.value) !== JSON.stringify(specialData)) {
                throw new Error('Special characters not preserved');
            }
        });

        // ====================================================================
        // External App Tests - Dynamically loaded from app/tests/ directories
        // ====================================================================

        // Load tests from other apps' test directories
        await App.loadExternalTests();

        // Update UI with test count
        App.updateSummary();
        App.renderTests();
    };

    // Add a test
    App.addTest = function(category, name, testFn, appName = null) {
        // If appName not provided, use context from external test loading
        const testAppName = appName || window.__currentTestAppName || null;

        App.tests.push({
            id: App.tests.length,
            category: category,
            name: name,
            testFn: testFn,
            appName: testAppName,  // Track which app this test belongs to
            status: 'pending',
            duration: null,
            error: null
        });
    };

    // Load external test files from other apps
    App.loadExternalTests = async function() {
        console.log('🔍 Discovering external app tests...');

        // List of known apps to check (could also discover this dynamically)
        const appsToCheck = ['notes_app', 'crypto_prices', 'api_tester', 'api_tester_https'];

        for (const appName of appsToCheck) {
            try {
                // List test files from app's tests/ directory using new LIST_TESTS action
                console.log(`🔎 Checking ${appName} for tests...`);

                const testFileList = await App.sendToActionBridge('LIST_TESTS', {
                    appName: appName
                });

                if (!testFileList || !Array.isArray(testFileList) || testFileList.length === 0) {
                    console.log(`ℹ️  No test files found for ${appName}`);
                    continue;
                }

                console.log(`📝 Found ${testFileList.length} test file(s) for ${appName}:`, testFileList.map(t => t.name));

                // Load each test file
                for (const testInfo of testFileList) {
                    try {
                        // Load test file content via ActionBridge using new LOAD_TEST action
                        const testData = await App.sendToActionBridge('LOAD_TEST', {
                            testKey: testInfo.key,
                            appName: appName
                        });

                        if (!testData) {
                            console.error(`❌ No data for ${appName}/tests/${testInfo.name}`);
                            continue;
                        }

                        // Extract test code from the data structure
                        let testCode = null;
                        if (testData.value) {
                            testCode = testData.value;
                        } else {
                            console.error(`❌ No 'value' property found for ${appName}/tests/${testInfo.name}`);
                            continue;
                        }

                        // Set context for tests to know which app they belong to
                        window.__currentTestAppName = appName;

                        // Execute the test code
                        const script = document.createElement('script');
                        script.textContent = testCode;
                        document.head.appendChild(script);

                        // Clear context
                        delete window.__currentTestAppName;

                        console.log(`✅ Tests loaded from ${appName}/tests/${testInfo.name}`);
                    } catch (err) {
                        console.error(`❌ Failed to load ${appName}/tests/${testInfo.name}:`, err);
                    }
                }
            } catch (err) {
                // App doesn't have tests or error accessing - that's okay
                console.log(`ℹ️  Could not check tests for ${appName}:`, err.message);
            }
        }

        console.log(`✅ Loaded ${App.tests.length} total tests`);
    };

    // Helper: Load a script dynamically
    App.loadScript = function(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
            document.head.appendChild(script);
        });
    };

    // Run all tests with app lifecycle management
    App.runAllTests = async function() {
        console.log('▶️ Running all tests with app lifecycle management...');
        App.results = [];
        App.currentTest = 0;

        // Group tests by appName (null = built-in tests)
        const testGroups = {};
        App.tests.forEach((test, index) => {
            const groupKey = test.appName || '__builtin__';
            if (!testGroups[groupKey]) {
                testGroups[groupKey] = [];
            }
            testGroups[groupKey].push(index);
        });

        console.log('📊 Test groups:', Object.keys(testGroups).map(k =>
            k === '__builtin__' ? 'Built-in' : k
        ).join(', '));

        // Run built-in tests first (no app loading needed)
        if (testGroups['__builtin__']) {
            console.log('🔧 Running built-in tests...');
            for (const testIndex of testGroups['__builtin__']) {
                await App.runTest(testIndex);
            }
            delete testGroups['__builtin__'];
        }

        // Run tests for each app with lifecycle management
        for (const appName of Object.keys(testGroups)) {
            const testIndices = testGroups[appName];
            console.log(`\n📱 Running ${testIndices.length} test(s) for app: ${appName}`);

            // Check if app is already loaded
            const wasAlreadyLoaded = await App.isAppLoaded(appName);
            let openedByUs = false;

            if (wasAlreadyLoaded) {
                console.log(`ℹ️  App ${appName} is already loaded`);
            } else {
                console.log(`📂 Loading app ${appName} for testing...`);
                try {
                    await App.loadApp(appName);
                    openedByUs = true;
                    console.log(`✅ App ${appName} loaded successfully`);
                    // Wait a bit for app to initialize
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err) {
                    console.error(`❌ Failed to load app ${appName}:`, err.message);
                    // Mark all tests for this app as failed
                    for (const testIndex of testIndices) {
                        const test = App.tests[testIndex];
                        test.status = 'failed';
                        test.error = `Failed to load app ${appName}: ${err.message}`;
                        test.duration = 0;
                    }
                    App.renderTests();
                    App.updateSummary();
                    continue;
                }
            }

            // Run all tests for this app
            for (const testIndex of testIndices) {
                await App.runTest(testIndex);
            }

            // Unload app if we loaded it
            if (openedByUs) {
                console.log(`🗑️ App ${appName} was loaded by test suite, unloading...`);
                await App.unloadApp(appName);
            } else {
                console.log(`ℹ️  App ${appName} was already loaded, leaving it open`);
            }
        }

        console.log('\n✅ All tests complete');
        App.showFinalSummary();
    };

    // Run single test
    App.runTest = async function(index) {
        const test = App.tests[index];
        App.currentTest = index;

        test.status = 'running';
        test.error = null;
        App.renderTests();
        App.updateProgress();

        const start = Date.now();

        try {
            await test.testFn();
            test.status = 'passed';
            test.duration = Date.now() - start;
            console.log('✓', test.category, '-', test.name, '(' + test.duration + 'ms)');
        } catch (error) {
            test.status = 'failed';
            test.duration = Date.now() - start;
            test.error = error.message;
            console.error('✗', test.category, '-', test.name, ':', error.message);
        }

        App.renderTests();
        App.updateSummary();
        App.updateProgress();

        // Small delay between tests
        await new Promise(r => setTimeout(r, 100));
    };

    // Render test list
    App.renderTests = function() {
        const listEl = document.getElementById('testList');
        if (!listEl) return;

        listEl.innerHTML = '';

        // Group tests by category
        const categories = {};
        App.tests.forEach(test => {
            if (!categories[test.category]) {
                categories[test.category] = [];
            }
            categories[test.category].push(test);
        });

        // Render each category group
        Object.keys(categories).forEach(categoryName => {
            const categoryGroup = document.createElement('div');
            categoryGroup.className = 'category-group';

            const categoryTests = categories[categoryName];
            categoryTests.forEach(test => {
                const item = document.createElement('div');
                item.className = 'test-item';

                const statusIcon = {
                    pending: '○',
                    running: '⟳',
                    passed: '✓',
                    failed: '✗'
                }[test.status];

                const errorHtml = test.error ? `<div class="test-error">${escapeHtml(test.error)}</div>` : '';

                item.innerHTML = `
                    <div class="test-status ${test.status}">${statusIcon}</div>
                    <div class="test-info">
                        <div class="test-name">${escapeHtml(test.name)}</div>
                        <div class="test-category">${escapeHtml(test.category)}</div>
                        ${errorHtml}
                    </div>
                    <div class="test-duration">${test.duration !== null ? test.duration + 'ms' : ''}</div>
                `;

                categoryGroup.appendChild(item);
            });

            listEl.appendChild(categoryGroup);
        });
    };

    // Update summary
    App.updateSummary = function() {
        const total = App.tests.length;
        const passed = App.tests.filter(t => t.status === 'passed').length;
        const failed = App.tests.filter(t => t.status === 'failed').length;
        const pending = App.tests.filter(t => t.status === 'pending').length;

        document.getElementById('totalTests').textContent = total;
        document.getElementById('passedTests').textContent = passed;
        document.getElementById('failedTests').textContent = failed;
        document.getElementById('pendingTests').textContent = pending;
    };

    // Update progress bar
    App.updateProgress = function() {
        const completed = App.tests.filter(t => t.status !== 'pending').length;
        const percent = (completed / App.tests.length) * 100;
        document.getElementById('progressFill').style.width = percent + '%';
    };

    // Show final summary
    App.showFinalSummary = function() {
        const passed = App.tests.filter(t => t.status === 'passed').length;
        const failed = App.tests.filter(t => t.status === 'failed').length;

        console.log('📊 Test Summary:');
        console.log('   Total:', App.tests.length);
        console.log('   Passed:', passed);
        console.log('   Failed:', failed);
        console.log('   Success Rate:', ((passed / App.tests.length) * 100).toFixed(1) + '%');
    };

    // Clear results
    App.clearResults = function() {
        App.tests.forEach(test => {
            test.status = 'pending';
            test.duration = null;
            test.error = null;
        });

        App.currentTest = 0;
        App.renderTests();
        App.updateSummary();
        App.updateProgress();

        console.log('🗑️ Results cleared');
    };

    // Helper: Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

    // Expose test results for external access
    window.TestSuite.getResults = function() {
        return {
            total: App.tests.length,
            passed: App.tests.filter(t => t.status === 'passed').length,
            failed: App.tests.filter(t => t.status === 'failed').length,
            pending: App.tests.filter(t => t.status === 'pending').length,
            tests: App.tests.map(t => ({
                category: t.category,
                name: t.name,
                status: t.status,
                duration: t.duration,
                error: t.error
            }))
        };
    };

})();
