#!/usr/bin/env node
// Deploy ActionBridge updates to all client directories
// Automatically discovers all client-* directories

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = __dirname;
const CLIENTS_DIR = path.join(SOURCE_DIR, 'data/webapps/action_bridge/client-file-system-access-directories');

// Files to distribute
const FILES_TO_DEPLOY = [
    'actionbridge.js',
    'app.js',
    'index.html'
];

function discoverClients() {
    if (!fs.existsSync(CLIENTS_DIR)) {
        console.log('⚠️  Client directories folder not found:', CLIENTS_DIR);
        return [];
    }

    const entries = fs.readdirSync(CLIENTS_DIR, { withFileTypes: true });
    const clients = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith('client'))
        .map(entry => entry.name);

    return clients;
}

function deployToClient(clientName, clientPath) {
    console.log(`📦 Updating ${clientName}...`);

    let successCount = 0;
    let failCount = 0;

    for (const file of FILES_TO_DEPLOY) {
        const sourcePath = path.join(SOURCE_DIR, file);
        const targetPath = path.join(clientPath, file);

        if (!fs.existsSync(sourcePath)) {
            console.log(`  ⚠️  Source file not found: ${file}`);
            failCount++;
            continue;
        }

        try {
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`  ✓ ${file}`);
            successCount++;
        } catch (error) {
            console.log(`  ✗ ${file} - Error: ${error.message}`);
            failCount++;
        }
    }

    return { successCount, failCount };
}

function main() {
    console.log('🚀 Deploying ActionBridge updates...');
    console.log('');

    const clients = discoverClients();

    if (clients.length === 0) {
        console.log('⚠️  No client directories found.');
        console.log('');
        console.log('Expected client directories to match pattern: client-*');
        console.log('In directory:', CLIENTS_DIR);
        process.exit(1);
    }

    console.log(`📋 Found ${clients.length} client(s): ${clients.join(', ')}`);
    console.log('');

    let totalSuccess = 0;
    let totalFail = 0;

    for (const client of clients) {
        const clientPath = path.join(CLIENTS_DIR, client);
        const { successCount, failCount } = deployToClient(client, clientPath);
        totalSuccess += successCount;
        totalFail += failCount;
        console.log('');
    }

    console.log('✅ Deployment complete!');
    console.log(`   ${totalSuccess} file(s) deployed successfully`);
    if (totalFail > 0) {
        console.log(`   ${totalFail} file(s) failed`);
    }
    console.log('');
    console.log('🔄 Next steps:');
    console.log('  1. Reload ActionBridge pages in browsers');
    console.log('  2. Pages will load updated code');
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { discoverClients, deployToClient };
