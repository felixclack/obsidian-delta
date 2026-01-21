import { App, Plugin, Notice, Modal, Setting, MarkdownView, PluginSettingTab, TFile, Editor, Menu } from 'obsidian';

interface DeltaSettings {
	defaultInterval: number;
	defaultMultiplier: number;
	deltaTag: string;
	dateFormat: string;
	autoInsertOnDailyNote: boolean;
	dailyNotesFolder: string;
	dailyNoteFormat: string;
}

interface DeltaTag {
	interval: number;
	multiplier: number;
	dueDate: string;
	fullMatch: string;
}

interface DueItem {
	file: TFile;
	line: number;
	content: string;
	blockId: string | null;
	delta: DeltaTag;
	originalLine: string;
}

const DEFAULT_SETTINGS: DeltaSettings = {
	defaultInterval: 1,
	defaultMultiplier: 2,
	deltaTag: 'delta',
	dateFormat: 'YYYY-MM-DD',
	autoInsertOnDailyNote: true,
	dailyNotesFolder: 'journals',
	dailyNoteFormat: 'YYYY_MM_DD'
};

export default class DeltaPlugin extends Plugin {
	settings: DeltaSettings;

	async onload() {
		await this.loadSettings();

		// Command: Send block to tomorrow (quick delta)
		this.addCommand({
			id: 'delta-send-tomorrow',
			name: 'Send block to tomorrow',
			editorCallback: (editor: Editor) => {
				this.sendBlockForward(editor, 1);
			},
			hotkeys: [{ modifiers: ['Alt'], key: 'Enter' }]
		});

		// Command: Send block with custom interval
		this.addCommand({
			id: 'delta-send-custom',
			name: 'Send block to future date...',
			editorCallback: (editor: Editor) => {
				new DeltaIntervalModal(this.app, (days: number) => {
					this.sendBlockForward(editor, days);
				}).open();
			}
		});

		// Command: Resurface block (increment interval)
		this.addCommand({
			id: 'delta-resurface',
			name: 'Resurface this block again',
			editorCallback: (editor: Editor) => {
				this.resurfaceBlock(editor);
			}
		});

		// Command: Mark delta as done (remove tag)
		this.addCommand({
			id: 'delta-done',
			name: 'Mark as done (remove tag)',
			editorCallback: (editor: Editor) => {
				this.markAsDone(editor);
			}
		});

		// Command: Show items due today
		this.addCommand({
			id: 'delta-show-due',
			name: 'Show items due today',
			callback: () => {
				this.showDueItems();
			}
		});

		// Command: Insert due items into current note
		this.addCommand({
			id: 'delta-insert-due',
			name: 'Insert due items here',
			editorCallback: (editor: Editor) => {
				this.insertDueItems(editor);
			}
		});

		// Register editor menu item
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				const clickedLine = editor.getCursor().line;

				menu.addItem((item) => {
					item
						.setTitle('Δ Send to tomorrow')
						.setIcon('clock')
						.onClick(() => {
							this.sendBlockForwardAtLine(editor, 1, clickedLine);
						});
				});
				menu.addItem((item) => {
					item
						.setTitle('Δ Send to future...')
						.setIcon('calendar-plus')
						.onClick(() => {
							new DeltaIntervalModal(this.app, (days: number) => {
								this.sendBlockForwardAtLine(editor, days, clickedLine);
							}).open();
						});
				});

				// Check if line has delta tag
				const lineContent = editor.getLine(clickedLine);
				if (this.parseDeltaTag(lineContent)) {
					menu.addItem((item) => {
						item
							.setTitle('Δ Mark as done')
							.setIcon('check')
							.onClick(() => {
								this.markAsDoneAtLine(editor, clickedLine);
							});
					});
					menu.addItem((item) => {
						item
							.setTitle('Δ Resurface again')
							.setIcon('rotate-cw')
							.onClick(() => {
								this.resurfaceBlockAtLine(editor, clickedLine);
							});
					});
				}
			})
		);

		// Register markdown post processor for styling delta tags
		this.registerMarkdownPostProcessor((element) => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			const textNodes: Text[] = [];

			while (walker.nextNode()) {
				textNodes.push(walker.currentNode as Text);
			}

			textNodes.forEach(node => {
				const text = node.textContent || '';
				const deltaRegex = /\{\{delta:(\d+)\+(\d+)\s+(\d{4}-\d{2}-\d{2})\}\}/g;

				if (deltaRegex.test(text)) {
					const span = document.createElement('span');
					span.innerHTML = text.replace(deltaRegex, (match, interval, mult, date) => {
						const isOverdue = date <= this.formatDate(new Date());
						const className = isOverdue ? 'delta-tag delta-overdue' : 'delta-tag';
						return `<span class="${className}" title="Resurface: ${date}, Interval: ${interval}d, Multiplier: ${mult}x">Δ ${date}</span>`;
					});
					node.parentNode?.replaceChild(span, node);
				}
			});
		});

		// Auto-insert due items when opening a daily note
		if (this.settings.autoInsertOnDailyNote) {
			this.registerEvent(
				this.app.workspace.on('file-open', async (file: TFile | null) => {
					if (file && this.isDailyNote(file)) {
						await this.autoInsertDueItems(file);
					}
				})
			);
		}

		// Add settings tab
		this.addSettingTab(new DeltaSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Check if file is a daily note
	isDailyNote(file: TFile): boolean {
		const folder = this.settings.dailyNotesFolder;
		if (!file.path.startsWith(folder + '/')) return false;

		// Check if filename matches daily note format
		const basename = file.basename;

		// Simple check: does it look like a date?
		return /^\d{4}[_-]\d{2}[_-]\d{2}$/.test(basename);
	}

	// Check if today's daily note
	isTodaysDailyNote(file: TFile): boolean {
		if (!this.isDailyNote(file)) return false;

		const today = this.formatDate(new Date()).replace(/-/g, '_');
		return file.basename === today;
	}

	// Get current line content
	getCurrentLine(editor: Editor): { line: number; content: string } {
		const cursor = editor.getCursor();
		return {
			line: cursor.line,
			content: editor.getLine(cursor.line)
		};
	}

	// Format date as YYYY-MM-DD
	formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	// Parse delta tag from line
	parseDeltaTag(content: string): DeltaTag | null {
		const match = content.match(/\{\{delta:(\d+)(?:\+(\d+))?\s+(\d{4}-\d{2}-\d{2})\}\}/);
		if (match) {
			return {
				interval: parseInt(match[1]),
				multiplier: match[2] ? parseInt(match[2]) : this.settings.defaultMultiplier,
				dueDate: match[3],
				fullMatch: match[0]
			};
		}
		return null;
	}

	// Parse or create block ID
	getOrCreateBlockId(content: string): { content: string; blockId: string; isNew: boolean } {
		// Check for existing block ID
		const blockIdMatch = content.match(/\s+\^([a-zA-Z0-9]+)\s*$/);
		if (blockIdMatch) {
			return { content, blockId: blockIdMatch[1], isNew: false };
		}

		// Create new block ID
		const blockId = this.generateBlockId();
		const newContent = content.trimEnd() + ` ^${blockId}`;
		return { content: newContent, blockId, isNew: true };
	}

	// Generate random block ID
	generateBlockId(): string {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let id = '';
		for (let i = 0; i < 6; i++) {
			id += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return id;
	}

	// Create delta tag
	createDeltaTag(interval: number, multiplier: number, dueDate: string): string {
		return `{{delta:${interval}+${multiplier} ${dueDate}}}`;
	}

	// Send block forward by N days (uses cursor position)
	sendBlockForward(editor: Editor, days: number) {
		const { line } = this.getCurrentLine(editor);
		this.sendBlockForwardAtLine(editor, days, line);
	}

	// Send block forward by N days at a specific line
	sendBlockForwardAtLine(editor: Editor, days: number, lineNum: number) {
		let content = editor.getLine(lineNum);

		// Calculate future date
		const futureDate = new Date();
		futureDate.setDate(futureDate.getDate() + days);
		const dueDateStr = this.formatDate(futureDate);

		// Ensure block has an ID for referencing
		const { content: contentWithId, isNew } = this.getOrCreateBlockId(content);
		if (isNew) {
			content = contentWithId;
		}

		// Check if line already has delta tag
		const existingDelta = this.parseDeltaTag(content);

		let newContent;
		if (existingDelta) {
			// Update existing delta tag
			newContent = content.replace(
				existingDelta.fullMatch,
				this.createDeltaTag(days, existingDelta.multiplier, dueDateStr)
			);
		} else {
			// Add new delta tag before block ID (if present)
			const blockIdMatch = content.match(/(\s+\^[a-zA-Z0-9]+)\s*$/);
			const tag = this.createDeltaTag(days, this.settings.defaultMultiplier, dueDateStr);

			if (blockIdMatch) {
				newContent = content.replace(blockIdMatch[0], ' ' + tag + blockIdMatch[0]);
			} else {
				newContent = content.trimEnd() + ' ' + tag;
			}
		}

		editor.setLine(lineNum, newContent);
		new Notice(`Δ Block will resurface on ${dueDateStr}`);
	}

	// Resurface block with increased interval
	resurfaceBlock(editor: Editor) {
		const { line } = this.getCurrentLine(editor);
		this.resurfaceBlockAtLine(editor, line);
	}

	// Resurface block at specific line
	resurfaceBlockAtLine(editor: Editor, lineNum: number) {
		const content = editor.getLine(lineNum);
		const delta = this.parseDeltaTag(content);

		if (!delta) {
			new Notice('No delta tag found on this line. Use "Send to tomorrow" first.');
			return;
		}

		// Calculate new interval (current * multiplier)
		const newInterval = delta.interval * delta.multiplier;

		// Calculate new due date
		const futureDate = new Date();
		futureDate.setDate(futureDate.getDate() + newInterval);
		const dueDateStr = this.formatDate(futureDate);

		// Update the tag
		const newContent = content.replace(
			delta.fullMatch,
			this.createDeltaTag(newInterval, delta.multiplier, dueDateStr)
		);

		editor.setLine(lineNum, newContent);
		new Notice(`Δ Block will resurface on ${dueDateStr} (interval: ${newInterval} days)`);
	}

	// Mark delta as done (remove tag)
	markAsDone(editor: Editor) {
		const { line } = this.getCurrentLine(editor);
		this.markAsDoneAtLine(editor, line);
	}

	// Mark delta as done at specific line
	markAsDoneAtLine(editor: Editor, lineNum: number) {
		const content = editor.getLine(lineNum);
		const delta = this.parseDeltaTag(content);

		if (!delta) {
			new Notice('No delta tag found on this line.');
			return;
		}

		// Remove the delta tag
		const newContent = content.replace(delta.fullMatch, '').replace(/\s+$/, '');
		editor.setLine(lineNum, newContent);
		new Notice('Δ Item marked as done');
	}

	// Find all items due today or earlier
	async findDueItems(): Promise<DueItem[]> {
		const today = this.formatDate(new Date());
		const dueItems: DueItem[] = [];

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');

			lines.forEach((line, index) => {
				const delta = this.parseDeltaTag(line);
				if (delta && delta.dueDate <= today) {
					// Skip completed items (marked with [x] or ✅)
					if (line.includes('[x]') || line.includes('✅')) {
						return;
					}

					// Extract block ID if present
					const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)\s*$/);
					const blockId = blockIdMatch ? blockIdMatch[1] : null;

					// Clean content (remove delta tag and block ID for display)
					let cleanContent = line.replace(delta.fullMatch, '').trim();
					if (blockId) {
						cleanContent = cleanContent.replace(/\s*\^[a-zA-Z0-9]+\s*$/, '').trim();
					}

					dueItems.push({
						file: file,
						line: index,
						content: cleanContent,
						blockId: blockId,
						delta: delta,
						originalLine: line
					});
				}
			});
		}

		return dueItems;
	}

	// Show modal with due items
	async showDueItems() {
		const dueItems = await this.findDueItems();

		if (dueItems.length === 0) {
			new Notice('No delta items due today!');
			return;
		}

		new DueItemsModal(this.app, dueItems, this).open();
	}

	// Insert due items at cursor
	async insertDueItems(editor: Editor) {
		const dueItems = await this.findDueItems();

		if (dueItems.length === 0) {
			new Notice('No delta items due today!');
			return;
		}

		const cursor = editor.getCursor();
		const lines = dueItems.map(item => {
			// Create block reference if we have a block ID
			if (item.blockId) {
				return `* ![[${item.file.basename}#^${item.blockId}]]`;
			} else {
				return `* ${item.content} — from [[${item.file.basename}]]`;
			}
		});

		const text = '* **Δ Items Due Today**\n' + lines.map(l => '\t' + l).join('\n');
		editor.replaceRange(text + '\n', cursor);

		new Notice(`Inserted ${dueItems.length} delta items`);
	}

	// Auto-insert due items into daily note if not already present
	async autoInsertDueItems(file: TFile) {
		// Only run on today's daily note
		if (!this.isTodaysDailyNote(file)) return;

		const content = await this.app.vault.read(file);

		// Check if we've already inserted delta items today
		if (content.includes('**Δ Items Due Today**') || content.includes('**Δ Due Today**')) {
			return;
		}

		const dueItems = await this.findDueItems();

		// Filter out items from the current file to avoid self-reference
		const externalItems = dueItems.filter(item => item.file.path !== file.path);

		if (externalItems.length === 0) return;

		// Build the delta section
		const lines = externalItems.map(item => {
			if (item.blockId) {
				return `\t* ![[${item.file.basename}#^${item.blockId}]]`;
			} else {
				return `\t* ${item.content} — from [[${item.file.basename}]]`;
			}
		});

		const deltaSection = `* **Δ Due Today** (${externalItems.length} items)\n${lines.join('\n')}\n`;

		// Insert at the beginning of the file (after any frontmatter)
		let insertPosition = 0;
		if (content.startsWith('---')) {
			const endOfFrontmatter = content.indexOf('---', 3);
			if (endOfFrontmatter !== -1) {
				insertPosition = endOfFrontmatter + 4;
			}
		}

		const newContent = content.slice(0, insertPosition) + deltaSection + content.slice(insertPosition);
		await this.app.vault.modify(file, newContent);

		// IMPORTANT: Remove delta tags from source items after surfacing
		// This prevents the same items from appearing every day
		await this.clearSurfacedDeltaTags(externalItems);

		new Notice(`Δ ${externalItems.length} items due today`);
	}

	// Remove delta tags from items that have been surfaced in the daily note
	async clearSurfacedDeltaTags(items: DueItem[]) {
		// Group items by file to minimize file operations
		const itemsByFile = new Map<string, DueItem[]>();
		for (const item of items) {
			if (!itemsByFile.has(item.file.path)) {
				itemsByFile.set(item.file.path, []);
			}
			itemsByFile.get(item.file.path)!.push(item);
		}

		// Process each file once
		for (const [filePath, fileItems] of itemsByFile) {
			const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
			if (!file) continue;

			let content = await this.app.vault.read(file);
			let modified = false;

			// Sort by line number descending so we don't invalidate line numbers
			fileItems.sort((a, b) => b.line - a.line);

			const lines = content.split('\n');
			for (const item of fileItems) {
				if (item.line < lines.length) {
					const line = lines[item.line];
					const delta = this.parseDeltaTag(line);
					if (delta) {
						// Remove the delta tag but keep the rest of the line
						lines[item.line] = line.replace(delta.fullMatch, '').replace(/\s+$/, '');
						modified = true;
					}
				}
			}

			if (modified) {
				await this.app.vault.modify(file, lines.join('\n'));
			}
		}
	}
}

