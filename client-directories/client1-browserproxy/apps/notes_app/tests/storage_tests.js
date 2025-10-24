// Notes App - Storage Tests
// Tests for notes_app functionality in the actual running app
// These tests are dynamically loaded by the test_suite app

(function(TestSuite) {
    'use strict';

    // Register tests with the test suite
    const addTest = TestSuite.addTest.bind(TestSuite);
    const sendToActionBridge = TestSuite.sendToActionBridge.bind(TestSuite);
    const loadApp = TestSuite.loadApp.bind(TestSuite);
    const executeJS = TestSuite.executeJS.bind(TestSuite);
    const isAppLoaded = TestSuite.isAppLoaded.bind(TestSuite);

    // Test category name
    const CATEGORY = 'Notes App';

    // Track if we opened the app (to close it after tests)
    let appWasOpenedByTests = false;

    // Setup test: Check if app is open, load if needed
    addTest(CATEGORY, 'Setup: Load notes_app if needed', async () => {
        const alreadyOpen = await isAppLoaded('notes_app');

        if (alreadyOpen) {
            console.log('📱 Notes app already open - will leave it open after tests');
            appWasOpenedByTests = false;
        } else {
            console.log('📱 Loading notes_app for testing...');
            const iframeId = await loadApp('notes_app');
            console.log(`✓ Notes app loaded in ${iframeId}`);
            // Wait for app to initialize
            await new Promise(resolve => setTimeout(resolve, 2000));
            appWasOpenedByTests = true;
        }

        // Verify app is now accessible
        const isOpen = await isAppLoaded('notes_app');
        if (!isOpen) {
            throw new Error('Failed to load notes_app');
        }
    });

    addTest(CATEGORY, 'Create note in app', async () => {
        // Create a test note in the actual running app
        const response = await executeJS(`
            const testNote = {
                id: 'test_note_' + Date.now(),
                title: 'Test Note from Test Suite',
                content: 'This is a test note created to verify notes_app functionality.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Add note to the app
            window.NotesApp.notes.unshift(testNote);

            // Save and render
            await window.NotesApp.saveAllNotes();
            window.NotesApp.renderNotesList();

            return {
                noteId: testNote.id,
                noteCount: window.NotesApp.notes.length
            };
        `, 'notes_app', 5000);

        const result = response.result;
        if (!result || !result.noteId) {
            throw new Error('Failed to create note in app');
        }

        // Store for later tests
        window.__testNoteId = result.noteId;

        console.log(`✓ Created note ${result.noteId}, total notes: ${result.noteCount}`);
    });

    addTest(CATEGORY, 'Verify note appears in app', async () => {
        // Check if note appears in the app's notes array
        const testNoteId = window.__testNoteId;
        const response = await executeJS(`
            const testNote = window.NotesApp.notes.find(n => n.id === '${testNoteId}');

            if (!testNote) {
                throw new Error('Test note not found in app');
            }

            return {
                found: true,
                title: testNote.title,
                content: testNote.content,
                totalNotes: window.NotesApp.notes.length
            };
        `, 'notes_app', 5000);

        const result = response.result;
        if (!result || !result.found) {
            throw new Error('Test note not found in app');
        }

        if (result.title !== 'Test Note from Test Suite') {
            throw new Error(`Expected title 'Test Note from Test Suite', got '${result.title}'`);
        }

        console.log(`✓ Note found in app with ${result.totalNotes} total notes`);
    });

    addTest(CATEGORY, 'Update note in app', async () => {
        // Update the test note in the actual running app
        const testNoteId = window.__testNoteId;
        const response = await executeJS(`
            const testNote = window.NotesApp.notes.find(n => n.id === '${testNoteId}');

            if (!testNote) {
                throw new Error('Test note not found for update');
            }

            // Update the note
            testNote.title = 'Updated Test Note';
            testNote.content = 'This content has been updated.';
            testNote.updatedAt = new Date().toISOString();

            // Save and render
            await window.NotesApp.saveAllNotes();
            window.NotesApp.renderNotesList();

            return {
                updated: true,
                newTitle: testNote.title
            };
        `, 'notes_app', 5000);

        const result = response.result;
        if (!result || !result.updated) {
            throw new Error('Failed to update note');
        }

        if (result.newTitle !== 'Updated Test Note') {
            throw new Error('Note title was not updated');
        }

        console.log(`✓ Note updated successfully`);
    });

    addTest(CATEGORY, 'Add another note in app', async () => {
        // Get initial count and add another note
        const response = await executeJS(`
            const initialCount = window.NotesApp.notes.length;

            const secondNote = {
                id: 'test_note_2_' + Date.now(),
                title: 'Second Test Note',
                content: 'Another test note.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Add note to the app
            window.NotesApp.notes.unshift(secondNote);

            // Save and render
            await window.NotesApp.saveAllNotes();
            window.NotesApp.renderNotesList();

            return {
                initialCount: initialCount,
                newCount: window.NotesApp.notes.length,
                secondNoteId: secondNote.id
            };
        `, 'notes_app', 5000);

        const result = response.result;
        if (!result || result.newCount !== result.initialCount + 1) {
            throw new Error(`Expected ${result.initialCount + 1} notes, got ${result.newCount}`);
        }

        window.__testNoteId2 = result.secondNoteId;
        console.log(`✓ Added second note, total: ${result.newCount}`);
    });

    addTest(CATEGORY, 'Delete test notes from app', async () => {
        // Delete all test notes from the app
        const testNoteId = window.__testNoteId;
        const testNoteId2 = window.__testNoteId2;
        const response = await executeJS(`
            const noteIds = ['${testNoteId}', '${testNoteId2}'];

            // Remove test notes
            window.NotesApp.notes = window.NotesApp.notes.filter(
                note => !noteIds.includes(note.id)
            );

            // Save and render
            await window.NotesApp.saveAllNotes();
            window.NotesApp.renderNotesList();

            return {
                remainingCount: window.NotesApp.notes.length,
                deleted: true
            };
        `, 'notes_app', 5000);

        const result = response.result;
        if (!result || !result.deleted) {
            throw new Error('Failed to delete test notes');
        }

        console.log(`✓ Deleted test notes, ${result.remainingCount} notes remaining`);
    });

    addTest(CATEGORY, 'Verify app persistence', async () => {
        // Reload notes in the app and verify they persisted
        const testNoteId = window.__testNoteId;
        const testNoteId2 = window.__testNoteId2;
        const response = await executeJS(`
            // Reload notes from storage
            await window.NotesApp.loadNotes();
            window.NotesApp.renderNotesList();

            // Verify test notes are gone
            const testNoteIds = ['${testNoteId}', '${testNoteId2}'];
            const hasTestNotes = window.NotesApp.notes.some(
                note => testNoteIds.includes(note.id)
            );

            return {
                hasTestNotes: hasTestNotes,
                noteCount: window.NotesApp.notes.length
            };
        `, 'notes_app', 5000);

        const result = response.result;
        if (result.hasTestNotes) {
            throw new Error('Test notes still present after deletion');
        }

        console.log(`✓ Persistence verified, ${result.noteCount} notes in storage`);
    });

    // Cleanup test: Close app if we opened it
    addTest(CATEGORY, 'Cleanup: Close app if opened by tests', async () => {
        if (appWasOpenedByTests) {
            console.log('📱 Notes app was opened by tests - should close it');
            console.log('⚠️  Note: ActionBridge close iframe API not yet implemented');
            console.log('    For now, manually close iframe_1 if needed');
        } else {
            console.log('📱 Leaving notes_app open (was already open before tests)');
        }
    });

})(window.TestSuite);
