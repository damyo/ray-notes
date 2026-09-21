import {
  App,
  Editor,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  WorkspaceWindow,
  normalizePath,
  setIcon
} from "obsidian";
import { safeFileName, titleFromFirstLine } from "./title";

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RayNotesSettings {
  folder: string;
  alwaysOnTop: boolean;
  minimizeMainWindow: boolean;
  lastFile: string;
  bounds: WindowBounds;
}

const DEFAULT_SETTINGS: RayNotesSettings = {
  folder: "Ray Notes",
  alwaysOnTop: true,
  minimizeMainWindow: true,
  lastFile: "",
  bounds: { x: 120, y: 120, width: 620, height: 520 }
};

type ElectronWindow = {
  setAlwaysOnTop(value: boolean, level?: string): void;
  setWindowButtonPosition?(position: { x: number; y: number } | null): void;
  minimize(): void;
  on(name: "close", listener: (event: { preventDefault(): void }) => void): void;
  off(name: "close", listener: (event: { preventDefault(): void }) => void): void;
};

type ElectronApp = {
  on(name: "before-quit", listener: () => void): void;
  off(name: "before-quit", listener: () => void): void;
};

type ElectronBridgeWindow = Window & {
  require?: (module: "electron") => {
    remote?: { app: ElectronApp; getCurrentWindow(): ElectronWindow };
  };
};

class NoteSwitcher extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly folder: string,
    private readonly choose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Search notes...");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path.slice(this.folder.length + 1, -file.extension.length - 1);
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

export default class RayNotesPlugin extends Plugin {
  settings: RayNotesSettings = DEFAULT_SETTINGS;
  private leaf: WorkspaceLeaf | null = null;
  private popout: WorkspaceWindow | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private saveBoundsTimer: number | null = null;
  private renameTimer: number | null = null;
  private titleEl: HTMLElement | null = null;
  private mainWindow: ElectronWindow | null = null;
  private electronApp: ElectronApp | null = null;
  private quitting = false;
  private readonly handleMainWindowClose = (event: { preventDefault(): void }): void => {
    if (!this.leaf || this.quitting) return;
    event.preventDefault();
    this.mainWindow?.minimize();
    this.popout?.win.focus();
  };
  private readonly handleBeforeQuit = (): void => {
    this.quitting = true;
    this.leaf?.detach();
  };

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.closeLegacyPopout();
    this.connectElectronLifecycle();

    this.addCommand({
      id: "open-ray-notes",
      name: "Open notes window",
      callback: () => this.openWindow()
    });

