// ActionBridge Module: Ui Manager
// UI building and updates

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - ui-manager.js must be loaded after actionbridge.js');
        return;
    }

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

    AB.minimizeStatusBar = function() {
        const statusBar = document.getElementById('ab-status-bar');
        statusBar.classList.add('minimized');
        return { minimized: true };
    };

    AB.expandStatusBar = function() {
        const statusBar = document.getElementById('ab-status-bar');
        statusBar.classList.remove('minimized');
        return { minimized: false };
    };

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

})();
