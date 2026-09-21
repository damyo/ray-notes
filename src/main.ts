import {
  App,
  Command,
  Editor,
  FuzzyMatch,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Scope,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  WorkspaceWindow,
  normalizePath,
  setIcon
} from "obsidian";
import {
  advancePosition,
  calloutHeaderLine,
  codeFenceOpeningLine,
  extraBlankLineGaps,
  headingEdit,
  imeFocusDelay,
  isImeInteractionPending,
  restoreUnexpectedTaskPrefix,
  toggleWrapEdit
} from "./editor";
import { rayNotesEditorExtension } from "./editor-extension";
import { plainNotePreview, safeFileName, titleFromLines, withHeadingTitle } from "./title";
import {
  draggedWindowBounds,
  fittedRestoreBounds,
  formatOpenedAt,
  pointInsideBounds,
  relativeNotePath,
  shortcutAccelerator,
  shouldHideWindowOnEscape,
  sortNotePaths,
  usesNewWindowModifier
} from "./window";

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RayNotesSettings {
  folder: string;
  alwaysOnTop: boolean;
  visibleOnAllWorkspaces: boolean;
  globalShortcutEnabled: boolean;
  globalShortcut: string;
  raycastStyle: boolean;
  translucentWindow: boolean;
  minimizeMainWindow: boolean;
  wasOpen: boolean;
  noteOpenBehavior: "default" | "when-open" | "always";
  pinnedNotes: string[];
  lastOpened: Record<string, number>;
  lastFile: string;
  pathStorageVersion: number;
  bounds: WindowBounds;
}

const DEFAULT_SETTINGS: RayNotesSettings = {
  folder: "Ray Notes",
  alwaysOnTop: true,
  visibleOnAllWorkspaces: true,
  globalShortcutEnabled: true,
  globalShortcut: "Alt+N",
  raycastStyle: true,
  translucentWindow: false,
  minimizeMainWindow: true,
  wasOpen: false,
  noteOpenBehavior: "when-open",
  pinnedNotes: [],
  lastOpened: {},
  lastFile: "",
  pathStorageVersion: 2,
  bounds: { x: 120, y: 120, width: 620, height: 520 }
};

const MIN_WINDOW_WIDTH = 396;
const IS_MACOS = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";
const TRAFFIC_LIGHT_POSITION = { x: 12, y: 23 } as const;
const SUPPORT_URL = "https://ko-fi.com/damyo";

type ElectronGlobalShortcut = {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered?(accelerator: string): boolean;
};

type ElectronWindow = {
  getBounds?(): WindowBounds;
  webContents?: {
    getZoomFactor(): number;
    setZoomFactor(factor: number): void;
  };
  setAlwaysOnTop(value: boolean, level?: string): void;
  isAlwaysOnTop?(): boolean;
  moveTop?(): void;
  setBackgroundColor?(color: string): void;
  setContentProtection?(enabled: boolean): void;
  setMovable?(value: boolean): void;
  setMinimumSize?(width: number, height: number): void;
  setBounds?(bounds: Partial<WindowBounds>): void;
  setResizable?(value: boolean): void;
  setFocusable?(value: boolean): void;
  setParentWindow?(parent: ElectronWindow | null): void;
  setOpacity?(opacity: number): void;
  setVibrancy?(type: "under-window" | null): void;
  setVisibleOnAllWorkspaces?(
    visible: boolean,
    options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean }
  ): void;
  isVisibleOnAllWorkspaces?(): boolean;
  setWindowButtonPosition?(position: { x: number; y: number } | null): void;
  setWindowButtonVisibility?(visible: boolean): void;
  hide(): void;
  isVisible?(): boolean;
  minimize(): void;
  restore(): void;
  show(): void;
  focus(): void;
  blur(): void;
  on(name: "close", listener: (event: { preventDefault(): void }) => void): void;
  on(name: "will-resize" | "resized", listener: () => void): void;
  on(name: "focus" | "blur", listener: () => void): void;
  off(name: "close", listener: (event: { preventDefault(): void }) => void): void;
  off(name: "will-resize" | "resized", listener: () => void): void;
  off(name: "focus" | "blur", listener: () => void): void;
};

type ObsidianCommandManager = {
  executeCommand(command: Command, event?: Event): boolean;
  executeCommandById(id: string, event?: Event): boolean;
};

type ElectronApp = {
  dock?: {
    show(): Promise<void>;
  };
  on(name: "before-quit", listener: () => void): void;
  off(name: "before-quit", listener: () => void): void;
};

type ElectronBridgeWindow = Window & {
  require?: (module: "electron") => {
    globalShortcut?: ElectronGlobalShortcut;
    remote?: {
      app: ElectronApp;
      getCurrentWindow(): ElectronWindow;
      screen?: {
        getCursorScreenPoint(): { x: number; y: number };
        getDisplayMatching?(bounds: WindowBounds): { workArea: WindowBounds };
      };
      BrowserWindow: {
        getAllWindows(): ElectronWindow[];
      };
      require?(module: "electron"): { globalShortcut?: ElectronGlobalShortcut };
    };
  };
};

type AppWithSettings = App & {
  setting: {
    open(): void;
    openTabById(id: string): void;
  };
};

interface ActionItem {
  icon: string;
  label: string;
  shortcut: string[];
  dividerBefore?: boolean;
  disabled?: boolean;
  run: () => void;
}

interface NoteItem {
  file: TFile;
  content: string;
  searchText: string;
  current: boolean;
  pinned: boolean;
  openedAt?: number;
  section: "Pinned" | "Notes";
  sectionStart: boolean;
}

interface Layer {
  open(): void;
  close(): void;
}

interface RayNotesWindowContext {
  leaf: WorkspaceLeaf;
  popout: WorkspaceWindow;
  nativePopout: ElectronWindow | null;
  history: string[];
  historyIndex: number;
  saveBoundsTimer: number | null;
  renameTimer: number | null;
  titleEl: HTMLElement | null;
  alwaysOnTopButton: HTMLButtonElement | null;
  workspacePinButton: HTMLButtonElement | null;
  formatBarHidden: boolean;
  contentProtected: boolean;
  floatingUi: HTMLElement | null;
  floatingCleanup: (() => void) | null;
  activeLayer: Layer | null;
  escapeSuppressedUntil: number;
  minimalEl: HTMLElement | null;
  minimal: boolean;
  normalBounds: WindowBounds | null;
  visibleOnAllWorkspaces: boolean;
  alwaysOnTop: boolean;
  hidden: boolean;
  primary: boolean;
}

class ImeInputGuard {
  private composing = false;
  private compositionEndedAt = 0;
  private win: Window | null = null;
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this.input) return;
    if (!isImeInteractionPending(event.isComposing || this.composing, event.keyCode, this.compositionEndedAt, Date.now())) {
      return;
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  constructor(
    private readonly input: HTMLInputElement,
    private readonly interceptCompositionKeys = true
  ) {
    input.addEventListener("compositionstart", this.handleCompositionStart);
    input.addEventListener("compositionend", this.handleCompositionEnd);
    this.rebind();
  }

  rebind(): void {
    this.win?.removeEventListener("keydown", this.handleKeyDown, true);
    this.win = this.input.ownerDocument.defaultView;
    if (this.interceptCompositionKeys) this.win?.addEventListener("keydown", this.handleKeyDown, true);
  }

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly handleCompositionEnd = (): void => {
    this.composing = false;
    this.compositionEndedAt = Date.now();
  };

  isPending(event: KeyboardEvent): boolean {
    return isImeInteractionPending(
      event.isComposing || this.composing,
      event.keyCode,
      this.compositionEndedAt,
      Date.now()
    );
  }

  isCompositionActive(event: KeyboardEvent): boolean {
    return event.isComposing || this.composing || event.keyCode === 229;
  }

  focusDelay(): number {
    return imeFocusDelay(this.composing, this.compositionEndedAt, Date.now());
  }

  destroy(): void {
    this.input.removeEventListener("compositionstart", this.handleCompositionStart);
    this.input.removeEventListener("compositionend", this.handleCompositionEnd);
    this.win?.removeEventListener("keydown", this.handleKeyDown, true);
  }
}

class ActionPanel extends FuzzySuggestModal<ActionItem> {
  private readonly imeGuard: ImeInputGuard;
  private chosen = false;

  constructor(
    app: App,
    private readonly actions: ActionItem[],
    private readonly closed: (chosen: boolean, focusDelay: number) => void
  ) {
    super(app);
    this.shouldRestoreSelection = false;
    this.imeGuard = new ImeInputGuard(this.inputEl);
    this.modalEl.addClass("ray-notes-action-panel");
    this.setPlaceholder("Search for actions...");
  }

  getItems(): ActionItem[] {
    return this.actions;
  }

  getItemText(action: ActionItem): string {
    return action.label;
  }

  renderSuggestion(match: FuzzyMatch<ActionItem>, el: HTMLElement): void {
    const action = match.item;
    el.addClass("ray-notes-action-row");
    if (action.dividerBefore) el.addClass("ray-notes-action-divider");
    if (action.disabled) {
      el.addClass("ray-notes-action-disabled");
      el.setAttribute("aria-disabled", "true");
    }
    const icon = el.createDiv("ray-notes-action-icon");
    setIcon(icon, action.icon);
    el.createSpan({ cls: "ray-notes-action-label", text: action.label });
    appendKeycaps(el, action.shortcut);
  }

  onOpen(): void {
    void super.onOpen();
    this.imeGuard.rebind();
    this.inputEl.ownerDocument.defaultView?.setTimeout(() => this.inputEl.focus(), 0);
  }

  onChooseItem(action: ActionItem): void {
    this.chosen = true;
    action.run();
  }

  selectSuggestion(match: FuzzyMatch<ActionItem>, event: MouseEvent | KeyboardEvent): void {
    consumeLayerSelectionEvent(event);
    if (match.item.disabled) return;
    super.selectSuggestion(match, event);
  }

  onClose(): void {
    const focusDelay = this.imeGuard.focusDelay();
    this.inputEl.blur();
    this.imeGuard.destroy();
    this.closed(this.chosen, focusDelay);
  }
}

function appendKeycaps(parent: HTMLElement, keys: string[]): void {
  if (!keys.length) return;
  const group = parent.createDiv("ray-notes-keycaps");
  for (const key of keys) group.createEl("kbd", { text: key });
}

function consumeLayerSelectionEvent(event: MouseEvent | KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
}

