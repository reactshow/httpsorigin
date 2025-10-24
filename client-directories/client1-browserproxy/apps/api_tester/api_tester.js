// api_tester.js - API Tester App
// Test arbitrary APIs from null origin (file://) to see which ones have CORS restrictions

(function() {
    'use strict';

    const APITester = {
        history: [],
        requestId: 0,

        init: function() {
            console.log('🧪 API Tester App initializing...');
            console.log('🌐 Origin:', window.location.origin);
            console.log('🔗 Protocol:', window.location.protocol);

            this.injectStyles();
            this.buildUI();
            this.setupMessageListener();
        },

        injectStyles: function() {
            const style = document.createElement('style');
            style.textContent = `
                /* Dark Mode Base */
                body {
                    margin: 0;
                    padding: 20px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    background: #1a1a1a;
                    color: #e0e0e0;
                }

                .api-tester-container {
                    max-width: 1200px;
                    margin: 0 auto;
                }

                .api-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 24px;
                    border-radius: 12px;
                    margin-bottom: 20px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }

                .api-header h1 {
                    margin: 0 0 8px 0;
                    font-size: 28px;
                    color: white;
                }

                .api-header .subtitle {
                    margin: 0;
                    opacity: 0.9;
                    color: white;
                    font-size: 14px;
                }

                .api-header .origin-info {
                    margin-top: 12px;
                    padding: 8px 12px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 6px;
                    font-family: monospace;
                    font-size: 12px;
                }

                .two-column {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                }

                @media (max-width: 900px) {
                    .two-column {
                        grid-template-columns: 1fr;
                    }
                }

                .panel {
                    background: #2a2a2a;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }

                .panel h2 {
                    margin: 0 0 16px 0;
                    font-size: 18px;
                    color: #667eea;
                }

                .form-group {
                    margin-bottom: 16px;
                }

                .form-group label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 13px;
                    color: #999;
                    font-weight: 600;
                }

                .form-group input,
                .form-group select,
                .form-group textarea {
                    width: 100%;
                    padding: 10px;
                    background: #1a1a1a;
                    border: 1px solid #3a3a3a;
                    border-radius: 6px;
                    color: #e0e0e0;
                    font-family: inherit;
                    font-size: 14px;
                    box-sizing: border-box;
                }

                .form-group textarea {
                    resize: vertical;
                    min-height: 80px;
                    font-family: 'Courier New', monospace;
                }

                .form-group input:focus,
                .form-group select:focus,
                .form-group textarea:focus {
                    outline: none;
                    border-color: #667eea;
                }

                .btn {
                    padding: 12px 24px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    width: 100%;
                }

                .btn:hover {
                    background: #5568d3;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
                }

                .btn:active {
                    transform: translateY(0);
                }

                .btn:disabled {
                    background: #3a3a3a;
                    color: #666;
                    cursor: not-allowed;
                    transform: none;
                }

                .btn-preset {
                    padding: 8px 12px;
                    background: #3a3a3a;
                    color: #999;
                    border: 1px solid #4a4a4a;
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-right: 8px;
                    margin-bottom: 8px;
                }

                .btn-preset:hover {
                    background: #4a4a4a;
                    color: #e0e0e0;
                    border-color: #667eea;
                }

                .presets {
                    display: flex;
                    flex-wrap: wrap;
                    margin-bottom: 16px;
                }

                .result-box {
                    background: #1a1a1a;
                    border: 1px solid #3a3a3a;
                    border-radius: 8px;
                    padding: 16px;
                    margin-top: 16px;
                    max-height: 400px;
                    overflow-y: auto;
                }

                .result-box pre {
                    margin: 0;
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    white-space: pre-wrap;
                    word-break: break-all;
                }

                .result-success {
                    border-left: 4px solid #4CAF50;
                }

                .result-error {
                    border-left: 4px solid #f44336;
                }

                .result-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid #3a3a3a;
                }

                .result-status {
                    font-weight: 600;
                    font-size: 14px;
                }

                .result-status.success {
                    color: #4CAF50;
                }

                .result-status.error {
                    color: #f44336;
                }

                .result-time {
                    font-size: 12px;
                    color: #666;
                }

                .history-list {
                    max-height: 500px;
                    overflow-y: auto;
                }

                .history-item {
                    background: #1a1a1a;
                    border: 1px solid #3a3a3a;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .history-item:hover {
                    border-color: #667eea;
                    background: #252525;
                }

                .history-item-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .history-method {
                    font-weight: 600;
                    font-size: 12px;
                    padding: 4px 8px;
                    border-radius: 4px;
                    background: #3a3a3a;
                }

                .history-method.GET {
                    background: #2196F3;
                }

                .history-method.POST {
                    background: #4CAF50;
                }

                .history-method.PUT {
                    background: #FF9800;
                }

                .history-method.DELETE {
                    background: #f44336;
                }

                .history-url {
                    font-size: 13px;
                    color: #999;
                    margin-bottom: 6px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .history-status {
                    font-size: 12px;
                }

                .history-status.success {
                    color: #4CAF50;
                }

                .history-status.error {
                    color: #f44336;
                }

                .loading {
                    text-align: center;
                    padding: 20px;
                    color: #999;
                }

                .loading::after {
                    content: '...';
                    animation: dots 1.5s infinite;
                }

                @keyframes dots {
                    0%, 20% { content: '.'; }
                    40% { content: '..'; }
                    60%, 100% { content: '...'; }
                }

                .empty-state {
                    text-align: center;
                    padding: 40px;
                    color: #666;
                }
            `;
            document.head.appendChild(style);
        },

        buildUI: function() {
            document.title = 'API Tester - Null Origin';

            const container = document.createElement('div');
            container.className = 'api-tester-container';

            // Header
            const header = document.createElement('div');
            header.className = 'api-header';
            header.innerHTML = `
                <h1>🧪 API Tester</h1>
                <p class="subtitle">Test arbitrary API endpoints from null origin (file://)</p>
                <div class="origin-info">
                    🌐 Origin: ${window.location.origin}<br>
                    🔗 Protocol: ${window.location.protocol}
                </div>
            `;
            container.appendChild(header);

            // Two column layout
            const twoColumn = document.createElement('div');
            twoColumn.className = 'two-column';

            // Left column - Request form
            const leftPanel = document.createElement('div');
            leftPanel.className = 'panel';
            leftPanel.innerHTML = `
                <h2>📤 Request</h2>

                <div class="presets">
                    <button class="btn-preset" data-preset="coingecko">CoinGecko (Works)</button>
                    <button class="btn-preset" data-preset="jsonplaceholder">JSONPlaceholder</button>
                    <button class="btn-preset" data-preset="httpbin">HTTPBin</button>
                    <button class="btn-preset" data-preset="github">GitHub API</button>
                    <button class="btn-preset" data-preset="openai">OpenAI (Restricted)</button>
                </div>

                <div class="form-group">
                    <label>HTTP Method</label>
                    <select id="method">
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>URL</label>
                    <input type="text" id="url" placeholder="https://api.example.com/endpoint" value="https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd">
                </div>

                <div class="form-group">
                    <label>Headers (JSON format, optional)</label>
                    <textarea id="headers" placeholder='{"Content-Type": "application/json"}'></textarea>
                </div>

                <div class="form-group">
                    <label>Body (JSON format, optional)</label>
                    <textarea id="body" placeholder='{"key": "value"}'></textarea>
                </div>

                <button class="btn" id="send-btn">🚀 Send Request</button>
            `;
            twoColumn.appendChild(leftPanel);

            // Right column - Response and history
            const rightPanel = document.createElement('div');
            rightPanel.className = 'panel';
            rightPanel.innerHTML = `
                <h2>📥 Response</h2>
                <div id="response-area">
                    <div class="empty-state">No requests sent yet</div>
                </div>
            `;
            twoColumn.appendChild(rightPanel);

            container.appendChild(twoColumn);

            // History panel (full width below)
            const historyPanel = document.createElement('div');
            historyPanel.className = 'panel';
            historyPanel.style.marginTop = '20px';
            historyPanel.innerHTML = `
                <h2>📜 Request History</h2>
                <div id="history-area">
                    <div class="empty-state">No history yet</div>
                </div>
            `;
            container.appendChild(historyPanel);

            document.body.appendChild(container);

            // Event listeners
            document.getElementById('send-btn').addEventListener('click', () => this.sendRequest());

            // Preset buttons
            document.querySelectorAll('.btn-preset').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const preset = e.target.dataset.preset;
                    this.loadPreset(preset);
                });
            });

            // History item clicks
            document.getElementById('history-area').addEventListener('click', (e) => {
                const item = e.target.closest('.history-item');
                if (item) {
                    const index = parseInt(item.dataset.index);
                    this.loadFromHistory(index);
                }
            });
        },

        loadPreset: function(preset) {
            const presets = {
                coingecko: {
                    method: 'GET',
                    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
                    headers: '',
                    body: ''
                },
                jsonplaceholder: {
                    method: 'GET',
                    url: 'https://jsonplaceholder.typicode.com/posts/1',
                    headers: '',
                    body: ''
                },
                httpbin: {
                    method: 'GET',
                    url: 'https://httpbin.org/get',
                    headers: '',
                    body: ''
                },
                github: {
                    method: 'GET',
                    url: 'https://api.github.com/users/github',
                    headers: '',
                    body: ''
                },
                openai: {
                    method: 'POST',
                    url: 'https://api.openai.com/v1/chat/completions',
                    headers: '{"Authorization": "Bearer YOUR_API_KEY", "Content-Type": "application/json"}',
                    body: '{"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "Hello"}]}'
                }
            };

            const config = presets[preset];
            if (config) {
                document.getElementById('method').value = config.method;
                document.getElementById('url').value = config.url;
                document.getElementById('headers').value = config.headers;
                document.getElementById('body').value = config.body;
            }
        },

        setupMessageListener: function() {
            window.addEventListener('message', (event) => {
                const msg = event.data;

                if (msg.type === 'API_TEST_RESPONSE') {
                    this.handleResponse(msg);
                }
            });
        },

        sendRequest: function() {
            const method = document.getElementById('method').value;
            const url = document.getElementById('url').value.trim();
            const headersText = document.getElementById('headers').value.trim();
            const bodyText = document.getElementById('body').value.trim();

            if (!url) {
                alert('Please enter a URL');
                return;
            }

            // Parse headers
            let headers = {};
            if (headersText) {
                try {
                    headers = JSON.parse(headersText);
                } catch (e) {
                    alert('Invalid JSON in headers field');
                    return;
                }
            }

            // Parse body
            let body = null;
            if (bodyText && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                try {
                    body = JSON.parse(bodyText);
                } catch (e) {
                    alert('Invalid JSON in body field');
                    return;
                }
            }

            const requestId = this.requestId++;
            const timestamp = Date.now();

            console.log('📤 Sending API test request:', { requestId, method, url });

            // Show loading state
            const responseArea = document.getElementById('response-area');
            responseArea.innerHTML = '<div class="loading">Sending request</div>';

            // Disable send button
            document.getElementById('send-btn').disabled = true;

            // Send API_TEST command to ActionBridge parent
            window.parent.postMessage({
                type: 'API_TEST',
                requestId: requestId,
                method: method,
                url: url,
                headers: headers,
                body: body,
                timestamp: timestamp
            }, '*');

            // Store in history (will be updated with result later)
            this.history.unshift({
                requestId: requestId,
                method: method,
                url: url,
                headers: headers,
                body: body,
                timestamp: timestamp,
                pending: true
            });

            this.renderHistory();
        },

        handleResponse: function(msg) {
            console.log('📥 Received API test response:', msg);

            // Update history item
            const historyItem = this.history.find(h => h.requestId === msg.requestId);
            if (historyItem) {
                historyItem.pending = false;
                historyItem.success = msg.success;
                historyItem.status = msg.status;
                historyItem.statusText = msg.statusText;
                historyItem.data = msg.data;
                historyItem.error = msg.error;
                historyItem.duration = msg.duration;
            }

            // Render response
            this.renderResponse(msg);

            // Update history
            this.renderHistory();

            // Re-enable send button
            document.getElementById('send-btn').disabled = false;
        },

        renderResponse: function(msg) {
            const responseArea = document.getElementById('response-area');

            const resultBox = document.createElement('div');
            resultBox.className = 'result-box ' + (msg.success ? 'result-success' : 'result-error');

            const header = document.createElement('div');
            header.className = 'result-header';

            const statusDiv = document.createElement('div');
            statusDiv.className = 'result-status ' + (msg.success ? 'success' : 'error');
            statusDiv.textContent = msg.success
                ? `✅ ${msg.status} ${msg.statusText}`
                : `❌ ${msg.error || 'Request Failed'}`;
            header.appendChild(statusDiv);

            const timeDiv = document.createElement('div');
            timeDiv.className = 'result-time';
            timeDiv.textContent = `${msg.duration}ms`;
            header.appendChild(timeDiv);

            resultBox.appendChild(header);

            const pre = document.createElement('pre');
            if (msg.success) {
                pre.textContent = JSON.stringify(msg.data, null, 2);
            } else {
                pre.textContent = msg.error || 'Unknown error';
                if (msg.corsError) {
                    pre.textContent += '\n\n⚠️ CORS Error: This API does not allow requests from null origin (file://)';
                }
            }
            resultBox.appendChild(pre);

            responseArea.innerHTML = '';
            responseArea.appendChild(resultBox);
        },

        renderHistory: function() {
            const historyArea = document.getElementById('history-area');

            if (this.history.length === 0) {
                historyArea.innerHTML = '<div class="empty-state">No history yet</div>';
                return;
            }

            historyArea.innerHTML = '';

            const list = document.createElement('div');
            list.className = 'history-list';

            this.history.forEach((item, index) => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.dataset.index = index;

                const header = document.createElement('div');
                header.className = 'history-item-header';

                const method = document.createElement('span');
                method.className = 'history-method ' + item.method;
                method.textContent = item.method;
                header.appendChild(method);

                const status = document.createElement('span');
                status.className = 'history-status ' + (item.success ? 'success' : item.pending ? '' : 'error');
                if (item.pending) {
                    status.textContent = '⏳ Pending...';
                } else if (item.success) {
                    status.textContent = `✅ ${item.status}`;
                } else {
                    status.textContent = '❌ Failed';
                }
                header.appendChild(status);

                historyItem.appendChild(header);

                const url = document.createElement('div');
                url.className = 'history-url';
                url.textContent = item.url;
                url.title = item.url;
                historyItem.appendChild(url);

                list.appendChild(historyItem);
            });

            historyArea.appendChild(list);
        },

        loadFromHistory: function(index) {
            const item = this.history[index];
            if (item) {
                document.getElementById('method').value = item.method;
                document.getElementById('url').value = item.url;
                document.getElementById('headers').value = item.headers ? JSON.stringify(item.headers, null, 2) : '';
                document.getElementById('body').value = item.body ? JSON.stringify(item.body, null, 2) : '';

                // Show the response again
                if (!item.pending) {
                    this.renderResponse({
                        requestId: item.requestId,
                        success: item.success,
                        status: item.status,
                        statusText: item.statusText,
                        data: item.data,
                        error: item.error,
                        duration: item.duration,
                        corsError: item.error && item.error.includes('CORS')
                    });
                }
            }
        }
    };

    // Expose to window for testing (both naming conventions for compatibility)
    window.ApiTester = APITester;
    window.APITester = APITester;  // Keep old name for backward compatibility

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => APITester.init());
    } else {
        APITester.init();
    }
})();