// Modal for custom interval input
class DeltaIntervalModal extends Modal {
	onSubmit: (days: number) => void;
	days: number;

	constructor(app: App, onSubmit: (days: number) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.days = 1;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Δ Send to future' });

		new Setting(contentEl)
			.setName('Days from now')
			.addText(text => {
				text
					.setPlaceholder('1')
					.setValue('1')
					.onChange(value => {
						this.days = parseInt(value) || 1;
					});
				text.inputEl.focus();
				text.inputEl.select();
			});

		// Quick buttons for common intervals
		const buttonContainer = contentEl.createDiv({ cls: 'delta-quick-buttons' });
		[1, 2, 3, 7, 14, 30].forEach(days => {
			const btn = buttonContainer.createEl('button', {
				text: days === 1 ? '1 day' : days === 7 ? '1 week' : days === 14 ? '2 weeks' : days === 30 ? '1 month' : `${days} days`
			});
			btn.onclick = () => {
				this.close();
				this.onSubmit(days);
			};
		});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Send')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.days);
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Modal showing due items
class DueItemsModal extends Modal {
	items: DueItem[];
	plugin: DeltaPlugin;

	constructor(app: App, items: DueItem[], plugin: DeltaPlugin) {
		super(app);
		this.items = items;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('delta-due-modal');
		contentEl.createEl('h3', { text: `Δ Items Due Today (${this.items.length})` });

		const list = contentEl.createEl('ul', { cls: 'delta-due-list' });

		this.items.forEach(item => {
			const li = list.createEl('li', { cls: 'delta-due-item' });

			const contentSpan = li.createEl('span', { cls: 'delta-due-content' });
			contentSpan.setText(item.content);

			const sourceSpan = li.createEl('small', { cls: 'delta-due-source' });
			sourceSpan.setText(` — ${item.file.basename}`);

			// Make source clickable
			sourceSpan.style.cursor = 'pointer';
			sourceSpan.onclick = async () => {
				await this.app.workspace.openLinkText(item.file.path, '');
				this.close();
			};

			const buttonContainer = li.createEl('div', { cls: 'delta-due-buttons' });

			// Done button
			const doneBtn = buttonContainer.createEl('button', { text: '✓ Done', cls: 'delta-btn-done' });
			doneBtn.onclick = async () => {
				await this.markItemDone(item);
				li.remove();
				this.checkEmpty(list);
			};

			// Resurface button
			const resurfaceBtn = buttonContainer.createEl('button', { text: '↻ Resurface', cls: 'delta-btn-resurface' });
			resurfaceBtn.onclick = async () => {
				await this.resurfaceItem(item);
				li.remove();
				this.checkEmpty(list);
			};

			// Open button
			const openBtn = buttonContainer.createEl('button', { text: '→ Open', cls: 'delta-btn-open' });
			openBtn.onclick = async () => {
				await this.app.workspace.openLinkText(item.file.path, '');
				this.close();
			};
		});
	}

	checkEmpty(list: HTMLUListElement) {
		if (list.children.length === 0) {
			this.close();
			new Notice('All delta items processed!');
		}
	}

	async markItemDone(item: DueItem) {
		const content = await this.app.vault.read(item.file);
		const lines = content.split('\n');

		// Remove the delta tag from the line
		lines[item.line] = lines[item.line].replace(item.delta.fullMatch, '').replace(/\s+$/, '');

		await this.app.vault.modify(item.file, lines.join('\n'));
		new Notice('Δ Item marked as done');
	}

	async resurfaceItem(item: DueItem) {
		const content = await this.app.vault.read(item.file);
		const lines = content.split('\n');

		const newInterval = item.delta.interval * item.delta.multiplier;
		const futureDate = new Date();
		futureDate.setDate(futureDate.getDate() + newInterval);
		const dueDateStr = this.plugin.formatDate(futureDate);

		lines[item.line] = lines[item.line].replace(
			item.delta.fullMatch,
			this.plugin.createDeltaTag(newInterval, item.delta.multiplier, dueDateStr)
		);

		await this.app.vault.modify(item.file, lines.join('\n'));
		new Notice(`Δ Resurfacing in ${newInterval} days (${dueDateStr})`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Settings tab
class DeltaSettingTab extends PluginSettingTab {
	plugin: DeltaPlugin;

	constructor(app: App, plugin: DeltaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Delta Settings' });

		new Setting(containerEl)
			.setName('Default interval')
			.setDesc('Days until first resurface')
			.addText(text => text
				.setPlaceholder('1')
				.setValue(String(this.plugin.settings.defaultInterval))
				.onChange(async (value) => {
					this.plugin.settings.defaultInterval = parseInt(value) || 1;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default multiplier')
			.setDesc('Multiply interval by this each resurface (e.g., 2 = 1→2→4→8 days)')
			.addText(text => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.defaultMultiplier))
				.onChange(async (value) => {
					this.plugin.settings.defaultMultiplier = parseInt(value) || 2;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Daily Notes Integration' });

		new Setting(containerEl)
			.setName('Auto-insert due items')
			.setDesc('Automatically insert due items when opening today\'s daily note')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoInsertOnDailyNote)
				.onChange(async (value) => {
					this.plugin.settings.autoInsertOnDailyNote = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Daily notes folder')
			.setDesc('Folder containing your daily notes')
			.addText(text => text
				.setPlaceholder('journals')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Daily note format')
			.setDesc('Filename format for daily notes (without .md)')
			.addText(text => text
				.setPlaceholder('YYYY_MM_DD')
				.setValue(this.plugin.settings.dailyNoteFormat)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFormat = value;
					await this.plugin.saveSettings();
				}));
	}
}