    this.addRibbonIcon("notebook-pen", "Open Ray Notes", () => this.openWindow());
    this.registerObsidianProtocolHandler("ray-notes", () => this.openWindow());
    this.addSettingTab(new RayNotesSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        if (info !== this.leaf?.view) return;
        this.updateDerivedTitle(editor);
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (workspaceWindow) => {
        if (workspaceWindow !== this.popout) return;
        this.captureBounds();
        this.leaf = null;
        this.popout = null;
        this.titleEl = null;
      })
    );
  }

  onunload(): void {
    this.captureBounds();
    if (this.popout) this.setAlwaysOnTop(this.popout.win, false);
    this.popout?.doc.body.removeClass("ray-notes-window");
    this.leaf?.detach();
    this.mainWindow?.off("close", this.handleMainWindowClose);
    this.electronApp?.off("before-quit", this.handleBeforeQuit);
  }

  async openWindow(): Promise<void> {
    if (this.leaf && this.popout) {
      this.popout.win.focus();
      this.focusEditor();
      return;
    }

    try {
      await this.ensureFolder();
      if (this.settings.minimizeMainWindow) this.mainWindow?.minimize();
      this.leaf = this.app.workspace.openPopoutLeaf({
        x: this.settings.bounds.x,
        y: this.settings.bounds.y,
        size: {
          width: this.settings.bounds.width,
          height: this.settings.bounds.height
        }
      });
      this.popout = this.leaf.getContainer() as WorkspaceWindow;
      this.prepareWindow(this.popout);

      const file = this.getInitialFile() ?? (await this.createNote());
      await this.openFile(file);
      this.popout.win.focus();
      this.focusEditor();
    } catch (error) {
      this.leaf?.detach();
      this.leaf = null;
      this.popout = null;
      new Notice(`Ray Notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private prepareWindow(popout: WorkspaceWindow): void {
    const { win, doc } = popout;
    doc.body.addClass("ray-notes-window");
    doc.title = "Ray Notes";
    this.createChrome(doc);
    this.setAlwaysOnTop(win, this.settings.alwaysOnTop);

    this.registerDomEvent(win, "keydown", (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.openSwitcher();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        void this.createAndOpenNote();
      } else if (event.key === "[") {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        void this.navigate(-1);
      } else if (event.key === "]") {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        void this.navigate(1);
      }
    }, true);

    this.registerDomEvent(win, "resize", () => this.scheduleBoundsSave());
    this.registerDomEvent(win, "beforeunload", () => this.captureBounds());
  }

  private connectElectronLifecycle(): void {
    try {
      const electron = (window as ElectronBridgeWindow).require?.("electron");
      if (!electron?.remote) return;
      this.mainWindow = electron.remote.getCurrentWindow();
      this.electronApp = electron.remote.app;
      this.mainWindow.on("close", this.handleMainWindowClose);
      this.electronApp.on("before-quit", this.handleBeforeQuit);
    } catch (error) {
      console.warn("Ray Notes could not connect Electron window lifecycle", error);
    }
  }

  private closeLegacyPopout(): void {
    if (!this.settings.lastFile) return;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.getContainer() instanceof WorkspaceWindow)) continue;
      if (leaf.getViewState().state?.file === this.settings.lastFile) leaf.detach();
    }
  }

  private createChrome(doc: Document): void {
    const top = doc.createElement("div");
    top.className = "ray-notes-toolbar ray-notes-toolbar-top";

    this.titleEl = doc.createElement("div");
    this.titleEl.className = "ray-notes-title";
    this.titleEl.textContent = "Untitled";
    top.append(this.titleEl);

    const topActions = doc.createElement("div");
    topActions.className = "ray-notes-toolbar-actions";
    this.addToolbarButton(topActions, "command", "Commands", () => this.openSwitcher());
    this.addToolbarButton(topActions, "notebook-tabs", "Switch note", () => this.openSwitcher());
    this.addToolbarButton(topActions, "plus", "New note", () => void this.createAndOpenNote());
    top.append(topActions);

    const bottom = doc.createElement("div");
    bottom.className = "ray-notes-toolbar ray-notes-toolbar-bottom";
    this.addToolbarButton(bottom, "heading-1", "Heading", () => this.prefixLine("# "));
    this.addToolbarButton(bottom, "bold", "Bold", () => this.wrapSelection("**"));
    this.addToolbarButton(bottom, "italic", "Italic", () => this.wrapSelection("*"));
    this.addToolbarButton(bottom, "strikethrough", "Strikethrough", () => this.wrapSelection("~~"));
    this.addToolbarButton(bottom, "underline", "Underline", () => this.wrapSelection("<u>", "</u>"));
    this.addToolbarButton(bottom, "code-xml", "Inline code", () => this.wrapSelection("`"));
    this.addToolbarButton(bottom, "link", "Link", () => this.insertLink());
    this.addToolbarButton(bottom, "text-quote", "Quote", () => this.prefixLine("> "));
    this.addToolbarButton(bottom, "list", "Bullet list", () => this.prefixLine("- "));
    this.addToolbarButton(bottom, "list-ordered", "Numbered list", () => this.prefixLine("1. "));
    this.addToolbarButton(bottom, "list-checks", "Task list", () => this.prefixLine("- [ ] "));

    doc.body.append(top, bottom);
  }

  private addToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
  ): void {
    const button = parent.ownerDocument.createElement("button");
    button.className = "ray-notes-toolbar-button clickable-icon";
    button.type = "button";
    button.ariaLabel = label;
    button.title = label;
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    parent.append(button);
  }

  private getEditor(): Editor | null {
    return this.leaf?.view instanceof MarkdownView ? this.leaf.view.editor : null;
  }

  private wrapSelection(before: string, after = before): void {
    const editor = this.getEditor();
    if (!editor) return;
    const selection = editor.getSelection();
    editor.replaceSelection(`${before}${selection}${after}`);
    if (!selection) {
      const cursor = editor.getCursor();
      editor.setCursor({ line: cursor.line, ch: cursor.ch - after.length });
    }
    editor.focus();
  }

  private prefixLine(prefix: string): void {
    const editor = this.getEditor();
    if (!editor) return;
    const cursor = editor.getCursor();
    editor.replaceRange(prefix, { line: cursor.line, ch: 0 });
    editor.focus();
  }

  private insertLink(): void {
    const editor = this.getEditor();
    if (!editor) return;
    const selection = editor.getSelection();
    editor.replaceSelection(selection ? `[${selection}](url)` : "[text](url)");
    editor.focus();
  }

  private updateDerivedTitle(editor: Editor): void {
    const title = titleFromFirstLine(editor.getLine(0));
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.renameTimer !== null) window.clearTimeout(this.renameTimer);
    this.renameTimer = window.setTimeout(() => {
      this.renameTimer = null;
      void this.renameCurrentNote(title);
    }, 900);
  }

  private async renameCurrentNote(title: string): Promise<void> {
    const view = this.leaf?.view;
    if (!(view instanceof MarkdownView) || !view.file || !this.isInFolder(view.file)) return;
    const file = view.file;
    const baseName = safeFileName(title);
    if (file.basename === baseName) return;

    let suffix = 1;
    let path = normalizePath(`${this.settings.folder}/${baseName}.md`);
    while (this.app.vault.getAbstractFileByPath(path)) {
      suffix += 1;
      path = normalizePath(`${this.settings.folder}/${baseName} ${suffix}.md`);
    }

    const oldPath = file.path;
    await this.app.fileManager.renameFile(file, path);
    this.history = this.history.map((item) => (item === oldPath ? file.path : item));
    this.settings.lastFile = file.path;
    await this.saveData(this.settings);
  }

  private setAlwaysOnTop(win: Window, value: boolean): void {
    try {
      const electron = (win as ElectronBridgeWindow).require?.("electron");
      const nativeWindow = electron?.remote?.getCurrentWindow();
      nativeWindow?.setAlwaysOnTop(value, "floating");
      nativeWindow?.setWindowButtonPosition?.({ x: 18, y: 19 });
    } catch (error) {
      console.warn("Ray Notes could not set always-on-top", error);
    }
  }

  applyAlwaysOnTop(): void {
    if (this.popout) this.setAlwaysOnTop(this.popout.win, this.settings.alwaysOnTop);
  }

  private openSwitcher(): void {
    const files = this.getFiles();
    if (!files.length) {
      new Notice("Ray Notes: no notes found");
      return;
    }

    new NoteSwitcher(this.app, files, this.settings.folder, (file) => {
      void this.openFile(file);
    }).open();
  }

  private async createAndOpenNote(): Promise<void> {
    await this.openFile(await this.createNote());
    this.focusEditor();
  }

  private async createNote(): Promise<TFile> {
    await this.ensureFolder();
    let index = 0;
    let path: string;
    do {
      const name = index === 0 ? "Untitled" : `Untitled ${index}`;
      path = normalizePath(`${this.settings.folder}/${name}.md`);
      index += 1;
    } while (this.app.vault.getAbstractFileByPath(path));

    return this.app.vault.create(path, "");
  }

  private async openFile(file: TFile, recordHistory = true): Promise<void> {
    if (!this.leaf) return;
    await this.leaf.openFile(file, { active: true });
    if (this.leaf.view instanceof MarkdownView) {
      this.updateDerivedTitle(this.leaf.view.editor);
    }
    this.settings.lastFile = file.path;

    if (recordHistory && this.history[this.historyIndex] !== file.path) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(file.path);
      this.historyIndex = this.history.length - 1;
    }
    await this.saveData(this.settings);
  }

  private async navigate(offset: number): Promise<void> {
    const next = this.historyIndex + offset;
    if (next < 0 || next >= this.history.length) return;
    const file = this.app.vault.getAbstractFileByPath(this.history[next]);
    if (!(file instanceof TFile)) return;
    this.historyIndex = next;
    await this.openFile(file, false);
  }

  private focusEditor(): void {
    if (this.leaf?.view instanceof MarkdownView) this.leaf.view.editor.focus();
  }

  private getInitialFile(): TFile | null {
    const last = this.app.vault.getAbstractFileByPath(this.settings.lastFile);
    if (last instanceof TFile && this.isInFolder(last)) return last;
    return this.getFiles()[0] ?? null;
  }

  private getFiles(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isInFolder(file))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  private isInFolder(file: TFile): boolean {
    return file.path.startsWith(`${this.settings.folder}/`);
  }

  private async ensureFolder(): Promise<void> {
    const folder = normalizePath(this.settings.folder.trim());
    if (!folder || folder === "/") throw new Error("choose a notes folder in settings");
    this.settings.folder = folder;

    const parts = folder.split("/");
    for (let i = 1; i <= parts.length; i += 1) {
      const path = parts.slice(0, i).join("/");
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${path} is not a folder`);
      await this.app.vault.createFolder(path);
    }
  }

  private scheduleBoundsSave(): void {
    if (this.saveBoundsTimer !== null) window.clearTimeout(this.saveBoundsTimer);
    this.saveBoundsTimer = window.setTimeout(() => {
      this.captureBounds();
      this.saveBoundsTimer = null;
    }, 300);
  }

  private captureBounds(): void {
    const win = this.popout?.win;
    if (!win) return;
    this.settings.bounds = {
      x: win.screenX,
      y: win.screenY,
      width: win.outerWidth,
      height: win.outerHeight
    };
    void this.saveData(this.settings);
  }
}

class RayNotesSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: RayNotesPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("Notes folder")
      .setDesc("Ray Notes only lists and creates Markdown files in this folder.")
      .addText((text) =>
        text
          .setPlaceholder("Ray Notes")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = normalizePath(value.trim());
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(this.containerEl)
      .setName("Always on top")
      .setDesc("Keep the notes window above other application windows.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.alwaysOnTop).onChange(async (value) => {
          this.plugin.settings.alwaysOnTop = value;
          this.plugin.applyAlwaysOnTop();
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(this.containerEl)
      .setName("Minimize main window")
      .setDesc("Minimize the main Obsidian window when Ray Notes opens.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.minimizeMainWindow).onChange(async (value) => {
          this.plugin.settings.minimizeMainWindow = value;
          await this.plugin.saveData(this.plugin.settings);
        })
      );
  }
}
