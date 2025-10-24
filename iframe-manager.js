// ActionBridge Module: Iframe Manager
// Iframe lifecycle management

(function() {
    'use strict';

    const AB = window.ActionBridge;
    if (!AB) {
        console.error('ActionBridge not found - iframe-manager.js must be loaded after actionbridge.js');
        return;
    }

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

    AB.ensureEmptyIframe = function() {
        // Check if there's at least one iframe without an app loaded
        const hasEmptyIframe = Object.values(AB.iframes).some(iframe => !iframe.currentApp);

        if (!hasEmptyIframe) {
            console.log('📦 Auto-creating empty iframe');
            AB.createIframe();
        }
    };

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

})();