class NoteSwitcher extends FuzzySuggestModal<NoteItem> {
  private readonly imeGuard: ImeInputGuard;
  private chosen = false;
  private alternateOpen = false;
  private modifierWindow: Window | null = null;
  private readonly handleModifierKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Alt") this.setAlternateOpen(true);
  };
  private readonly handleModifierKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Alt") this.setAlternateOpen(false);
  };
  private readonly handleModifierBlur = (): void => this.setAlternateOpen(false);
  private readonly handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    consumeLayerSelectionEvent(event);
    this.close();
  };

  constructor(
    app: App,
    private readonly items: NoteItem[],
    private readonly folder: string,
    private readonly choose: (file: TFile, openInNewWindow: boolean) => void,
    private readonly togglePin: (file: TFile) => Promise<boolean>,
    private readonly remove: (file: TFile) => Promise<boolean>,
    private readonly closed: (chosen: boolean, focusDelay: number) => void
  ) {
    super(app);
    this.shouldRestoreSelection = false;
    this.imeGuard = new ImeInputGuard(this.inputEl);
    this.inputEl.addEventListener("keydown", this.handleEscape, true);
    this.modalEl.addClass("ray-notes-note-switcher");
    this.setPlaceholder("Search notes...");
    this.refreshSections();
  }

  getItems(): NoteItem[] {
    return this.items;
  }

  getItemText(item: NoteItem): string {
    return item.searchText;
  }

  private label(item: NoteItem): string {
    const { file } = item;
    return file.path.slice(this.folder.length + 1, -file.extension.length - 1);
  }

  renderSuggestion(match: FuzzyMatch<NoteItem>, el: HTMLElement): void {
    const item = match.item;
    if (item.sectionStart) el.dataset.section = item.section;
    el.toggleClass("ray-notes-current-note", item.current);
    el.toggleClass("ray-notes-pinned-note", item.pinned);

    const copy = el.createDiv("ray-notes-note-copy");
    copy.createSpan({ cls: "ray-notes-note-label", text: this.label(item) });
    const detail = copy.createSpan("ray-notes-note-detail");
    const opened = formatOpenedAt(item.openedAt);
    const characters = `${Array.from(item.content).length.toLocaleString()} Characters`;
    detail.textContent = [opened, characters].filter(Boolean).join(" · ");

    const actions = el.createDiv("ray-notes-note-actions");
    const pin = actions.createEl("button", {
      cls: "ray-notes-note-action",
      attr: { "aria-label": item.pinned ? "Unpin note" : "Pin note", type: "button" }
    });
    setIcon(pin, item.pinned ? "pin-off" : "pin");
    this.bindRowAction(pin, async () => {
      item.pinned = await this.togglePin(item.file);
      item.section = item.pinned ? "Pinned" : "Notes";
      this.refreshSections();
      this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const trash = actions.createEl("button", {
      cls: "ray-notes-note-action ray-notes-note-delete",
      attr: { "aria-label": "Delete note", type: "button" }
    });
    setIcon(trash, "trash-2");
    this.bindRowAction(trash, async () => {
      if (!await this.remove(item.file)) return;
      const index = this.items.indexOf(item);
      if (index >= 0) this.items.splice(index, 1);
      if (!this.items.length) this.close();
      else {
        this.refreshSections();
        this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const indicator = el.createDiv("ray-notes-new-window-indicator");
    const icon = indicator.createSpan("ray-notes-new-window-icon");
    setIcon(icon, "panels-top-left");
    indicator.createSpan({ text: "New Window" });
  }

  onOpen(): void {
    void super.onOpen();
    this.imeGuard.rebind();
    this.modifierWindow = this.inputEl.ownerDocument.defaultView;
    this.modifierWindow?.addEventListener("keydown", this.handleModifierKeyDown, true);
    this.modifierWindow?.addEventListener("keyup", this.handleModifierKeyUp, true);
    this.modifierWindow?.addEventListener("blur", this.handleModifierBlur);
    this.inputEl.ownerDocument.defaultView?.setTimeout(() => this.inputEl.focus(), 0);
  }

  selectSuggestion(match: FuzzyMatch<NoteItem>, event: MouseEvent | KeyboardEvent): void {
    consumeLayerSelectionEvent(event);
    super.selectSuggestion(match, event);
  }

  onChooseItem(item: NoteItem, event: MouseEvent | KeyboardEvent): void {
    this.chosen = true;
    this.choose(item.file, usesNewWindowModifier(event) || this.alternateOpen);
  }

  onClose(): void {
    const focusDelay = this.imeGuard.focusDelay();
    this.modifierWindow?.removeEventListener("keydown", this.handleModifierKeyDown, true);
    this.modifierWindow?.removeEventListener("keyup", this.handleModifierKeyUp, true);
    this.modifierWindow?.removeEventListener("blur", this.handleModifierBlur);
    this.modifierWindow = null;
    this.inputEl.blur();
    this.inputEl.removeEventListener("keydown", this.handleEscape, true);
    this.imeGuard.destroy();
    this.closed(this.chosen, focusDelay);
  }

  private setAlternateOpen(active: boolean): void {
    if (this.alternateOpen === active) return;
    this.alternateOpen = active;
    this.modalEl.toggleClass("ray-notes-alternate-open", active);
  }

  private refreshSections(): void {
    this.items.sort((a, b) => Number(b.pinned) - Number(a.pinned)
      || (b.openedAt ?? 0) - (a.openedAt ?? 0)
      || a.file.path.localeCompare(b.file.path, undefined, { sensitivity: "base", numeric: true }));
    let previous: NoteItem["section"] | null = null;
    for (const item of this.items) {
      item.sectionStart = item.section !== previous;
      previous = item.section;
    }
  }

  private bindRowAction(button: HTMLButtonElement, action: () => void): void {
    button.addEventListener("pointerdown", consumeLayerSelectionEvent);
    button.addEventListener("click", (event) => {
      consumeLayerSelectionEvent(event);
      action();
    });
  }
}

export default class RayNotesPlugin extends Plugin {
  settings: RayNotesSettings = { ...DEFAULT_SETTINGS };
  private readonly windows = new Set<RayNotesWindowContext>();
  private activeWindow: RayNotesWindowContext | null = null;
  private mainWindow: ElectronWindow | null = null;
  private electronApp: ElectronApp | null = null;
  private globalShortcut: ElectronGlobalShortcut | null = null;
  private registeredGlobalShortcut: string | null = null;
  private quitting = false;
  private restoreLegacyPopout = false;
  private redirectingFile = false;
  private mainWindowClosing = false;
  private settingsSave = Promise.resolve();
  private readonly movingIntoFolder = new Set<string>();
  private lastWorkspaceRayNote = "";

  saveSettings(): Promise<void> {
    const snapshot = structuredClone(this.settings);
    const write = (): Promise<void> => this.saveData(snapshot);
    this.settingsSave = this.settingsSave.then(write, write);
    return this.settingsSave;
  }

  private noteKey(path: string): string {
    return relativeNotePath(this.settings.folder, path);
  }

  private notePath(key: string): string {
    return normalizePath(`${normalizePath(this.settings.folder)}/${normalizePath(key)}`);
  }

  private get leaf(): WorkspaceLeaf | null { return this.activeWindow?.leaf ?? null; }
  private get popout(): WorkspaceWindow | null { return this.activeWindow?.popout ?? null; }
  private get nativePopout(): ElectronWindow | null { return this.activeWindow?.nativePopout ?? null; }
  private set nativePopout(value: ElectronWindow | null) { if (this.activeWindow) this.activeWindow.nativePopout = value; }
  private get history(): string[] { return this.activeWindow?.history ?? []; }
  private set history(value: string[]) { if (this.activeWindow) this.activeWindow.history = value; }
  private get historyIndex(): number { return this.activeWindow?.historyIndex ?? -1; }
  private set historyIndex(value: number) { if (this.activeWindow) this.activeWindow.historyIndex = value; }
  private get saveBoundsTimer(): number | null { return this.activeWindow?.saveBoundsTimer ?? null; }
  private set saveBoundsTimer(value: number | null) { if (this.activeWindow) this.activeWindow.saveBoundsTimer = value; }
  private get renameTimer(): number | null { return this.activeWindow?.renameTimer ?? null; }
  private set renameTimer(value: number | null) { if (this.activeWindow) this.activeWindow.renameTimer = value; }
  private get titleEl(): HTMLElement | null { return this.activeWindow?.titleEl ?? null; }
  private set titleEl(value: HTMLElement | null) { if (this.activeWindow) this.activeWindow.titleEl = value; }
  private get alwaysOnTopButton(): HTMLButtonElement | null { return this.activeWindow?.alwaysOnTopButton ?? null; }
  private set alwaysOnTopButton(value: HTMLButtonElement | null) { if (this.activeWindow) this.activeWindow.alwaysOnTopButton = value; }
  private get workspacePinButton(): HTMLButtonElement | null { return this.activeWindow?.workspacePinButton ?? null; }
  private set workspacePinButton(value: HTMLButtonElement | null) { if (this.activeWindow) this.activeWindow.workspacePinButton = value; }
  private get formatBarHidden(): boolean { return this.activeWindow?.formatBarHidden ?? false; }
  private set formatBarHidden(value: boolean) { if (this.activeWindow) this.activeWindow.formatBarHidden = value; }
  private get contentProtected(): boolean { return this.activeWindow?.contentProtected ?? false; }
  private set contentProtected(value: boolean) { if (this.activeWindow) this.activeWindow.contentProtected = value; }
  private get floatingUi(): HTMLElement | null { return this.activeWindow?.floatingUi ?? null; }
  private set floatingUi(value: HTMLElement | null) { if (this.activeWindow) this.activeWindow.floatingUi = value; }
  private get floatingCleanup(): (() => void) | null { return this.activeWindow?.floatingCleanup ?? null; }
  private set floatingCleanup(value: (() => void) | null) { if (this.activeWindow) this.activeWindow.floatingCleanup = value; }
  private get activeLayer(): Layer | null { return this.activeWindow?.activeLayer ?? null; }
  private set activeLayer(value: Layer | null) { if (this.activeWindow) this.activeWindow.activeLayer = value; }

  private createWindowContext(
    leaf: WorkspaceLeaf,
    popout: WorkspaceWindow,
    primary: boolean
  ): RayNotesWindowContext {
    return {
      leaf,
      popout,
      nativePopout: null,
      history: [],
      historyIndex: -1,
      saveBoundsTimer: null,
      renameTimer: null,
      titleEl: null,
      alwaysOnTopButton: null,
      workspacePinButton: null,
      formatBarHidden: false,
      contentProtected: false,
      floatingUi: null,
      floatingCleanup: null,
      activeLayer: null,
      escapeSuppressedUntil: 0,
      minimalEl: null,
      minimal: false,
      normalBounds: null,
      visibleOnAllWorkspaces: IS_MACOS && this.settings.visibleOnAllWorkspaces,
      alwaysOnTop: this.settings.alwaysOnTop,
      hidden: false,
      primary
    };
  }

  private activateWindow(context: RayNotesWindowContext): void {
    if (this.windows.has(context)) this.activeWindow = context;
  }

  private contextFor(popout: WorkspaceWindow): RayNotesWindowContext | null {
    return Array.from(this.windows).find((context) => context.popout === popout) ?? null;
  }
  private readonly handleMainWindowClose = (): void => {
    if (!this.windows.size || this.quitting) return;
    this.mainWindowClosing = true;
    this.settings.wasOpen = true;
    this.captureBounds();
    void this.saveSettings();
  };
  private readonly handleBeforeQuit = (): void => {
    this.quitting = true;
    this.settings.wasOpen = this.windows.size > 0;
    this.captureBounds();
    void this.saveSettings();
    for (const context of this.windows) context.leaf.detach();
  };

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<RayNotesSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    if (!Array.isArray(this.settings.pinnedNotes)) this.settings.pinnedNotes = [];
    if (!this.settings.lastOpened || typeof this.settings.lastOpened !== "object") this.settings.lastOpened = {};
    if (stored?.pathStorageVersion !== 2) {
      this.settings.pinnedNotes = this.settings.pinnedNotes.map((path) => this.noteKey(path));
      this.settings.lastOpened = Object.fromEntries(
        Object.entries(this.settings.lastOpened).map(([path, opened]) => [this.noteKey(path), opened])
      );
      this.settings.lastFile = this.noteKey(this.settings.lastFile);
      this.settings.pathStorageVersion = 2;
      await this.saveSettings();
    }
    this.restoreLegacyPopout = stored?.wasOpen === undefined;
    this.connectElectronLifecycle();
    this.interceptAddPropertyCommand();
    this.registerGlobalShortcut();
    this.registerEditorExtension(rayNotesEditorExtension);
    this.registerMarkdownPostProcessor((element, context) => {
      if (!element.closest("body.ray-notes-window.ray-notes-raycast-style")) return;
      element.querySelectorAll(":scope > .ray-notes-reading-blank-lines").forEach((spacer) => spacer.remove());
      const gaps = extraBlankLineGaps(context.getSectionInfo(element)?.text ?? "");
      const children = Array.from(element.children);
      if (!gaps.some(Boolean) || children.length !== gaps.length + 1) return;
      gaps.forEach((extraLines, index) => {
        if (!extraLines) return;
        const spacer = element.ownerDocument.createElement("div");
        spacer.className = "ray-notes-reading-blank-lines";
        spacer.style.setProperty("--ray-notes-extra-blank-lines", String(extraLines));
        children[index + 1].before(spacer);
      });
    });

    this.addCommand({
      id: "open-ray-notes",
      name: "Open notes window",
      callback: () => this.openWindow()
    });
    this.addCommand({
      id: "toggle-minimal-mode",
      name: "Toggle Minimal Mode",
      callback: () => this.toggleMinimalMode()
    });

    this.addRibbonIcon("notebook-pen", "Open Ray Notes", () => this.openWindow());
    this.registerObsidianProtocolHandler("ray-notes", () => this.openWindow());
    this.addSettingTab(new RayNotesSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      const activeFile = this.app.workspace.getActiveFile();
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const isRayNote = !!activeFile && this.isInFolder(activeFile);
      if (activeView) {
        activeView.containerEl.toggleClass("ray-notes-folder-view", isRayNote);
        if (isRayNote) {
          const state = activeView.leaf.getViewState();
          void activeView.leaf.setViewState({
            ...state,
            state: { ...state.state, mode: "preview" }
          });
        }
      }
      void this.resumeWindow();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || this.redirectingFile) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.file !== file || Array.from(this.windows).some((context) => context.leaf === view.leaf)) return;
        const isRayNote = this.isInFolder(file);
        view.containerEl.toggleClass("ray-notes-folder-view", isRayNote);

        if (!isRayNote) {
          this.lastWorkspaceRayNote = "";
          return;
        }
        if (this.lastWorkspaceRayNote !== file.path) {
          this.lastWorkspaceRayNote = file.path;
          const state = view.leaf.getViewState();
          void view.leaf.setViewState({
            ...state,
            state: { ...state.state, mode: "preview" }
          });
        }

        const shouldRedirect = this.settings.noteOpenBehavior === "always"
          || (this.settings.noteOpenBehavior === "when-open" && this.windows.size > 0);
        if (shouldRedirect) void this.redirectFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFolder && normalizePath(oldPath) === normalizePath(this.settings.folder)) {
          this.settings.folder = file.path;
          void this.saveSettings();
          return;
        }
        if (file instanceof TFile) {
          this.migrateNotePath(file.path, oldPath);
          const movedIntoFolder = !oldPath.startsWith(`${this.settings.folder}/`)
            && this.isInFolder(file);
          if (movedIntoFolder) this.movingIntoFolder.add(file.path);
          void this.prepareMovedNote(file, oldPath)
            .catch((error) => console.warn("Ray Notes could not preserve the moved note title", error))
            .finally(() => this.movingIntoFolder.delete(file.path));
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        const key = this.noteKey(file.path);
        this.settings.pinnedNotes = this.settings.pinnedNotes.filter((path) => path !== key);
        delete this.settings.lastOpened[key];
        if (this.settings.lastFile === key) this.settings.lastFile = "";
        void this.saveSettings();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const context = Array.from(this.windows).find((candidate) => info === candidate.leaf.view);
        if (!context) return;
        this.updateDerivedTitle(editor, context);
        this.updateMinimalPreview(context);
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (workspaceWindow) => {
        const context = this.contextFor(workspaceWindow);
        if (!context) return;
        this.activateWindow(context);
        this.captureBounds();
        this.closeFloatingUi();
        this.closeActiveLayer();
        this.windows.delete(context);
        if (this.activeWindow === context) this.activeWindow = Array.from(this.windows)[0] ?? null;
        if (!this.quitting && !this.mainWindowClosing && this.windows.size === 0) {
          this.settings.wasOpen = false;
          void this.saveSettings();
        }
      })
    );
  }

  onunload(): void {
    this.unregisterGlobalShortcut();
    this.captureBounds();
    for (const context of this.windows) {
      this.activateWindow(context);
      this.closeFloatingUi();
      this.closeActiveLayer();
      context.nativePopout?.setAlwaysOnTop(false);
      context.nativePopout?.setVibrancy?.(null);
      context.popout.doc.body.removeClass("ray-notes-window");
      context.leaf.detach();
    }
    this.windows.clear();
    this.activeWindow = null;
    this.mainWindow?.off("close", this.handleMainWindowClose);
    this.electronApp?.off("before-quit", this.handleBeforeQuit);
  }

  async openWindow(minimizeMainWindow = true): Promise<void> {
    const primary = Array.from(this.windows).find((context) => context.primary);
    if (primary) {
      this.activateWindow(primary);
      await this.showWindow(primary);
      return;
    }

    try {
      await this.ensureFolder();
      this.mainWindowClosing = false;
      this.settings.wasOpen = true;
      await this.saveSettings();
      if (minimizeMainWindow && this.settings.minimizeMainWindow) this.mainWindow?.minimize();
      const leaf = this.app.workspace.openPopoutLeaf({
        x: this.settings.bounds.x,
        y: this.settings.bounds.y,
        size: {
          width: Math.max(MIN_WINDOW_WIDTH, this.settings.bounds.width),
          height: this.settings.bounds.height
        }
      });
      const popout = leaf.getContainer() as WorkspaceWindow;
      const context = this.createWindowContext(leaf, popout, true);
      this.windows.add(context);
      this.activateWindow(context);
      await this.prepareWindow(popout);

      const file = this.getInitialFile() ?? (await this.createNote());
      await this.openFile(file);
      popout.win.focus();
      this.focusEditor();
    } catch (error) {
      const context = this.activeWindow;
      context?.leaf.detach();
      if (context) this.windows.delete(context);
      this.activeWindow = Array.from(this.windows)[0] ?? null;
      new Notice(`Ray Notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async prepareWindow(popout: WorkspaceWindow): Promise<void> {
    const context = this.activeWindow;
    if (!context || context.popout !== popout) return;
    const { win, doc } = popout;
    doc.querySelectorAll(".ray-notes-toolbar").forEach((element) => element.remove());
    doc.body.addClass("ray-notes-window");
    doc.body.toggleClass("ray-notes-platform-macos", IS_MACOS);
    doc.body.toggleClass("ray-notes-platform-windows", IS_WINDOWS);
    doc.title = "Ray Notes";
    this.createChrome(doc);
    const stopScrollIndicator = this.createScrollIndicator(doc, win);
    await this.configureNativePopout(win);
    this.applyAppearance();

    const shortcutScope = new Scope(this.app.scope);
    let shortcutScopeActive = false;
    for (const key of ["p", "k", "l", "n", "d", "[", "]"]) {
      shortcutScope.register(["Mod"], key, () => false);
    }
    const activateShortcutScope = (): void => {
      if (shortcutScopeActive) return;
      this.app.keymap.pushScope(shortcutScope);
      shortcutScopeActive = true;
    };
    const deactivateShortcutScope = (): void => {
      if (!shortcutScopeActive) return;
      this.app.keymap.popScope(shortcutScope);
      shortcutScopeActive = false;
    };

    let pointerTimer: number | null = null;
    let trafficLightFrame = 0;
    let chromeActive: boolean | null = null;
    const updateChrome = (force = false): void => {
      const active = this.isPointerInsideWindow(win, doc, context.nativePopout);
      if (!force && active === chromeActive) return;
      chromeActive = active;
      doc.body.toggleClass("ray-notes-chrome-active", active);
      if (IS_MACOS && context.nativePopout) {
        context.nativePopout.setWindowButtonVisibility?.(active && !context.minimal);
        if (active && !context.minimal) this.positionTrafficLights(context.nativePopout);
      }
    };
    const scheduleChromeUpdate = (): void => {
      if (trafficLightFrame) win.cancelAnimationFrame(trafficLightFrame);
      trafficLightFrame = win.requestAnimationFrame(() => {
        trafficLightFrame = 0;
        updateChrome(true);
      });
    };
    const startPointerTracking = (): void => {
      if (pointerTimer !== null) return;
      updateChrome();
      pointerTimer = win.setInterval(updateChrome, 120);
    };
    const stopPointerTracking = (): void => {
      if (pointerTimer !== null) win.clearInterval(pointerTimer);
      pointerTimer = null;
    };
    this.registerDomEvent(win, "focus", () => {
      this.activateWindow(context);
      updateChrome(true);
      this.syncWindowControls(context);
      startPointerTracking();
      activateShortcutScope();
    });
    this.registerDomEvent(win, "blur", () => {
      updateChrome(true);
      this.closeFloatingUi(context);
      deactivateShortcutScope();
    });
    startPointerTracking();
    activateShortcutScope();
    this.registerDomEvent(win, "mouseenter", () => updateChrome(true));

    this.registerDomEvent(win, "keydown", (event) => {
      this.activateWindow(context);
      const bareEscape = event.key === "Escape"
        && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (bareEscape && Date.now() < context.escapeSuppressedUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
      }
      if (bareEscape && event.defaultPrevented) return;
      if (bareEscape && context.activeLayer) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.closeActiveLayer(context);
        return;
      }
      if (bareEscape && context.floatingUi) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.closeFloatingUi(context);
        return;
      }
      if (bareEscape && (this.closeOpenDocumentSearch(doc)
        || (doc !== document && this.closeOpenDocumentSearch(document)))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
      }
      if (bareEscape && (this.hasOpenOverlay(doc)
        || (doc !== document && this.hasOpenOverlay(document)))) {
        event.preventDefault();
        return;
      }
      if (shouldHideWindowOnEscape({
        key: event.key,
        hasModifier: event.metaKey || event.ctrlKey || event.altKey || event.shiftKey,
        isComposing: event.isComposing || event.keyCode === 229,
        hasPluginOverlay: !!context.activeLayer || !!context.floatingUi,
        hasObsidianOverlay: this.hasOpenOverlay(doc)
          || (doc !== document && this.hasOpenOverlay(document))
      })) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.hideWindow(context);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.isComposing || event.keyCode === 229)) {
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const code = event.code;
      const run = (action: () => void): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        action();
      };

      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && code === "KeyX") {
        run(() => void this.deleteCurrentNote());
      } else if (event.altKey && !event.shiftKey && code === "Comma") {
        run(() => this.toggleFormatBar());
      } else if (event.altKey && !event.shiftKey && ["Digit1", "Digit2", "Digit3"].includes(code)) {
        run(() => this.setHeading(Number(code.slice(-1))));
      } else if (event.altKey && !event.shiftKey && code === "KeyC") {
        run(() => this.wrapSelection("```\n", "\n```"));
      } else if (event.altKey && !event.shiftKey && code === "KeyE") {
        run(() => this.wrapSelection("`"));
      } else if (event.altKey && !event.shiftKey && code === "KeyN") {
        run(() => {
          const file = context.leaf.view instanceof MarkdownView ? context.leaf.view.file : null;
          if (file) void this.openFileInNewWindow(file, context);
        });
      } else if (event.shiftKey && !event.altKey && code === "KeyC") {
        run(() => void this.copyCurrentNote());
      } else if (event.shiftKey && !event.altKey && code === "KeyD") {
        run(() => void this.copyDeeplink());
      } else if (event.shiftKey && !event.altKey && code === "Comma") {
        run(() => this.openFormatPanel());
      } else if (event.shiftKey && !event.altKey && code === "KeyH") {
        run(() => this.toggleContentProtection());
      } else if (event.shiftKey && !event.altKey && key === "s") {
        run(() => this.wrapSelection("~~"));
      } else if (event.shiftKey && !event.altKey && key === "b") {
        run(() => this.prefixLine("> "));
      } else if (event.shiftKey && !event.altKey && code === "Digit7") {
        run(() => this.prefixLine("1. "));
      } else if (event.shiftKey && !event.altKey && code === "Digit8") {
        run(() => this.prefixLine("- "));
      } else if (event.shiftKey && !event.altKey && code === "Digit9") {
        run(() => this.prefixLine("- [ ] "));
      } else if (!event.altKey && !event.shiftKey && key === "u") {
        run(() => this.wrapSelection("<u>", "</u>"));
      } else if (!event.altKey && !event.shiftKey && key === "l") {
        run(() => this.openLinkPopover());
      } else if (!event.altKey && !event.shiftKey && key === "k") {
        run(() => this.openActionPanel());
      } else if (!event.altKey && !event.shiftKey && key === "p") {
        run(() => this.openSwitcher());
      } else if (!event.altKey && !event.shiftKey && key === "n") {
        run(() => void this.createAndOpenNote());
      } else if (!event.altKey && !event.shiftKey && code === "Semicolon") {
        run(() => this.commandManager().executeCommandById("markdown:add-metadata-property", event));
      } else if (!event.altKey && !event.shiftKey && key === "d") {
        run(() => void this.duplicateCurrentNote());
      } else if (!event.altKey && code === "Equal") {
        run(() => this.changeZoom(0.1));
      } else if (!event.altKey && !event.shiftKey && code === "Minus") {
        run(() => this.changeZoom(-0.1));
      } else if (!event.altKey && !event.shiftKey && code === "Comma") {
        run(() => this.openSettings());
      } else if (!event.altKey && !event.shiftKey && code === "BracketLeft") {
        run(() => void this.navigate(-1, context));
      } else if (!event.altKey && !event.shiftKey && code === "BracketRight") {
        run(() => void this.navigate(1, context));
      }
    }, true);

    this.registerDomEvent(win, "resize", () => {
      this.activateWindow(context);
      scheduleChromeUpdate();
      this.scheduleBoundsSave();
    });
    this.registerDomEvent(win, "beforeunload", () => {
      this.activateWindow(context);
      stopPointerTracking();
      stopScrollIndicator();
      if (trafficLightFrame) win.cancelAnimationFrame(trafficLightFrame);
      deactivateShortcutScope();
      this.captureBounds();
    });
  }

  private createScrollIndicator(doc: Document, win: Window): () => void {
    doc.querySelector(".ray-notes-scrollbar")?.remove();
    const track = doc.createElement("div");
    track.className = "ray-notes-scrollbar";
    const thumb = track.createDiv("ray-notes-scrollbar-thumb");
    doc.body.append(track);

    let frame = 0;
    let hideTimer = 0;
    const currentScroller = (): HTMLElement | null => {
      const candidates = Array.from(doc.querySelectorAll<HTMLElement>(
        ".markdown-source-view.mod-cm6 .cm-scroller, .markdown-preview-view"
      ));
      return candidates.find((element) => element.clientHeight > 0) ?? null;
    };
    const update = (): void => {
      frame = 0;
      const scroller = currentScroller();
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) {
        track.hidden = true;
        return;
      }
      track.hidden = false;
      const trackHeight = track.clientHeight;
      const thumbHeight = Math.max(28, trackHeight * scroller.clientHeight / scroller.scrollHeight);
      const available = Math.max(0, trackHeight - thumbHeight);
      const scrollable = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${available * scroller.scrollTop / scrollable}px)`;
    };
    const schedule = (): void => {
      if (!frame) frame = win.requestAnimationFrame(update);
    };
    const handleScroll = (event: Event): void => {
      const scroller = currentScroller();
      if (event.target !== scroller) return;
      track.addClass("is-visible");
      win.clearTimeout(hideTimer);
      hideTimer = win.setTimeout(() => track.removeClass("is-visible"), 700);
      schedule();
    };
    doc.addEventListener("scroll", handleScroll, true);
    win.addEventListener("resize", schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(doc.body, { childList: true, subtree: true });
    schedule();

    return () => {
      if (frame) win.cancelAnimationFrame(frame);
      win.clearTimeout(hideTimer);
      observer.disconnect();
      doc.removeEventListener("scroll", handleScroll, true);
      win.removeEventListener("resize", schedule);
      track.remove();
    };
  }

  private connectElectronLifecycle(): void {
    try {
      const electron = (window as ElectronBridgeWindow).require?.("electron");
      if (!electron?.remote) return;
      this.mainWindow = electron.remote.getCurrentWindow();
      this.electronApp = electron.remote.app;
      this.globalShortcut = electron.globalShortcut
        ?? electron.remote.require?.("electron").globalShortcut
        ?? null;
      this.mainWindow.on("close", this.handleMainWindowClose);
      this.electronApp.on("before-quit", this.handleBeforeQuit);
    } catch (error) {
      console.warn("Ray Notes could not connect Electron window lifecycle", error);
    }
  }

  private registerGlobalShortcut(): boolean {
    this.unregisterGlobalShortcut();
    if (!this.settings.globalShortcutEnabled) return true;
    if (!this.globalShortcut) {
      new Notice("Ray Notes: global shortcuts are unavailable in this Obsidian session");
      return false;
    }
    const accelerator = this.settings.globalShortcut.trim() || DEFAULT_SETTINGS.globalShortcut;
    try {
      this.globalShortcut.unregister(accelerator);
      if (!this.globalShortcut.register(accelerator, () => void this.togglePrimaryWindow())) {
        new Notice(`Ray Notes: ${accelerator} is already in use`);
        return false;
      }
      if (this.globalShortcut.isRegistered && !this.globalShortcut.isRegistered(accelerator)) {
        new Notice(`Ray Notes: ${accelerator} could not be registered`);
        return false;
      }
      this.registeredGlobalShortcut = accelerator;
      return true;
    } catch (error) {
      console.warn("Ray Notes could not register the global shortcut", error);
      new Notice(`Ray Notes: invalid global shortcut “${accelerator}”`);
      return false;
    }
  }

  private unregisterGlobalShortcut(): void {
    if (!this.registeredGlobalShortcut || !this.globalShortcut) return;
    this.globalShortcut.unregister(this.registeredGlobalShortcut);
    this.registeredGlobalShortcut = null;
  }

  private async togglePrimaryWindow(): Promise<void> {
    const context = Array.from(this.windows).find((candidate) => candidate.primary);
    if (!context) {
      await this.openWindow(false);
      return;
    }
    if (context.nativePopout?.isVisible?.() ?? !context.hidden) this.hideWindow(context);
    else await this.showWindow(context);
  }

  private hideWindow(context = this.activeWindow): void {
    if (!context) return;
    this.closeFloatingUi(context);
    this.closeActiveLayer(context);
    context.nativePopout?.hide();
    context.hidden = true;
  }

  private async showWindow(context: RayNotesWindowContext): Promise<void> {
    const state = context.leaf.getViewState();
    if (state.state?.mode !== "source") {
      await context.leaf.setViewState({
        ...state,
        state: { ...state.state, mode: "source" }
      });
    }
    const nativeWindow = context.nativePopout;
    this.activateWindow(context);
    if (IS_MACOS && nativeWindow) {
      nativeWindow.setVisibleOnAllWorkspaces?.(true, {
        visibleOnFullScreen: true,
        ...(context.visibleOnAllWorkspaces ? {} : { skipTransformProcessType: true })
      });
      nativeWindow.show();
      nativeWindow.focus();
      void this.electronApp?.dock?.show();
      if (!context.visibleOnAllWorkspaces) context.popout.win.setTimeout(() => {
        nativeWindow.setVisibleOnAllWorkspaces?.(false, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true
        });
      }, 120);
    } else {
      nativeWindow?.show();
      nativeWindow?.focus();
      if (!nativeWindow) context.popout.win.focus();
    }
    context.hidden = false;
    const focus = (): void => {
      nativeWindow?.focus();
      context.popout.win.focus();
      if (context.leaf.view instanceof MarkdownView) context.leaf.view.editor.focus();
    };
    context.popout.win.setTimeout(focus, 0);
    context.popout.win.setTimeout(focus, 80);
  }

  private hasOpenOverlay(doc: Document): boolean {
    return Array.from(doc.querySelectorAll<HTMLElement>(
      ".modal-container, .menu, .popover, .prompt, .document-search-container, .suggestion-container, "
        + ".suggestion-popover, .slash-command, [role='listbox']"
    )).some((element) => element.getClientRects().length > 0
      || Array.from(element.children).some((child) => child.getClientRects().length > 0));
  }

  private closeOpenDocumentSearch(doc: Document): boolean {
    const search = doc.querySelector<HTMLElement>(".document-search-container");
    if (!search || search.getClientRects().length === 0) return false;
    search.querySelector<HTMLElement>(".document-search-close-button")?.click();
    return true;
  }

  private commandManager(): ObsidianCommandManager {
    return (this.app as App & { commands: ObsidianCommandManager }).commands;
  }

  private interceptAddPropertyCommand(): void {
    const commands = this.commandManager();
    const original = commands.executeCommand;
    const wrapped = (command: Command, event?: Event): boolean => {
      const context = Array.from(this.windows).find((candidate) => candidate.popout.doc.hasFocus()) ?? null;
      const executed = original.call(commands, command, event);
      if (executed && command.id === "markdown:add-metadata-property" && context) {
        this.revealPropertiesAfterCommand(context);
      }
      return executed;
    };
    commands.executeCommand = wrapped;
    this.register(() => {
      if (commands.executeCommand === wrapped) commands.executeCommand = original;
    });
  }

  private revealPropertiesAfterCommand(context: RayNotesWindowContext, attempt = 0): void {
    context.popout.win.setTimeout(() => {
      if (!this.windows.has(context) || !(context.leaf.view instanceof MarkdownView)) return;
      const metadata = context.leaf.view.containerEl.querySelector<HTMLElement>(".metadata-container");
      if (!metadata?.querySelector(".metadata-property")) {
        if (attempt < 3) this.revealPropertiesAfterCommand(context, attempt + 1);
        return;
      }
      if (!context.popout.doc.body.hasClass("ray-notes-properties-open")) {
        this.openPropertiesOverlay(context);
      }
    }, attempt === 0 ? 0 : 50);
  }

  private async resumeWindow(): Promise<void> {
    if (!this.settings.wasOpen && !this.restoreLegacyPopout) return;

    const restored: WorkspaceLeaf[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.getContainer() instanceof WorkspaceWindow)) continue;
      const file = leaf.getViewState().state?.file;
      if (typeof file !== "string" || !file.startsWith(`${this.settings.folder}/`)) continue;
      restored.push(leaf);
    }

    if (restored.length) {
      const lastFile = this.notePath(this.settings.lastFile);
      restored.sort((a, b) => Number(b.getViewState().state?.file === lastFile)
        - Number(a.getViewState().state?.file === lastFile));
      for (let index = 0; index < restored.length; index += 1) {
        await this.adoptLeaf(restored[index], index === 0);
      }
      const primary = Array.from(this.windows).find((context) => context.primary);
      if (primary) this.activateWindow(primary);
      return;
    }
    if (!this.settings.wasOpen) return;
    await this.openWindow(false);
  }

  private async adoptLeaf(leaf: WorkspaceLeaf, primary = true): Promise<void> {
    const popout = leaf.getContainer() as WorkspaceWindow;
    const context = this.createWindowContext(leaf, popout, primary);
    this.windows.add(context);
    this.activateWindow(context);
    await leaf.loadIfDeferred();
    this.settings.wasOpen = true;
    await this.saveSettings();
    await this.prepareWindow(popout);
    if (leaf.view instanceof MarkdownView && leaf.view.file) {
      await this.openFile(leaf.view.file, true, context);
    }
    popout.win.focus();
    this.focusEditor();
  }

  private async configureNativePopout(win: Window): Promise<void> {
    const context = this.activeWindow;
    if (!context || context.popout.win !== win) return;
    try {
      win.focus();
      await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
      const popoutElectron = (win as ElectronBridgeWindow).require?.("electron");
      const mainElectron = (window as ElectronBridgeWindow).require?.("electron");
      const browserWindow = mainElectron?.remote?.BrowserWindow;
      let nativeWindow: ElectronWindow | null | undefined = popoutElectron?.remote?.getCurrentWindow();
      if (!nativeWindow || nativeWindow === this.mainWindow) {
        nativeWindow = browserWindow?.getAllWindows()
          .filter((candidate) => candidate !== this.mainWindow && candidate.getBounds)
          .map((candidate) => ({ candidate, distance: this.windowDistance(candidate, win) }))
          .filter(({ distance }) => distance <= 40)
          .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      }
      if (!nativeWindow || nativeWindow === this.mainWindow) {
        await new Promise<void>((resolve) => win.setTimeout(resolve, 50));
        nativeWindow = popoutElectron?.remote?.getCurrentWindow();
      }
      if (!nativeWindow || nativeWindow === this.mainWindow) return;

      context.nativePopout = nativeWindow;
      nativeWindow.setParentWindow?.(null);
      nativeWindow.setMovable?.(true);
      nativeWindow.setMinimumSize?.(MIN_WINDOW_WIDTH, 240);
      nativeWindow.setWindowButtonVisibility?.(false);
      nativeWindow.setAlwaysOnTop(context.alwaysOnTop, "modal-panel");
      if (IS_MACOS) {
        nativeWindow.setVisibleOnAllWorkspaces?.(context.visibleOnAllWorkspaces, {
          visibleOnFullScreen: true,
          ...(context.visibleOnAllWorkspaces ? {} : { skipTransformProcessType: true })
        });
        await this.electronApp?.dock?.show();
      }
      if (context.alwaysOnTop) nativeWindow.moveTop?.();
      this.syncWindowControls(context);
    } catch (error) {
      console.warn("Ray Notes could not configure the native popout", error);
    }
  }

  private positionTrafficLights(nativeWindow: ElectronWindow): void {
    nativeWindow.setWindowButtonPosition?.(TRAFFIC_LIGHT_POSITION);
  }

  private windowDistance(nativeWindow: ElectronWindow, win: Window): number {
    const bounds = nativeWindow.getBounds?.();
    if (!bounds) return Number.POSITIVE_INFINITY;
    return Math.abs(bounds.x - win.screenX)
      + Math.abs(bounds.y - win.screenY)
      + Math.abs(bounds.width - win.outerWidth)
      + Math.abs(bounds.height - win.outerHeight);
  }

  private isPointerInsideWindow(
    win: Window,
    doc: Document,
    nativeWindow = this.nativePopout
  ): boolean {
    const electron = (window as ElectronBridgeWindow).require?.("electron");
    const point = electron?.remote?.screen?.getCursorScreenPoint();
    const bounds = nativeWindow?.getBounds?.();
    if (!point || !bounds) return doc.documentElement.matches(":hover");
    return pointInsideBounds(point, bounds);
  }

  private createChrome(doc: Document): void {
    const context = this.activeWindow;
    if (!context) return;
    const top = doc.createElement("div");
    top.className = "ray-notes-toolbar ray-notes-toolbar-top";

    this.titleEl = doc.createElement("div");
    this.titleEl.className = "ray-notes-title";
    this.titleEl.textContent = "Untitled";
    top.append(this.titleEl);

    const topActions = doc.createElement("div");
    topActions.className = "ray-notes-toolbar-actions";
    const minimalButton = this.addToolbarButton(
      topActions, "minimize-2", "Minimal Mode", [], () => this.toggleMinimalMode(context)
    );
    minimalButton.addClass("ray-notes-minimal-mode-button");
    this.addToolbarButton(topActions, "command", "Action Panel", ["⌘", "K"], () => this.openActionPanel());
    this.addToolbarButton(topActions, "notebook", "Browse Notes", ["⌘", "P"], () => this.openSwitcher());
    this.addToolbarButton(topActions, "plus", "Create Note", ["⌘", "N"], () => void this.createAndOpenNote());
    const closePropertiesButton = this.addToolbarButton(
      topActions,
      "x",
      "Close File Properties",
      [],
      () => this.closeActiveLayer(context)
    );
    closePropertiesButton.addClass("ray-notes-properties-close");
    top.append(topActions);

    const bottom = doc.createElement("div");
    bottom.className = "ray-notes-toolbar ray-notes-toolbar-bottom";
    const bottomMain = bottom.createDiv("ray-notes-toolbar-main");
    const heading = this.addToolbarButton(bottomMain, "heading", "Heading", [], () => this.openHeadingMenu(heading));
    this.addMenuCaret(heading);
    const format = this.addToolbarButton(bottomMain, "text-cursor", "Format", [], () => this.openInlineFormatMenu(format));
    this.addMenuCaret(format);
    const link = this.addToolbarButton(bottomMain, "link", "Link", ["⌘", "L"], () => this.openLinkPopover(link));
    this.addToolbarButton(bottomMain, "code-xml", "Code", ["⌥", "⌘", "E"], () => this.wrapSelection("`"));
    bottomMain.createDiv("ray-notes-toolbar-separator");
    const codeBlock = this.addToolbarButton(bottomMain, "square-code", "Code Block", ["⌥", "⌘", "C"], () => this.openCodeBlockMenu(codeBlock));
    this.addMenuCaret(codeBlock);
    const blockquote = this.addToolbarButton(bottomMain, "text-quote", "Blockquote", ["⇧", "⌘", "B"], () => this.openBlockquoteMenu(blockquote));
    this.addMenuCaret(blockquote);
    bottomMain.createDiv("ray-notes-toolbar-separator");
    const list = this.addToolbarButton(bottomMain, "list", "List", [], () => this.openListMenu(list));
    this.addMenuCaret(list);
    const bottomTrailing = bottom.createDiv("ray-notes-toolbar-trailing");
    this.alwaysOnTopButton = this.addToolbarButton(
      bottomTrailing, "pin", "Always on Top", [], () => this.toggleAlwaysOnTop(context)
    );
    this.updateToggleButton(this.alwaysOnTopButton, context.alwaysOnTop);
    if (IS_MACOS) {
      this.workspacePinButton = this.addToolbarButton(
        bottomTrailing,
        "layers",
        "Show on All Spaces",
        [],
        () => void this.toggleWorkspacePin(context)
      );
      this.workspacePinButton.addClass("ray-notes-spaces-button");
      this.updateToggleButton(this.workspacePinButton, context.visibleOnAllWorkspaces);
    }

    doc.body.append(top, bottom);
  }

  private openPropertiesOverlay(context = this.activeWindow): void {
    if (!context || !(context.leaf.view instanceof MarkdownView)) return;
    const doc = context.popout.doc;
    const metadata = context.leaf.view.containerEl.querySelector<HTMLElement>(".metadata-container");
    if (!metadata) {
      new Notice("Ray Notes: file properties are not available in this view");
      return;
    }

    const originalParent = metadata.parentNode;
    const originalNext = metadata.nextSibling;
    const overlay = doc.body.createDiv("ray-notes-properties-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "File Properties");
    overlay.setAttribute("aria-modal", "true");
    const panel = overlay.createDiv("ray-notes-properties-panel");

    let layer: Layer;
    layer = {
      open: () => {
        doc.body.addClass("ray-notes-properties-open");
        metadata.removeClass("is-collapsed");
        metadata.addClass("ray-notes-properties-content");
        panel.append(metadata);
      },
      close: () => {
        doc.body.removeClass("ray-notes-properties-open");
        metadata.removeClass("ray-notes-properties-content");
        if (originalParent?.isConnected) {
          originalParent.insertBefore(
            metadata,
            originalNext?.parentNode === originalParent ? originalNext : null
          );
        }
        overlay.remove();
        if (context.activeLayer === layer) context.activeLayer = null;
        this.focusEditor();
      }
    };
    this.activateWindow(context);
    this.openLayer(layer);
  }

  private updateToggleButton(button: HTMLButtonElement | null, active: boolean): void {
    if (!button) return;
    button.toggleClass("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  private syncWindowControls(context: RayNotesWindowContext): void {
    const nativeWindow = context.nativePopout;
    if (!nativeWindow) return;
    context.alwaysOnTop = nativeWindow.isAlwaysOnTop?.() ?? context.alwaysOnTop;
    if (IS_MACOS && !context.hidden) {
      context.visibleOnAllWorkspaces = nativeWindow.isVisibleOnAllWorkspaces?.()
        ?? context.visibleOnAllWorkspaces;
    }
    this.updateToggleButton(context.alwaysOnTopButton, context.alwaysOnTop);
    this.updateToggleButton(context.workspacePinButton, context.visibleOnAllWorkspaces);
  }

  private toggleAlwaysOnTop(context = this.activeWindow): void {
    if (!context) return;
    context.alwaysOnTop = !(context.nativePopout?.isAlwaysOnTop?.() ?? context.alwaysOnTop);
    context.nativePopout?.setAlwaysOnTop(context.alwaysOnTop, "modal-panel");
    if (context.alwaysOnTop) context.nativePopout?.moveTop?.();
    this.updateToggleButton(context.alwaysOnTopButton, context.alwaysOnTop);
  }

  private toggleMinimalMode(context = this.activeWindow): void {
    if (!context?.nativePopout) return;
    const nativeWindow = context.nativePopout;
    if (context.minimal) {
      const current = nativeWindow.getBounds?.();
      const normal = context.normalBounds;
      nativeWindow.setFocusable?.(true);
      nativeWindow.setResizable?.(true);
      nativeWindow.setMinimumSize?.(MIN_WINDOW_WIDTH, 240);
      if (normal) {
        const screen = (context.popout.win as ElectronBridgeWindow).require?.("electron").remote?.screen
          ?? (window as ElectronBridgeWindow).require?.("electron").remote?.screen;
        const workArea = current ? screen?.getDisplayMatching?.(current).workArea : null;
        nativeWindow.setBounds?.(current && workArea
          ? fittedRestoreBounds(current, normal, workArea)
          : {
              x: current?.x ?? normal.x,
              y: current?.y ?? normal.y,
              width: normal.width,
              height: normal.height
            });
      }
      void context.popout.doc.body.offsetWidth;
      context.minimal = false;
      context.popout.doc.body.removeClass("ray-notes-minimal");
      context.minimalEl?.remove();
      context.minimalEl = null;
      context.normalBounds = null;
      void this.showWindow(context);
      return;
    }

    context.normalBounds = nativeWindow.getBounds?.() ?? {
      x: context.popout.win.screenX,
      y: context.popout.win.screenY,
      width: context.popout.win.outerWidth,
      height: context.popout.win.outerHeight
    };
    context.minimal = true;
    this.closeFloatingUi(context);
    this.closeActiveLayer(context);
    context.popout.doc.body.addClass("ray-notes-minimal");
    const preview = context.popout.doc.body.createDiv("ray-notes-minimal-card");
    preview.tabIndex = 0;
    preview.setAttribute("role", "button");
    preview.setAttribute("aria-label", "Restore Ray Notes");
    preview.createDiv("ray-notes-minimal-title");
    preview.createDiv("ray-notes-minimal-body");
    const restore = (): void => this.toggleMinimalMode(context);
    let drag: { bounds: WindowBounds; start: { x: number; y: number } } | null = null;
    let dragged = false;
    preview.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const bounds = nativeWindow.getBounds?.();
      if (!bounds) return;
      drag = { bounds, start: { x: event.screenX, y: event.screenY } };
      dragged = false;
      preview.setPointerCapture(event.pointerId);
    });
    preview.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const bounds = draggedWindowBounds(drag.bounds, drag.start, { x: event.screenX, y: event.screenY });
      if (!bounds) return;
      dragged = true;
      nativeWindow.setBounds?.(bounds);
    });
    preview.addEventListener("pointerup", () => {
      drag = null;
    });
    preview.addEventListener("pointercancel", () => { drag = null; });
    preview.addEventListener("click", () => {
      if (dragged) {
        dragged = false;
        return;
      }
      restore();
    });
    preview.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") restore();
    });
    context.minimalEl = preview;
    this.updateMinimalPreview(context);
    void preview.offsetHeight;
    nativeWindow.setWindowButtonVisibility?.(false);
    nativeWindow.setMinimumSize?.(280, 76);
    nativeWindow.setResizable?.(false);
    nativeWindow.setBounds?.({ width: 300, height: 82 });
    (context.popout.doc.activeElement as HTMLElement | null)?.blur();
    nativeWindow.setFocusable?.(false);
    nativeWindow.blur();
  }

  private updateMinimalPreview(context: RayNotesWindowContext): void {
    if (!context.minimalEl || !(context.leaf.view instanceof MarkdownView)) return;
    const preview = plainNotePreview(context.leaf.view.editor.getValue());
    context.minimalEl.querySelector<HTMLElement>(".ray-notes-minimal-title")!.textContent = preview.title;
    context.minimalEl.querySelector<HTMLElement>(".ray-notes-minimal-body")!.textContent = preview.body || "Empty note";
  }

  private async toggleWorkspacePin(context = this.activeWindow): Promise<void> {
    if (!IS_MACOS || !context) return;
    context.visibleOnAllWorkspaces = !(
      context.nativePopout?.isVisibleOnAllWorkspaces?.() ?? context.visibleOnAllWorkspaces
    );
    context.nativePopout?.setVisibleOnAllWorkspaces?.(context.visibleOnAllWorkspaces, {
      visibleOnFullScreen: true,
      ...(context.visibleOnAllWorkspaces ? {} : { skipTransformProcessType: true })
    });
    await this.electronApp?.dock?.show();
    this.settings.visibleOnAllWorkspaces = context.visibleOnAllWorkspaces;
    await this.saveSettings();
    this.updateToggleButton(context.workspacePinButton, context.visibleOnAllWorkspaces);
  }

  private addToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string | (() => string),
    shortcut: string[],
    onClick: () => void
  ): HTMLButtonElement {
    const button = parent.ownerDocument.createElement("button");
    button.className = "ray-notes-toolbar-button";
    button.type = "button";
    setIcon(button, icon);
    const getLabel = (): string => typeof label === "function" ? label() : label;
    const activateOwner = (): void => {
      const context = Array.from(this.windows).find(
        (candidate) => candidate.popout.doc === parent.ownerDocument
      );
      if (context) this.activateWindow(context);
    };
    button.createSpan({
      cls: "ray-notes-sr-only",
      text: shortcut.length ? `${getLabel()}, ${shortcut.join(" ")}` : getLabel()
    });
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    });
    const tooltipPlacement = parent.hasClass("ray-notes-toolbar-actions")
      ? "below"
      : parent.hasClass("ray-notes-toolbar-trailing")
        ? "bottom-trailing"
        : "above";
    button.addEventListener("mouseenter", () => {
      activateOwner();
      this.showTooltip(button, getLabel(), shortcut, tooltipPlacement);
    });
    button.addEventListener("mouseleave", () => this.closeTooltip());
    button.addEventListener("focus", () => this.showTooltip(button, getLabel(), shortcut, tooltipPlacement));
    button.addEventListener("blur", () => this.closeTooltip());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      activateOwner();
      this.closeTooltip();
      onClick();
    });
    parent.append(button);
    return button;
  }

  private addMenuCaret(button: HTMLButtonElement): void {
    button.addClass("ray-notes-menu-button");
    const caret = button.createSpan("ray-notes-menu-caret");
    setIcon(caret, "chevron-down");
  }

  private getEditor(): Editor | null {
    return this.leaf?.view instanceof MarkdownView ? this.leaf.view.editor : null;
  }

  private wrapSelection(before: string, after = before): void {
    const editor = this.getEditor();
    if (!editor) return;
    const edit = toggleWrapEdit(
      editor.getValue(),
      editor.posToOffset(editor.getCursor("from")),
      editor.posToOffset(editor.getCursor("to")),
      before,
      after
    );
    editor.replaceRange(edit.text, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
    const selectionFrom = editor.offsetToPos(edit.selectionFrom);
    const selectionTo = editor.offsetToPos(edit.selectionTo);
    if (edit.selectionFrom === edit.selectionTo) editor.setCursor(selectionFrom);
    else editor.setSelection(selectionFrom, selectionTo);
    editor.focus();
  }

  private prefixLine(prefix: string): void {
    const editor = this.getEditor();
    if (!editor) return;
    const cursor = editor.getCursor();
    editor.replaceRange(prefix, { line: cursor.line, ch: 0 });
    editor.setCursor({ line: cursor.line, ch: cursor.ch + prefix.length });
    editor.focus();
  }

  private openHeadingMenu(anchor: HTMLElement): void {
    this.openToolbarMenu(anchor, [1, 2, 3].map((level) => ({
      label: `Heading ${level}`,
      shortcut: ["⌥", "⌘", String(level)],
      run: () => this.setHeading(level)
    })));
  }

  private openInlineFormatMenu(anchor: HTMLElement): void {
    this.openToolbarMenu(anchor, [
      { label: "Bold", shortcut: ["⌘", "B"], run: () => this.wrapSelection("**") },
      { label: "Italic", shortcut: ["⌘", "I"], run: () => this.wrapSelection("*") },
      { label: "Strikethrough", shortcut: ["⇧", "⌘", "S"], run: () => this.wrapSelection("~~") },
      { label: "Underline", shortcut: ["⌘", "U"], run: () => this.wrapSelection("<u>", "</u>") }
    ]);
  }

  private openListMenu(anchor: HTMLElement): void {
    this.openToolbarMenu(anchor, [
      { label: "Ordered List", shortcut: ["⇧", "⌘", "7"], run: () => this.prefixLine("1. ") },
      { label: "Bullet List", shortcut: ["⇧", "⌘", "8"], run: () => this.prefixLine("- ") },
      { label: "Task List", shortcut: ["⇧", "⌘", "9"], run: () => this.prefixLine("- [ ] ") }
    ]);
  }

  private openCodeBlockMenu(anchor: HTMLElement): void {
    this.openToolbarMenu(anchor, [
      ["Plain Text", ""], ["JavaScript", "javascript"], ["TypeScript", "typescript"],
      ["JSON", "json"], ["HTML", "html"], ["CSS", "css"], ["Bash", "bash"],
      ["Python", "python"], ["Java", "java"], ["C++", "cpp"], ["Go", "go"],
      ["Rust", "rust"], ["SQL", "sql"], ["Markdown", "markdown"]
    ].map(([label, language]) => ({
      label,
      shortcut: [],
      run: () => this.setCodeBlockLanguage(language)
    })), true);
  }

  private openBlockquoteMenu(anchor: HTMLElement): void {
    this.openToolbarMenu(anchor, [
      { label: "Blockquote", shortcut: [], run: () => this.prefixLine("> ") },
      ...["note", "info", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote"]
        .map((type) => ({
          label: `Callout: ${type[0].toUpperCase()}${type.slice(1)}`,
          shortcut: [],
          run: () => this.setCalloutType(type)
        }))
    ], true);
  }

  private openToolbarMenu(
    anchor: HTMLElement,
    items: Array<{ label: string; shortcut: string[]; run: () => void }>,
    dense = false
  ): void {
    const menu = this.createFloatingUi(
      anchor.ownerDocument,
      `ray-notes-toolbar-menu${dense ? " ray-notes-toolbar-menu-dense" : ""}`
    );
    for (const action of items) {
      const item = menu.createEl("button", { cls: "ray-notes-menu-row", type: "button" });
      item.createSpan({ text: action.label });
      appendKeycaps(item, action.shortcut);
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
        action.run();
        this.closeFloatingUi();
      });
    }
    this.positionFloating(menu, anchor.getBoundingClientRect(), "above");
  }

  private setCodeBlockLanguage(language: string): void {
    const editor = this.getEditor();
    if (!editor) return;
    const cursor = editor.getCursor();
    const lines = Array.from({ length: editor.lineCount() }, (_, line) => editor.getLine(line));
    const openingLine = codeFenceOpeningLine(lines, cursor.line);
    if (openingLine !== null) {
      const current = editor.getLine(openingLine);
      const indent = current.match(/^\s*/)?.[0] ?? "";
      editor.replaceRange(`${indent}\`\`\`${language}`, { line: openingLine, ch: 0 }, { line: openingLine, ch: current.length });
      editor.focus();
      return;
    }
    this.wrapSelection(`\`\`\`${language}\n`, "\n```");
  }

  private setCalloutType(type: string): void {
    const editor = this.getEditor();
    if (!editor) return;
    const cursor = editor.getCursor();
    const lines = Array.from({ length: editor.lineCount() }, (_, line) => editor.getLine(line));
    const headerLine = calloutHeaderLine(lines, cursor.line);
    if (headerLine !== null) {
      const current = editor.getLine(headerLine);
      const next = current.replace(/\[![^\]]+\]/, `[!${type}]`);
      editor.replaceRange(next, { line: headerLine, ch: 0 }, { line: headerLine, ch: current.length });
      editor.focus();
      return;
    }
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const selection = editor.getSelection();
    const body = selection ? selection.split("\n").map((line) => `> ${line}`).join("\n") : "> ";
    editor.replaceRange(`> [!${type}]\n${body}`, from, to);
    editor.setCursor({ line: from.line + 1, ch: selection ? 2 : 2 });
    editor.focus();
  }

  private setHeading(level: number): void {
    const editor = this.getEditor();
    if (!editor) return;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const edit = headingEdit(line, cursor.ch, level);
    editor.replaceRange(edit.prefix, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: edit.replaceEnd });
    editor.setCursor({ line: cursor.line, ch: edit.cursorCh });
    editor.focus();
  }

  private openLinkPopover(anchor?: HTMLElement): void {
    const editor = this.getEditor();
    if (!editor) return;
    const selectedText = editor.getSelection();
    if (!selectedText) {
      new Notice("Ray Notes: select text before adding a link");
      return;
    }

    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const originalLines = Array.from(
      { length: to.line - from.line + 1 },
      (_, index) => editor.getLine(from.line + index)
    );
    const doc = this.popout?.doc;
    if (!doc) return;
    const popover = this.createFloatingUi(doc, "ray-notes-link-popover");
    const restoreOriginalLines = (): void => {
      originalLines.forEach((before, index) => {
        const line = from.line + index;
        const after = editor.getLine(line);
        const restored = restoreUnexpectedTaskPrefix(before, after);
        if (restored !== after) {
          editor.replaceRange(restored, { line, ch: 0 }, { line, ch: after.length });
        }
      });
    };
    const restoreExactOriginalLines = (): void => {
      originalLines.forEach((before, index) => {
        const line = from.line + index;
        const after = editor.getLine(line);
        if (after !== before) {
          editor.replaceRange(before, { line, ch: 0 }, { line, ch: after.length });
        }
      });
    };
    doc.defaultView?.queueMicrotask(restoreOriginalLines);
    doc.defaultView?.setTimeout(restoreOriginalLines, 50);
    doc.defaultView?.setTimeout(restoreOriginalLines, 150);
    const input = popover.createEl("input", {
      attr: { "aria-label": "Link URL", placeholder: "Enter link", type: "url" }
    });
    const apply = popover.createEl("button", { attr: { "aria-label": "Apply link" }, type: "button" });
    setIcon(apply, "check");
    const cancel = popover.createEl("button", { attr: { "aria-label": "Cancel" }, type: "button" });
    setIcon(cancel, "x");
    const imeGuard = new ImeInputGuard(input, false);
    let submitAfterComposition = false;

    const applyLink = (): void => {
      const url = input.value.trim();
      if (!url) return;
      const focusDelay = imeGuard.focusDelay();
      restoreOriginalLines();
      editor.replaceRange(`[${selectedText}](${url})`, from, to);
      const contentStart = advancePosition(from, "[");
      editor.setSelection(contentStart, advancePosition(contentStart, selectedText));
      this.closeFloatingUi();
      doc.defaultView?.setTimeout(() => editor.focus(), focusDelay);
    };
    const suppressMouseDown = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    };
    apply.addEventListener("mousedown", suppressMouseDown);
    cancel.addEventListener("mousedown", suppressMouseDown);
    apply.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      applyLink();
    });
    cancel.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      restoreExactOriginalLines();
      this.closeFloatingUi();
      const focusDelay = imeGuard.focusDelay();
      doc.defaultView?.setTimeout(() => {
        restoreExactOriginalLines();
        editor.setSelection(from, to);
        editor.focus();
      }, focusDelay);
    });
    const handleLinkKey = (event: KeyboardEvent): void => {
      if (event.target !== input || (event.key !== "Enter" && event.key !== "Escape")) return;
      if (event.key === "Enter" && imeGuard.isCompositionActive(event)) {
        submitAfterComposition = true;
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape" && imeGuard.isPending(event)) {
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (event.key === "Enter") {
        if (!input.value.trim()) return;
        input.disabled = true;
        applyLink();
      } else {
        const focusDelay = imeGuard.focusDelay();
        input.value = "";
        input.blur();
        restoreExactOriginalLines();
        this.closeFloatingUi();
        doc.defaultView?.setTimeout(() => {
          restoreExactOriginalLines();
          editor.setSelection(from, to);
          editor.focus();
        }, focusDelay);
      }
    };
    const handleLinkCompositionEnd = (): void => {
      if (!submitAfterComposition) return;
      submitAfterComposition = false;
      doc.defaultView?.queueMicrotask(() => {
        if (!input.isConnected || !input.value.trim()) return;
        input.disabled = true;
        applyLink();
      });
    };
    const popoutWindow = doc.defaultView;
    const previousCleanup = this.floatingCleanup;
    popoutWindow?.addEventListener("keydown", handleLinkKey, true);
    input.addEventListener("compositionend", handleLinkCompositionEnd);
    this.floatingCleanup = () => {
      popoutWindow?.removeEventListener("keydown", handleLinkKey, true);
      input.removeEventListener("compositionend", handleLinkCompositionEnd);
      imeGuard.destroy();
      previousCleanup?.();
    };

    const selection = doc.getSelection();
    const selectionRect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const fallbackRect = anchor?.getBoundingClientRect();
    this.positionFloating(popover, selectionRect?.width ? selectionRect : fallbackRect, "below");
    input.focus();
  }

  private showTooltip(
    anchor: HTMLElement,
    label: string,
    shortcut: string[],
    placement: "above" | "below" | "bottom-trailing"
  ): void {
    if (this.floatingUi && !this.floatingUi.hasClass("ray-notes-tooltip")) return;
    this.closeTooltip();
    const tooltip = anchor.ownerDocument.createElement("div");
    tooltip.className = "ray-notes-tooltip";
    tooltip.createSpan({ text: label });
    appendKeycaps(tooltip, shortcut);
    anchor.ownerDocument.body.append(tooltip);
    this.floatingUi = tooltip;
    this.positionFloating(tooltip, anchor.getBoundingClientRect(), placement);
  }

  private closeTooltip(): void {
    if (this.floatingUi?.hasClass("ray-notes-tooltip")) this.closeFloatingUi();
  }

  private createFloatingUi(doc: Document, className: string): HTMLElement {
    const context = this.activeWindow;
    if (!context) return doc.createElement("div");
    this.closeActiveLayer(context);
    this.closeFloatingUi(context);
    const floating = doc.createElement("div");
    floating.className = `ray-notes-popover ${className}`;
    doc.body.append(floating);
    this.floatingUi = floating;

    const closeOnOutside = (event: PointerEvent): void => {
      if (!floating.contains(event.target as Node)) this.closeFloatingUi(context);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.closeFloatingUi(context);
    };
    const timer = window.setTimeout(() => doc.addEventListener("pointerdown", closeOnOutside, true));
    doc.addEventListener("keydown", closeOnEscape, true);
    this.floatingCleanup = () => {
      window.clearTimeout(timer);
      doc.removeEventListener("pointerdown", closeOnOutside, true);
      doc.removeEventListener("keydown", closeOnEscape, true);
    };
    return floating;
  }

  private positionFloating(
    element: HTMLElement,
    anchor: DOMRect | undefined,
    placement: "above" | "below" | "bottom-trailing"
  ): void {
    const win = element.ownerDocument.defaultView;
    if (!win) return;
    if (placement === "bottom-trailing") {
      const edge = 12;
      const expandedGroupHeight = 64;
      const gap = 10;
      element.style.left = `${Math.max(edge, win.innerWidth - element.offsetWidth - edge)}px`;
      element.style.top = `${Math.max(
        edge,
        win.innerHeight - edge - expandedGroupHeight - gap - element.offsetHeight
      )}px`;
      return;
    }
    const rect = anchor ?? new DOMRect(win.innerWidth / 2, win.innerHeight / 2, 0, 0);
    const gap = 10;
    const left = Math.min(
      win.innerWidth - element.offsetWidth - 12,
      Math.max(12, rect.left + rect.width / 2 - element.offsetWidth / 2)
    );
    const proposedTop = placement === "above"
      ? rect.top - element.offsetHeight - gap
      : rect.bottom + gap;
    const top = Math.min(win.innerHeight - element.offsetHeight - 12, Math.max(12, proposedTop));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  private closeFloatingUi(context = this.activeWindow): void {
    if (!context) return;
    context.floatingCleanup?.();
    context.floatingCleanup = null;
    context.floatingUi?.remove();
    context.floatingUi = null;
  }

  private openLayer(layer: Layer): void {
    this.closeFloatingUi();
    this.closeActiveLayer();
    this.activeLayer = layer;
    layer.open();
  }

  private closeActiveLayer(context = this.activeWindow): void {
    if (!context) return;
    const layer = context.activeLayer;
    context.activeLayer = null;
    layer?.close();
  }

  private updateDerivedTitle(
    editor: Editor,
    context = this.activeWindow
  ): void {
    if (!context) return;
    const file = context.leaf.view instanceof MarkdownView ? context.leaf.view.file : null;
    if (file && this.movingIntoFolder.has(file.path)) {
      if (context.renameTimer !== null) context.popout.win.clearTimeout(context.renameTimer);
      context.renameTimer = null;
      if (context.titleEl) context.titleEl.textContent = file.basename;
      return;
    }
    const title = titleFromLines(editor.getValue().split("\n"));
    if (context.titleEl) context.titleEl.textContent = title;
    if (context.renameTimer !== null) context.popout.win.clearTimeout(context.renameTimer);
    context.renameTimer = context.popout.win.setTimeout(() => {
      context.renameTimer = null;
      void this.renameCurrentNote(title, context);
    }, 900);
  }

  private async renameCurrentNote(
    title: string,
    context = this.activeWindow
  ): Promise<void> {
    if (!context) return;
    const view = context.leaf.view;
    if (!(view instanceof MarkdownView) || !view.file || !this.isInFolder(view.file)) return;
    const file = view.file;
    const baseName = safeFileName(title);
    if (baseName === "Untitled" && /^Untitled(?: \d+)?$/.test(file.basename)) return;
    if (file.basename === baseName) return;

    let suffix = 1;
    let path = normalizePath(`${this.settings.folder}/${baseName}.md`);
    let collision = this.app.vault.getAbstractFileByPath(path);
    while (collision && collision !== file) {
      suffix += 1;
      path = normalizePath(`${this.settings.folder}/${baseName} ${suffix}.md`);
      collision = this.app.vault.getAbstractFileByPath(path);
    }

    if (file.path === path) return;

    const oldPath = file.path;
    const oldKey = this.noteKey(oldPath);
    await this.app.fileManager.renameFile(file, path);
    context.history = context.history.map((item) => (item === oldPath ? file.path : item));
    const newKey = this.noteKey(file.path);
    const pinnedPathChanged = this.settings.pinnedNotes.includes(oldKey);
    this.settings.pinnedNotes = this.settings.pinnedNotes.map((item) => item === oldKey ? newKey : item);
    if (this.settings.lastOpened[oldKey]) {
      this.settings.lastOpened[newKey] = this.settings.lastOpened[oldKey];
      delete this.settings.lastOpened[oldKey];
    }
    if (context.primary) this.settings.lastFile = newKey;
    if (context.primary || pinnedPathChanged) await this.saveSettings();
  }

  updateGlobalShortcutRegistration(): boolean {
    return this.registerGlobalShortcut();
  }

  beginGlobalShortcutRecording(): void {
    this.unregisterGlobalShortcut();
  }

  endGlobalShortcutRecording(registerSavedShortcut: boolean): boolean {
    return !registerSavedShortcut || this.registerGlobalShortcut();
  }

  applyAppearance(): void {
    for (const context of this.windows) this.applyAppearanceToWindow(context);
  }

  private applyAppearanceToWindow(context: RayNotesWindowContext): void {
    const doc = context.popout.doc;
    const body = doc?.body;
    const translucent = this.settings.translucentWindow;
    body?.toggleClass("ray-notes-raycast-style", this.settings.raycastStyle);
    body?.toggleClass("ray-notes-translucent", translucent);
    body?.toggleClass("is-translucent", translucent);
    doc?.documentElement.toggleClass("ray-notes-translucent", translucent);
    try {
      context.nativePopout?.setOpacity?.(1);
      context.nativePopout?.setBackgroundColor?.(
        translucent ? "#00000000" : this.settings.raycastStyle ? "#111113" : "#1e1e1e"
      );
      context.nativePopout?.setVibrancy?.(translucent ? "under-window" : null);
    } catch (error) {
      console.warn("Ray Notes could not update window appearance", error);
    }
  }

  private openActionPanel(): void {
    const view = this.leaf?.view;
    const context = this.activeWindow;
    const canNavigateBack = this.hasNavigationTarget(-1, context);
    const canNavigateForward = this.hasNavigationTarget(1, context);
    const actions: ActionItem[] = [
      {
        icon: "plus",
        label: "Create Note",
        shortcut: ["⌘", "N"],
        run: () => void this.createAndOpenNote()
      },
      {
        icon: "copy-plus",
        label: "Duplicate Note",
        shortcut: ["⌘", "D"],
        run: () => void this.duplicateCurrentNote()
      },
      {
        icon: "notebook",
        label: "Browse Notes",
        shortcut: ["⌘", "P"],
        run: () => this.openSwitcher()
      },
      {
        icon: "panels-top-left",
        label: "Open Note in New Window",
        shortcut: ["⌥", "⌘", "N"],
        run: () => {
          const context = this.activeWindow;
          const file = context?.leaf.view instanceof MarkdownView ? context.leaf.view.file : null;
          if (file && context) void this.openFileInNewWindow(file, context);
        }
      },
      {
        icon: "minimize-2",
        label: "Minimal Mode",
        shortcut: [],
        run: () => this.toggleMinimalMode(context)
      },
      {
        icon: "arrow-left",
        label: "Previous Note",
        shortcut: ["⌘", "["],
        disabled: !canNavigateBack,
        run: () => void this.navigate(-1, context)
      },
      {
        icon: "arrow-right",
        label: "Next Note",
        shortcut: ["⌘", "]"],
        disabled: !canNavigateForward,
        run: () => void this.navigate(1, context)
      },
      {
        icon: "search",
        label: "Find in Note",
        shortcut: ["⌘", "F"],
        run: () => {
          if (view instanceof MarkdownView) view.showSearch();
        }
      },
      {
        icon: "clipboard-copy",
        label: "Copy Note as Markdown",
        shortcut: ["⇧", "⌘", "C"],
        dividerBefore: true,
        run: () => void this.copyCurrentNote()
      },
      {
        icon: "link",
        label: "Copy Deeplink",
        shortcut: ["⇧", "⌘", "D"],
        run: () => void this.copyDeeplink()
      },
      {
        icon: "text-cursor-input",
        label: "Format...",
        shortcut: ["⇧", "⌘", ","],
        run: () => this.openFormatPanel()
      },
      {
        icon: this.formatBarHidden ? "panel-bottom-open" : "panel-bottom-close",
        label: this.formatBarHidden ? "Show Format Bar" : "Hide Format Bar",
        shortcut: ["⌥", "⌘", ","],
        run: () => this.toggleFormatBar()
      },
      {
        icon: "zoom-in",
        label: "Zoom In",
        shortcut: ["⌘", "="],
        dividerBefore: true,
        run: () => this.changeZoom(0.1)
      },
      {
        icon: "zoom-out",
        label: "Zoom Out",
        shortcut: ["⌘", "-"],
        run: () => this.changeZoom(-0.1)
      },
      {
        icon: this.contentProtected ? "screen-share" : "screen-share-off",
        label: this.contentProtected ? "Show While Screen Sharing" : "Hide While Screen Sharing",
        shortcut: ["⇧", "⌘", "H"],
        run: () => this.toggleContentProtection()
      },
      {
        icon: "settings",
        label: "Open Ray Notes Settings",
        shortcut: ["⌘", ","],
        run: () => this.openSettings()
      },
      {
        icon: "trash-2",
        label: "Delete Note",
        shortcut: ["⌃", "X"],
        dividerBefore: true,
        run: () => void this.deleteCurrentNote()
      }
    ];
    let panel: ActionPanel;
    panel = new ActionPanel(this.app, actions, (chosen, focusDelay) => {
      if (this.activeLayer === panel) this.activeLayer = null;
      if (!chosen) this.focusEditorAfter(focusDelay);
    });
    this.openLayer(panel);
  }

  private openFormatPanel(): void {
    const actions: ActionItem[] = [
      ...[1, 2, 3].map((level) => ({
        icon: `heading-${level}`,
        label: `Heading ${level}`,
        shortcut: ["⌥", "⌘", String(level)],
        run: () => this.setHeading(level)
      })),
      { icon: "bold", label: "Bold", shortcut: ["⌘", "B"], run: () => this.wrapSelection("**") },
      { icon: "italic", label: "Italic", shortcut: ["⌘", "I"], run: () => this.wrapSelection("*") },
      { icon: "strikethrough", label: "Strikethrough", shortcut: ["⇧", "⌘", "S"], run: () => this.wrapSelection("~~") },
      { icon: "underline", label: "Underline", shortcut: ["⌘", "U"], run: () => this.wrapSelection("<u>", "</u>") },
      { icon: "code-xml", label: "Code", shortcut: ["⌥", "⌘", "E"], run: () => this.wrapSelection("`") }
    ];
    let panel: ActionPanel;
    panel = new ActionPanel(this.app, actions, (chosen, focusDelay) => {
      if (this.activeLayer === panel) this.activeLayer = null;
      if (!chosen) this.focusEditorAfter(focusDelay);
    });
    this.openLayer(panel);
  }

  private async openSwitcher(): Promise<void> {
    const files = this.getFiles();
    if (!files.length) {
      new Notice("Ray Notes: no notes found");
      return;
    }
    const source = this.activeWindow;
    const currentPath = source?.leaf.view instanceof MarkdownView ? source.leaf.view.file?.path : null;
    if (currentPath) {
      this.settings.lastOpened[this.noteKey(currentPath)] = Date.now();
      void this.saveSettings();
    }
    const pinned = new Set(this.settings.pinnedNotes);
    const contents = await Promise.all(files.map((file) => this.app.vault.cachedRead(file).catch(() => "")));
    const items = files.map<NoteItem>((file, index) => {
      const label = file.path.slice(this.settings.folder.length + 1, -file.extension.length - 1);
      return {
        file,
        content: contents[index],
        searchText: `${label}\n${contents[index]}`,
        current: file.path === currentPath,
        pinned: pinned.has(this.noteKey(file.path)),
        openedAt: this.settings.lastOpened[this.noteKey(file.path)],
        section: pinned.has(this.noteKey(file.path)) ? "Pinned" : "Notes",
        sectionStart: false
      };
    });

    let switcher: NoteSwitcher;
    switcher = new NoteSwitcher(
      this.app,
      items,
      this.settings.folder,
      (file, openInNewWindow) => {
        if (openInNewWindow) void this.openFileInNewWindow(file, source);
        else if (file.path !== currentPath) void this.openFile(file, true, source);
        else source?.popout.win.setTimeout(() => {
          if (source.leaf.view instanceof MarkdownView) source.leaf.view.editor.focus();
        }, 0);
      },
      (file) => this.togglePinnedNote(file),
      (file) => this.deleteNoteFromSwitcher(file, source),
      (chosen, focusDelay) => {
        if (this.activeLayer === switcher) this.activeLayer = null;
        if (source) source.escapeSuppressedUntil = Date.now() + 250;
        if (!chosen) this.focusEditorAfter(focusDelay);
      }
    );
    this.openLayer(switcher);
  }

  private async togglePinnedNote(file: TFile): Promise<boolean> {
    const pinned = new Set(this.settings.pinnedNotes);
    const key = this.noteKey(file.path);
    if (pinned.has(key)) pinned.delete(key);
    else pinned.add(key);
    this.settings.pinnedNotes = Array.from(pinned);
    await this.saveSettings();
    return pinned.has(key);
  }

  private async deleteNoteFromSwitcher(
    file: TFile,
    context = this.activeWindow
  ): Promise<boolean> {
    const win = context?.popout.win;
    if (!win?.confirm(`Delete “${file.basename}”?`)) return false;
    const deletingCurrent = context?.leaf.view instanceof MarkdownView
      && context.leaf.view.file?.path === file.path;
    await this.app.fileManager.trashFile(file);
    const key = this.noteKey(file.path);
    this.settings.pinnedNotes = this.settings.pinnedNotes.filter((path) => path !== key);
    delete this.settings.lastOpened[key];
    await this.saveSettings();
    if (deletingCurrent && context) {
      const next = this.getFiles()[0] ?? await this.createNote();
      await this.openFile(next, true, context);
    }
    return true;
  }

  private async createAndOpenNote(): Promise<void> {
    await this.openFile(await this.createNote());
    this.focusEditor();
  }

  private async openFileInNewWindow(
    file: TFile,
    origin = this.activeWindow
  ): Promise<void> {
    const originWindow = origin?.popout.win;
    const bounds = {
      x: (originWindow?.screenX ?? this.settings.bounds.x) + 24,
      y: (originWindow?.screenY ?? this.settings.bounds.y) + 24,
      width: Math.max(MIN_WINDOW_WIDTH, originWindow?.outerWidth ?? this.settings.bounds.width),
      height: originWindow?.outerHeight ?? this.settings.bounds.height
    };
    const leaf = this.app.workspace.openPopoutLeaf({
      x: bounds.x,
      y: bounds.y,
      size: { width: bounds.width, height: bounds.height }
    });
    const popout = leaf.getContainer() as WorkspaceWindow;
    const context = this.createWindowContext(leaf, popout, false);
    this.windows.add(context);
    this.activateWindow(context);
    try {
      await this.prepareWindow(popout);
      await this.openFile(file, true, context);
      this.activateWindow(context);
      popout.win.focus();
      if (context.leaf.view instanceof MarkdownView) context.leaf.view.editor.focus();
    } catch (error) {
      context.leaf.detach();
      this.windows.delete(context);
      this.activeWindow = origin && this.windows.has(origin) ? origin : Array.from(this.windows)[0] ?? null;
      new Notice(`Ray Notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private focusEditorAfter(delay: number): void {
    const context = this.activeWindow;
    context?.popout.win.setTimeout(() => {
      if (!context.activeLayer && !context.floatingUi) {
        this.activateWindow(context);
        this.focusEditor();
      }
    }, delay);
  }

  private async duplicateCurrentNote(): Promise<void> {
    const file = this.leaf?.view instanceof MarkdownView ? this.leaf.view.file : null;
    if (!file) return;
    const content = await this.app.vault.read(file);
    let suffix = 1;
    let path: string;
    do {
      const name = suffix === 1 ? `${file.basename} copy` : `${file.basename} copy ${suffix}`;
      path = normalizePath(`${this.settings.folder}/${name}.md`);
      suffix += 1;
    } while (this.app.vault.getAbstractFileByPath(path));
    await this.openFile(await this.app.vault.create(path, content));
    this.focusEditor();
  }

  private async copyCurrentNote(): Promise<void> {
    const file = this.leaf?.view instanceof MarkdownView ? this.leaf.view.file : null;
    const clipboard = this.popout?.win.navigator.clipboard;
    if (!file || !clipboard) return;
    await clipboard.writeText(await this.app.vault.read(file));
    new Notice("Ray Notes: note copied as Markdown");
  }

  private async copyDeeplink(): Promise<void> {
    const file = this.leaf?.view instanceof MarkdownView ? this.leaf.view.file : null;
    const clipboard = this.popout?.win.navigator.clipboard;
    if (!file || !clipboard) return;
    const url = `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(file.path)}`;
    await clipboard.writeText(url);
    new Notice("Ray Notes: deeplink copied");
  }

  private toggleFormatBar(): void {
    this.formatBarHidden = !this.formatBarHidden;
    this.popout?.doc.body.toggleClass("ray-notes-format-bar-hidden", this.formatBarHidden);
  }

  private changeZoom(delta: number): void {
    const contents = this.nativePopout?.webContents;
    if (!contents) return;
    contents.setZoomFactor(Math.min(2, Math.max(0.5, contents.getZoomFactor() + delta)));
  }

  private toggleContentProtection(): void {
    this.contentProtected = !this.contentProtected;
    this.nativePopout?.setContentProtection?.(this.contentProtected);
    new Notice(this.contentProtected
      ? "Ray Notes: hidden from screen capture"
      : "Ray Notes: visible in screen capture");
  }

  private openSettings(): void {
    this.mainWindow?.restore();
    this.mainWindow?.show();
    this.mainWindow?.focus();
    const setting = (this.app as AppWithSettings).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  private async deleteCurrentNote(): Promise<void> {
    const file = this.leaf?.view instanceof MarkdownView ? this.leaf.view.file : null;
    const win = this.popout?.win;
    if (!file || !win?.confirm(`Delete “${file.basename}”?`)) return;
    const key = this.noteKey(file.path);
    await this.app.fileManager.trashFile(file);
    this.settings.pinnedNotes = this.settings.pinnedNotes.filter((path) => path !== key);
    delete this.settings.lastOpened[key];
    await this.saveSettings();
    const next = this.getFiles()[0] ?? await this.createNote();
    await this.openFile(next);
    this.focusEditor();
  }

  private async redirectFile(file: TFile): Promise<void> {
    this.redirectingFile = true;
    try {
      await this.openWindow(false);
      await this.openFile(file);
      this.focusEditor();
    } finally {
      this.redirectingFile = false;
    }
  }

  private async prepareMovedNote(file: TFile, oldPath: string): Promise<void> {
    const folderPrefix = `${this.settings.folder}/`;
    if (oldPath.startsWith(folderPrefix) || !file.path.startsWith(folderPrefix)) return;
    const content = await this.app.vault.read(file);
    const updated = withHeadingTitle(content, file.basename);
    if (updated !== content) await this.app.vault.modify(file, updated);
  }

  private migrateNotePath(newPath: string, oldPath: string): void {
    const remainsInFolder = newPath.startsWith(`${this.settings.folder}/`);
    for (const context of this.windows) {
      context.history = remainsInFolder
        ? context.history.map((path) => path === oldPath ? newPath : path)
        : context.history.filter((path) => path !== oldPath);
    }
    const oldKey = this.noteKey(oldPath);
    const newKey = this.noteKey(newPath);
    this.settings.pinnedNotes = remainsInFolder
      ? this.settings.pinnedNotes.map((path) => path === oldKey ? newKey : path)
      : this.settings.pinnedNotes.filter((path) => path !== oldKey);
    if (this.settings.lastOpened[oldKey]) {
      if (remainsInFolder) this.settings.lastOpened[newKey] = this.settings.lastOpened[oldKey];
      delete this.settings.lastOpened[oldKey];
    }
    if (this.settings.lastFile === oldKey) this.settings.lastFile = remainsInFolder ? newKey : "";
    void this.saveSettings();
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

  private async openFile(
    file: TFile,
    recordHistory = true,
    context = this.activeWindow
  ): Promise<void> {
    if (!context) return;
    await context.leaf.openFile(file, { active: true, state: { mode: "source" } });
    if (context.leaf.view instanceof MarkdownView) {
      this.updateDerivedTitle(context.leaf.view.editor, context);
      this.updateMinimalPreview(context);
    }
    const key = this.noteKey(file.path);
    if (context.primary) this.settings.lastFile = key;
    this.settings.lastOpened[key] = Date.now();

    if (recordHistory) {
      context.history = [];
      context.historyIndex = -1;
    }
    await this.saveSettings();
  }

  private async navigate(offset: number, context = this.activeWindow): Promise<void> {
    if (!context) return;
    if (!context.history.length) {
      context.history = this.getFiles().map((file) => file.path);
      const currentPath = context.leaf.view instanceof MarkdownView ? context.leaf.view.file?.path : null;
      context.historyIndex = currentPath ? context.history.indexOf(currentPath) : -1;
    }
    const next = context.historyIndex + offset;
    if (next < 0 || next >= context.history.length) return;
    const file = this.app.vault.getAbstractFileByPath(context.history[next]);
    if (!(file instanceof TFile)) {
      context.history.splice(next, 1);
      await this.navigate(offset, context);
      return;
    }
    context.historyIndex = next;
    await this.openFile(file, false, context);
  }

  private hasNavigationTarget(offset: number, context = this.activeWindow): boolean {
    if (!context) return false;
    const paths = context.history.length ? context.history : this.getFiles().map((file) => file.path);
    const currentPath = context.leaf.view instanceof MarkdownView ? context.leaf.view.file?.path : null;
    const index = context.history.length ? context.historyIndex : currentPath ? paths.indexOf(currentPath) : -1;
    return index + offset >= 0 && index + offset < paths.length;
  }

  private focusEditor(): void {
    if (this.leaf?.view instanceof MarkdownView) this.leaf.view.editor.focus();
  }

  private getInitialFile(): TFile | null {
    const last = this.settings.lastFile
      ? this.app.vault.getAbstractFileByPath(this.notePath(this.settings.lastFile))
      : null;
    if (last instanceof TFile && this.isInFolder(last)) return last;
    return this.getFiles()[0] ?? null;
  }

  private getFiles(): TFile[] {
    return sortNotePaths(
      this.app.vault.getMarkdownFiles().filter((file) => this.isInFolder(file)),
      this.settings.lastOpened,
      (file) => this.noteKey(file.path)
    );
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
    const context = this.activeWindow;
    if (!context || !context.primary) return;
    if (this.saveBoundsTimer !== null) window.clearTimeout(this.saveBoundsTimer);
    this.saveBoundsTimer = window.setTimeout(() => {
      this.captureBounds();
      this.saveBoundsTimer = null;
    }, 300);
  }

  private captureBounds(): void {
    const context = this.activeWindow;
    const win = context?.popout.win;
    if (!win || !context.primary || context.minimal) return;
    this.settings.bounds = {
      x: win.screenX,
      y: win.screenY,
      width: win.outerWidth,
      height: win.outerHeight
    };
    void this.saveSettings();
  }
}

class RayNotesSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: RayNotesPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    const support = this.containerEl.createDiv("ray-notes-support-banner");
    const supportIcon = support.createDiv("ray-notes-support-icon");
    setIcon(supportIcon, "coffee");
    const supportCopy = support.createDiv("ray-notes-support-copy");
    supportCopy.createDiv({ cls: "ray-notes-support-title", text: "Support Ray Notes" });
    supportCopy.createDiv({
      cls: "ray-notes-support-description",
      text: "If Ray Notes helps your workflow, you can support its development on Ko-fi."
    });
    const supportLink = support.createEl("a", {
      cls: "ray-notes-support-link",
      href: SUPPORT_URL,
      text: "Open Ko-fi"
    });
    supportLink.target = "_blank";
    supportLink.rel = "noopener";

    new Setting(this.containerEl)
      .setName("Notes folder")
      .setDesc("Ray Notes only lists and creates Markdown files in this folder.")
      .addText((text) =>
        text
          .setPlaceholder("Ray Notes")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = normalizePath(value.trim());
            await this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Always on top")
      .setDesc("Default Always on Top state for newly created Ray Notes windows.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.alwaysOnTop).onChange(async (value) => {
          this.plugin.settings.alwaysOnTop = value;
          await this.plugin.saveSettings();
        })
      );

    if (IS_MACOS) {
      new Setting(this.containerEl)
        .setName("Show on All Spaces")
        .setDesc("Default All Spaces state for newly created Ray Notes windows.")
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.visibleOnAllWorkspaces).onChange(async (value) => {
            this.plugin.settings.visibleOnAllWorkspaces = value;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(this.containerEl)
      .setName("Enable global shortcut")
      .setDesc("Show or hide the primary Ray Notes window from any app.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.globalShortcutEnabled).onChange(async (value) => {
          this.plugin.settings.globalShortcutEnabled = value;
          this.plugin.updateGlobalShortcutRegistration();
          await this.plugin.saveSettings();
        })
      );

    const shortcutSetting = new Setting(this.containerEl)
      .setName("Global shortcut")
      .setDesc("Press a shortcut with at least one modifier. Esc cancels recording.");
    const shortcutStatus = shortcutSetting.descEl.createDiv("ray-notes-shortcut-status");
    shortcutSetting.addButton((button) => {
        let recording = false;
        const win = button.buttonEl.ownerDocument.defaultView;
        const setStatus = (text: string, error = false): void => {
          shortcutStatus.setText(text);
          shortcutStatus.toggleClass("is-error", error);
        };
        const finishRecording = (): void => {
          if (!recording) return;
          recording = false;
          win?.removeEventListener("keydown", captureShortcut, true);
          button.setButtonText(this.plugin.settings.globalShortcut);
        };
        const captureShortcut = (event: KeyboardEvent): void => {
          if (!recording) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          if (event.key === "Escape") {
            finishRecording();
            this.plugin.endGlobalShortcutRecording(true);
            setStatus("Recording canceled.");
            button.buttonEl.blur();
            return;
          }
          const accelerator = shortcutAccelerator({
            code: event.code,
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            platform: process.platform
          });
          if (!accelerator) {
            if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
              setStatus("Now press another key.");
            } else {
              setStatus("Include Command, Option, Control, or Shift.", true);
            }
            return;
          }
          const previousShortcut = this.plugin.settings.globalShortcut;
          this.plugin.settings.globalShortcut = accelerator;
          finishRecording();
          if (this.plugin.endGlobalShortcutRecording(true)) {
            void this.plugin.saveSettings();
            setStatus("Shortcut registered.");
          } else {
            this.plugin.settings.globalShortcut = previousShortcut;
            this.plugin.updateGlobalShortcutRegistration();
            button.setButtonText(previousShortcut);
            setStatus("Could not register this shortcut. It may already be in use.", true);
          }
          button.buttonEl.blur();
        };
        button
          .setButtonText(this.plugin.settings.globalShortcut)
          .setTooltip("Record global shortcut")
          .onClick(() => {
            if (recording) return;
            recording = true;
            this.plugin.beginGlobalShortcutRecording();
            button.setButtonText("Press shortcut…");
            setStatus("Press shortcut…");
            button.buttonEl.focus();
            win?.addEventListener("keydown", captureShortcut, true);
          });
        button.buttonEl.addEventListener("blur", () => {
          if (!recording) return;
          const lostWindowFocus = !button.buttonEl.ownerDocument.hasFocus();
          finishRecording();
          this.plugin.endGlobalShortcutRecording(true);
          setStatus(
            lostWindowFocus
              ? "Another app captured that shortcut. Choose a different one."
              : "Recording canceled.",
            lostWindowFocus
          );
        });
      });

    new Setting(this.containerEl)
      .setName("Raycast appearance")
      .setDesc("Apply Raycast-inspired typography and content styling to the note body.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.raycastStyle).onChange(async (value) => {
          this.plugin.settings.raycastStyle = value;
          this.plugin.applyAppearance();
          await this.plugin.saveSettings();
        })
      );

    new Setting(this.containerEl)
      .setName("Translucent window")
      .setDesc("Use macOS vibrancy and a translucent background in Ray Notes windows.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.translucentWindow).onChange(async (value) => {
          this.plugin.settings.translucentWindow = value;
          this.plugin.applyAppearance();
          await this.plugin.saveSettings();
        })
      );

    new Setting(this.containerEl)
      .setName("Folder note click")
      .setDesc("Choose where notes from the Ray Notes folder open.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("default", "Open in Obsidian")
          .addOption("when-open", "Use Ray Notes when open")
          .addOption("always", "Always use Ray Notes")
          .setValue(this.plugin.settings.noteOpenBehavior)
          .onChange(async (value) => {
            this.plugin.settings.noteOpenBehavior = value as RayNotesSettings["noteOpenBehavior"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Minimize main window")
      .setDesc("Minimize the main Obsidian window when Ray Notes opens.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.minimizeMainWindow).onChange(async (value) => {
          this.plugin.settings.minimizeMainWindow = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
