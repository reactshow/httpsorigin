// Notes App - ActionBridge Data Persistence Demo
// Fully dynamic JavaScript implementation - builds entire UI programmatically

(function() {
    'use strict';

    const NotesApp = {
        notes: [],
        currentNoteId: null,
        editMode: false,
        requestCounter: 0,
        pendingRequests: new Map(),

        init: function() {
            console.log('📝 Notes App initializing...');

            // Build UI dynamically
            this.injectStyles();
            this.buildUI();

            // Setup message listener for responses from ActionBridge
            window.addEventListener('message', this.handleResponse.bind(this));

            // Auto-load notes on startup
            this.loadNotes();

            console.log('✅ Notes App initialized');
        },

        injectStyles: function() {
            const style = document.createElement('style');
            style.textContent = `
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }

                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    min-height: 100vh;
                    padding: 20px;
                    color: #e0e0e0;
                }

                .container {
                    max-width: 900px;
                    margin: 0 auto;
                    background: #1e1e2e;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                    padding: 30px;
                }

                h1 {
                    color: #8b9eff;
                    margin-bottom: 10px;
                    font-size: 28px;
                }

                .subtitle {
                    color: #9ca3af;
                    margin-bottom: 20px;
                    font-size: 14px;
                }

                .status {
                    background: rgba(139, 158, 255, 0.1);
                    border-left: 4px solid #8b9eff;
                    padding: 12px 15px;
                    margin-bottom: 20px;
                    border-radius: 4px;
                    font-size: 13px;
                    color: #d1d5db;
                }

                .status.success {
                    background: rgba(72, 187, 120, 0.1);
                    border-left-color: #48bb78;
                }

                .status.error {
                    background: rgba(245, 101, 101, 0.1);
                    border-left-color: #f56565;
                }

                .main-actions {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 20px;
                }

                .main-actions button {
                    padding: 12px 24px;
                    background: #8b9eff;
                    color: #1a1a2e;
                    border: none;
                    border-radius: 8px;
                    font-size: 15px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .main-actions button:hover {
                    background: #a0aeff;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(139, 158, 255, 0.4);
                }

                .main-actions button.secondary {
                    background: #4a5568;
                    color: #e0e0e0;
                }

                .main-actions button.secondary:hover {
                    background: #5a6678;
                }

                /* Notes List */
                .notes-list {
                    margin-bottom: 20px;
                }

                .notes-list h2 {
                    font-size: 18px;
                    color: #d1d5db;
                    margin-bottom: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .notes-count {
                    font-size: 14px;
                    color: #9ca3af;
                    font-weight: normal;
                }

                .note-item {
                    background: #2a2a3e;
                    border: 1px solid #3a3a4e;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .note-item:hover {
                    background: #343448;
                    border-color: #4a4a5e;
                    transform: translateX(4px);
                }

                .note-item.active {
                    background: rgba(139, 158, 255, 0.15);
                    border-color: #8b9eff;
                }

                .note-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .note-title {
                    font-weight: 600;
                    color: #e0e0e0;
                    font-size: 16px;
                }

                .note-actions {
                    display: flex;
                    gap: 8px;
                }

                .note-actions button {
                    padding: 4px 8px;
                    background: transparent;
                    color: #9ca3af;
                    border: none;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .note-actions button:hover {
                    background: #3a3a4e;
                    color: #d1d5db;
                }

                .note-actions button.delete:hover {
                    background: rgba(245, 101, 101, 0.2);
                    color: #f56565;
                }

                .note-preview {
                    font-size: 13px;
                    color: #9ca3af;
                    line-height: 1.4;
                    max-height: 40px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .note-meta {
                    font-size: 11px;
                    color: #6b7280;
                    margin-top: 8px;
                }

                .empty-state {
                    text-align: center;
                    padding: 40px 20px;
                    color: #9ca3af;
                }

                .empty-state-icon {
                    font-size: 48px;
                    margin-bottom: 16px;
                }

                /* Editor */
                .editor {
                    display: none;
                    margin-bottom: 20px;
                }

                .editor.active {
                    display: block;
                }

                .editor-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }

                .editor-header h2 {
                    font-size: 18px;
                    color: #d1d5db;
                }

                .editor-actions {
                    display: flex;
                    gap: 8px;
                }

                .editor-actions button {
                    padding: 8px 16px;
                    background: #8b9eff;
                    color: #1a1a2e;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .editor-actions button:hover {
                    background: #a0aeff;
                }

                .editor-actions button.cancel {
                    background: #4a5568;
                    color: #e0e0e0;
                }

                .editor-actions button.cancel:hover {
                    background: #5a6678;
                }

                input[type="text"] {
                    width: 100%;
                    padding: 12px 15px;
                    background: #2a2a3e;
                    border: 2px solid #3a3a4e;
                    border-radius: 8px;
                    font-family: inherit;
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 15px;
                    transition: border-color 0.2s;
                    color: #e0e0e0;
                }

                input[type="text"]:focus {
                    outline: none;
                    border-color: #8b9eff;
                }

                textarea {
                    width: 100%;
                    min-height: 250px;
                    padding: 15px;
                    background: #2a2a3e;
                    border: 2px solid #3a3a4e;
                    border-radius: 8px;
                    font-family: inherit;
                    font-size: 15px;
                    resize: vertical;
                    transition: border-color 0.2s;
                    line-height: 1.6;
                    color: #e0e0e0;
                }

                textarea:focus {
                    outline: none;
                    border-color: #8b9eff;
                }

                .info-box {
                    background: #2a2a3e;
                    border: 1px solid #3a3a4e;
                    border-radius: 8px;
                    padding: 15px;
                    font-size: 12px;
                    color: #9ca3af;
                }

                .info-box h3 {
                    color: #d1d5db;
                    margin-bottom: 8px;
                    font-size: 13px;
                }

                .info-box ul {
                    margin-left: 20px;
                    line-height: 1.6;
                }

                #last-saved {
                    font-size: 11px;
                    color: #6b7280;
                    margin-top: 10px;
                }
            `;
            document.head.appendChild(style);
        },

        buildUI: function() {
            // Set document title
            document.title = 'Notes App - ActionBridge Demo';

            // Create main container
            const container = document.createElement('div');
            container.className = 'container';

            // Header
            const header = document.createElement('h1');
            header.textContent = '📝 Notes App';
            container.appendChild(header);

            const subtitle = document.createElement('p');
            subtitle.className = 'subtitle';
            subtitle.textContent = 'ActionBridge Data Persistence Demo - Multiple Notes';
            container.appendChild(subtitle);

            // Status message
            const status = document.createElement('div');
            status.id = 'status';
            status.className = 'status';
            status.textContent = 'Initializing... Loading notes from filesystem.';
            container.appendChild(status);

            // Main actions
            const mainActions = document.createElement('div');
            mainActions.className = 'main-actions';

            const newNoteBtn = document.createElement('button');
            newNoteBtn.id = 'new-note-btn';
            newNoteBtn.textContent = '➕ New Note';
            newNoteBtn.addEventListener('click', () => this.showEditor(null));
            mainActions.appendChild(newNoteBtn);

            const reloadBtn = document.createElement('button');
            reloadBtn.id = 'reload-btn';
            reloadBtn.className = 'secondary';
            reloadBtn.textContent = '🔄 Reload All';
            reloadBtn.addEventListener('click', () => this.loadNotes());
            mainActions.appendChild(reloadBtn);

            container.appendChild(mainActions);

            // Editor (hidden by default)
            const editor = document.createElement('div');
            editor.id = 'editor';
            editor.className = 'editor';

            const editorHeader = document.createElement('div');
            editorHeader.className = 'editor-header';

            const editorModeTitle = document.createElement('h2');
            editorModeTitle.id = 'editor-mode-title';
            editorModeTitle.textContent = 'New Note';
            editorHeader.appendChild(editorModeTitle);

            const editorActions = document.createElement('div');
            editorActions.className = 'editor-actions';

            const saveNoteBtn = document.createElement('button');
            saveNoteBtn.id = 'save-note-btn';
            saveNoteBtn.textContent = '💾 Save';
            saveNoteBtn.addEventListener('click', () => this.saveCurrentNote());
            editorActions.appendChild(saveNoteBtn);

            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancel-btn';
            cancelBtn.className = 'cancel';
            cancelBtn.textContent = '✕ Cancel';
            cancelBtn.addEventListener('click', () => this.hideEditor());
            editorActions.appendChild(cancelBtn);

            editorHeader.appendChild(editorActions);
            editor.appendChild(editorHeader);

            const noteTitleInput = document.createElement('input');
            noteTitleInput.type = 'text';
            noteTitleInput.id = 'note-title';
            noteTitleInput.placeholder = 'Note title...';
            editor.appendChild(noteTitleInput);

            const noteContentTextarea = document.createElement('textarea');
            noteContentTextarea.id = 'note-content';
            noteContentTextarea.placeholder = 'Write your note content here...';
            editor.appendChild(noteContentTextarea);

            container.appendChild(editor);

            // Notes List
            const notesListContainer = document.createElement('div');
            notesListContainer.id = 'notes-list-container';
            notesListContainer.className = 'notes-list';

            const notesListHeader = document.createElement('h2');
            const notesListTitle = document.createElement('span');
            notesListTitle.textContent = 'Your Notes';
            notesListHeader.appendChild(notesListTitle);

            const notesCount = document.createElement('span');
            notesCount.id = 'notes-count';
            notesCount.className = 'notes-count';
            notesCount.textContent = '0 notes';
            notesListHeader.appendChild(notesCount);

            notesListContainer.appendChild(notesListHeader);

            const notesList = document.createElement('div');
            notesList.id = 'notes-list';
            notesListContainer.appendChild(notesList);

            container.appendChild(notesListContainer);

            // Info box
            const infoBox = document.createElement('div');
            infoBox.className = 'info-box';

            const infoTitle = document.createElement('h3');
            infoTitle.textContent = '🔍 How it works:';
            infoBox.appendChild(infoTitle);

            const infoList = document.createElement('ul');
            const infoItems = [
                'Create multiple notes with titles and content',
                'All notes saved to apps/notes_app/data/notes_list.json via ActionBridge',
                'Click a note to edit it, or click "New Note" to create one',
                'Data persists across page reloads using File System Access API'
            ];
            infoItems.forEach(itemText => {
                const li = document.createElement('li');
                li.textContent = itemText;
                infoList.appendChild(li);
            });
            infoBox.appendChild(infoList);

            const lastSaved = document.createElement('div');
            lastSaved.id = 'last-saved';
            infoBox.appendChild(lastSaved);

            container.appendChild(infoBox);

            // Append container to body
            document.body.appendChild(container);
        },

        // Generate unique request ID
        getRequestId: function() {
            return 'notes_' + Date.now() + '_' + (++this.requestCounter);
        },

        // Send request to ActionBridge parent via postMessage
        sendRequest: function(action, data) {
            return new Promise((resolve, reject) => {
                const requestId = this.getRequestId();
                this.pendingRequests.set(requestId, { resolve, reject, timestamp: Date.now() });

                window.parent.postMessage({
                    type: 'AB_REQUEST',
                    action: action,
                    requestId: requestId,
                    data: data
                }, '*');

                console.log('📤 Sent request:', action, requestId);

                setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId);
                        reject(new Error('Request timeout: ' + action));
                    }
                }, 5000);
            });
        },

        // Handle response from ActionBridge
        handleResponse: function(event) {
            const message = event.data;
            if (message.type !== 'AB_RESPONSE') return;

            console.log('📥 Received response:', message);

            const pending = this.pendingRequests.get(message.requestId);
            if (!pending) return;

            this.pendingRequests.delete(message.requestId);

            if (message.success) {
                pending.resolve(message.data);
            } else {
                pending.reject(new Error(message.error || 'Unknown error'));
            }
        },

        // Load all notes from filesystem
        loadNotes: async function() {
            this.setStatus('Loading notes from filesystem...', 'info');

            try {
                const result = await this.sendRequest('LOAD_DATA', {
                    key: 'notes_list',
                    appName: 'notes_app'
                });

                if (result && result.value && Array.isArray(result.value.notes)) {
                    this.notes = result.value.notes;
                    console.log('✅ Loaded', this.notes.length, 'notes');
                    this.setStatus('✅ Loaded ' + this.notes.length + ' notes from filesystem', 'success');
                    this.updateLastSaved(result.updated);
                } else {
                    this.notes = [];
                    console.log('ℹ️ No saved notes found');
                    this.setStatus('ℹ️ No saved notes found. Click "New Note" to create one!', 'info');
                }

                this.renderNotesList();
            } catch (error) {
                console.error('❌ Load failed:', error);
                this.setStatus('❌ Failed to load: ' + error.message, 'error');
                this.notes = [];
                this.renderNotesList();
            }
        },

        // Save all notes to filesystem
        saveAllNotes: async function() {
            try {
                const result = await this.sendRequest('SAVE_DATA', {
                    key: 'notes_list',
                    value: {
                        notes: this.notes,
                        savedAt: new Date().toISOString(),
                        totalNotes: this.notes.length
                    },
                    appName: 'notes_app'
                });

                console.log('✅ All notes saved:', result);
                this.updateLastSaved();
                return true;
            } catch (error) {
                console.error('❌ Save failed:', error);
                this.setStatus('❌ Failed to save: ' + error.message, 'error');
                return false;
            }
        },

        // Show editor for new or existing note
        showEditor: function(noteId) {
            this.currentNoteId = noteId;
            this.editMode = true;

            const editor = document.getElementById('editor');
            const titleInput = document.getElementById('note-title');
            const contentTextarea = document.getElementById('note-content');
            const modeTitle = document.getElementById('editor-mode-title');

            if (noteId) {
                // Edit existing note
                const note = this.notes.find(n => n.id === noteId);
                if (note) {
                    titleInput.value = note.title;
                    contentTextarea.value = note.content;
                    modeTitle.textContent = 'Edit Note';
                }
            } else {
                // New note
                titleInput.value = '';
                contentTextarea.value = '';
                modeTitle.textContent = 'New Note';
            }

            editor.classList.add('active');
            titleInput.focus();
        },

        // Hide editor
        hideEditor: function() {
            this.editMode = false;
            this.currentNoteId = null;
            document.getElementById('editor').classList.remove('active');
        },

        // Save current note being edited
        saveCurrentNote: async function() {
            const titleInput = document.getElementById('note-title');
            const contentTextarea = document.getElementById('note-content');

            const title = titleInput.value.trim();
            const content = contentTextarea.value.trim();

            if (!title) {
                alert('Please enter a note title');
                titleInput.focus();
                return;
            }

            this.setStatus('Saving note...', 'info');

            if (this.currentNoteId) {
                // Update existing note
                const note = this.notes.find(n => n.id === this.currentNoteId);
                if (note) {
                    note.title = title;
                    note.content = content;
                    note.updatedAt = new Date().toISOString();
                }
            } else {
                // Create new note
                const newNote = {
                    id: 'note_' + Date.now(),
                    title: title,
                    content: content,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.notes.unshift(newNote);  // Add to beginning
            }

            const saved = await this.saveAllNotes();
            if (saved) {
                this.setStatus('✅ Note saved successfully!', 'success');
                this.hideEditor();
                this.renderNotesList();
            }
        },

        // Delete a note (no confirm dialog - uses two-step button pattern)
        deleteNote: async function(noteId) {
            console.log('🗑️ deleteNote called with noteId:', noteId);

            this.setStatus('Deleting note...', 'info');

            this.notes = this.notes.filter(n => n.id !== noteId);

            const saved = await this.saveAllNotes();
            if (saved) {
                this.setStatus('✅ Note deleted successfully!', 'success');
                this.renderNotesList();
            }
        },

        // Render the notes list
        renderNotesList: function() {
            const container = document.getElementById('notes-list');
            const countEl = document.getElementById('notes-count');

            countEl.textContent = this.notes.length + ' note' + (this.notes.length !== 1 ? 's' : '');

            if (this.notes.length === 0) {
                container.innerHTML = '';
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';

                const icon = document.createElement('div');
                icon.className = 'empty-state-icon';
                icon.textContent = '📝';
                emptyState.appendChild(icon);

                const text = document.createElement('p');
                text.textContent = 'No notes yet. Click "New Note" to create your first note!';
                emptyState.appendChild(text);

                container.appendChild(emptyState);
                return;
            }

            container.innerHTML = '';
            this.notes.forEach(note => {
                const noteItem = document.createElement('div');
                noteItem.className = 'note-item';
                noteItem.dataset.noteId = note.id;

                const noteHeader = document.createElement('div');
                noteHeader.className = 'note-header';

                const noteTitle = document.createElement('div');
                noteTitle.className = 'note-title';
                noteTitle.textContent = note.title;
                noteHeader.appendChild(noteTitle);

                const noteActions = document.createElement('div');
                noteActions.className = 'note-actions';

                const editBtn = document.createElement('button');
                editBtn.className = 'edit-note';
                editBtn.textContent = '✏️ Edit';
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showEditor(note.id);
                });
                noteActions.appendChild(editBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-note delete';
                deleteBtn.textContent = '🗑️ Delete';
                deleteBtn.dataset.noteId = note.id;
                deleteBtn.dataset.confirmState = 'initial';

                // Two-step delete: First click asks for confirmation, second click deletes
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    if (deleteBtn.dataset.confirmState === 'initial') {
                        // First click - ask for confirmation
                        deleteBtn.textContent = '✓ Confirm?';
                        deleteBtn.style.background = 'rgba(245, 101, 101, 0.3)';
                        deleteBtn.style.color = '#f56565';
                        deleteBtn.dataset.confirmState = 'confirming';

                        // Reset after 3 seconds if no second click
                        const resetTimeout = setTimeout(() => {
                            if (deleteBtn.dataset.confirmState === 'confirming') {
                                deleteBtn.textContent = '🗑️ Delete';
                                deleteBtn.style.background = '';
                                deleteBtn.style.color = '';
                                deleteBtn.dataset.confirmState = 'initial';
                            }
                        }, 3000);

                        // Store timeout ID for cleanup
                        deleteBtn.dataset.resetTimeout = resetTimeout;
                    } else if (deleteBtn.dataset.confirmState === 'confirming') {
                        // Second click - actually delete
                        clearTimeout(parseInt(deleteBtn.dataset.resetTimeout));
                        this.deleteNote(note.id);
                    }
                });
                noteActions.appendChild(deleteBtn);

                noteHeader.appendChild(noteActions);
                noteItem.appendChild(noteHeader);

                const preview = note.content.substring(0, 100);
                const notePreview = document.createElement('div');
                notePreview.className = 'note-preview';
                notePreview.textContent = preview + (note.content.length > 100 ? '...' : '');
                noteItem.appendChild(notePreview);

                const date = new Date(note.updatedAt || note.createdAt);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const noteMeta = document.createElement('div');
                noteMeta.className = 'note-meta';
                noteMeta.textContent = 'Updated: ' + dateStr;
                noteItem.appendChild(noteMeta);

                // Click on note to edit
                noteItem.addEventListener('click', () => {
                    this.showEditor(note.id);
                });

                container.appendChild(noteItem);
            });
        },

        // Update status message
        setStatus: function(message, type) {
            const statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = 'status ' + (type || 'info');
        },

        // Update last saved timestamp
        updateLastSaved: function(timestamp) {
            const el = document.getElementById('last-saved');
            const ts = timestamp || new Date().toISOString();
            el.textContent = '💾 Last saved: ' + new Date(ts).toLocaleString();
        }
    };

    // Auto-initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => NotesApp.init());
    } else {
        NotesApp.init();
    }

    // Expose to window for debugging
    window.NotesApp = NotesApp;
})();
