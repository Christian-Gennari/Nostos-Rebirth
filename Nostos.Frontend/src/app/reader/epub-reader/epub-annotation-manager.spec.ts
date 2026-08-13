import { Injector } from '@angular/core';
import { Rendition, Contents } from 'epubjs';
import { of, throwError } from 'rxjs';
import type { Mock } from 'vitest';
import { EpubAnnotationManager } from './epub-annotation-manager';

/**
 * Mobile native-callout suppression + early selection capture (issue #16).
 * Mirrors the "Minimal Section A specs" from the expert design: 13 specs.
 */

const CFI = 'epubcfi(/6/4!/4/2/1:0)';

function makeContents(doc: Document = document): Contents {
  return {
    document: doc,
    window: window,
    cfiFromRange: vi.fn(() => CFI),
  } as unknown as Contents;
}

function createRendition() {
  const registeredContents: Contents[] = [];
  const views: Array<{ index: number; pane: { removeMark: ReturnType<typeof vi.fn> } }> = [
    { index: 0, pane: { removeMark: vi.fn() } },
  ];
  const annotations = {
    highlight: vi.fn((cfiRange: string) => ({
      type: 'highlight',
      cfiRange,
      sectionIndex: 0,
      mark: { element: document.createElement('span') },
    })),
    add: vi.fn(),
    remove: vi.fn(),
  };
  const rendition = {
    hooks: { content: { register: vi.fn() } },
    on: vi.fn(),
    off: vi.fn(),
    annotations,
    getContents: vi.fn(() => [...registeredContents]),
    views: vi.fn(() => views),
    getRange: vi.fn(),
  };
  return { rendition, annotations, views, registeredContents };
}

/** Selects the given text in the test document via the real jsdom Selection. */
function selectText(text: string) {
  document.body.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(document.body);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectWhitespaceOnly() {
  document.body.textContent = '   ';
  const range = document.createRange();
  range.selectNodeContents(document.body);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function collapseSelection() {
  window.getSelection()?.collapse(document.body, 0);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('EpubAnnotationManager mobile highlight mode (issue #16)', () => {
  let manager: EpubAnnotationManager;
  let rendition: ReturnType<typeof createRendition>['rendition'];
  let annotations: ReturnType<typeof createRendition>['annotations'];
  let views: ReturnType<typeof createRendition>['views'];
  let registeredContents: ReturnType<typeof createRendition>['registeredContents'];
  let notesService: { create: Mock<() => unknown> };
  let onNoteCreated: Mock<() => void>;
  let onCommitFailed: Mock<() => void>;
  let onSelectionCaptured: Mock<(text: string) => void>;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    const r = createRendition();
    rendition = r.rendition;
    annotations = r.annotations;
    views = r.views;
    registeredContents = r.registeredContents;

    notesService = { create: vi.fn(() => of({ id: 'n1' })) };
    onNoteCreated = vi.fn();
    onCommitFailed = vi.fn();
    onSelectionCaptured = vi.fn();

    manager = new EpubAnnotationManager(
      rendition as unknown as Rendition,
      'book-1',
      { get: () => notesService } as unknown as Injector,
      onNoteCreated,
      onCommitFailed,
    );
    manager.setOnSelectionCaptured(onSelectionCaptured);
  });

  afterEach(() => {
    manager.destroy();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('adds nostos-highlight-mode to every current iframe body when mode turns on', () => {
    const docA = document.implementation.createHTMLDocument('doc-a');
    const docB = document.implementation.createHTMLDocument('doc-b');
    manager.registerContents(makeContents(docA));
    manager.registerContents(makeContents(docB));
    registeredContents.push(makeContents(docA), makeContents(docB));

    expect(docA.body!.classList.contains('nostos-highlight-mode')).toBe(false);
    expect(docB.body!.classList.contains('nostos-highlight-mode')).toBe(false);

    manager.setHighlightMode(true);

    expect(docA.body!.classList.contains('nostos-highlight-mode')).toBe(true);
    expect(docB.body!.classList.contains('nostos-highlight-mode')).toBe(true);
  });

  it('applies the active mode to a newly rendered contents document', () => {
    manager.setHighlightMode(true);

    const doc = document.implementation.createHTMLDocument('doc-new');
    manager.registerContents(makeContents(doc));

    expect(doc.body!.classList.contains('nostos-highlight-mode')).toBe(true);
  });

  it('removes nostos-highlight-mode when mode turns off', () => {
    const doc = document.implementation.createHTMLDocument('doc');
    const contents = makeContents(doc);
    manager.registerContents(contents);
    registeredContents.push(contents);
    manager.setHighlightMode(true);
    expect(doc.body!.classList.contains('nostos-highlight-mode')).toBe(true);

    manager.setHighlightMode(false);

    expect(doc.body!.classList.contains('nostos-highlight-mode')).toBe(false);
  });

  it('prevents contextmenu only while highlight mode is on', () => {
    const doc = document.implementation.createHTMLDocument('doc');
    manager.registerContents(makeContents(doc));

    const fire = () => {
      const event = new Event('contextmenu', { cancelable: true });
      doc.dispatchEvent(event);
      return event;
    };

    expect(fire().defaultPrevented).toBe(false);

    manager.setHighlightMode(true);
    expect(fire().defaultPrevented).toBe(true);

    manager.setHighlightMode(false);
    expect(fire().defaultPrevented).toBe(false);
  });

  it('captures a non-collapsed iframe selection as one pending highlight', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Some meaningful text');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();

    expect(annotations.highlight).toHaveBeenCalledTimes(1);
    expect(annotations.highlight).toHaveBeenCalledWith(
      CFI,
      { nostosPending: true },
      undefined,
      'epubjs-hl-pending',
    );
    expect(onSelectionCaptured).toHaveBeenCalledWith('Some meaningful text');
  });

  it('captures via touchend fallback when epub.js selected never fires', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Fallback text');
    document.dispatchEvent(new Event('touchend'));
    await flush();

    expect(annotations.highlight).toHaveBeenCalledTimes(1);
    expect(onSelectionCaptured).toHaveBeenCalledWith('Fallback text');
  });

  it('deduplicates fallback capture against a later epub.js selected event', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());
    manager.init();

    selectText('Dedup text');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();
    expect(annotations.highlight).toHaveBeenCalledTimes(1);

    // epub.js finally fires `selected` for the same selection.
    selectText('Dedup text');
    const selectedHandler = rendition.on.mock.calls.find(([type]) => type === 'selected')?.[1] as (
      cfiRange: string,
      contents: Contents,
    ) => void;
    selectedHandler(CFI, makeContents());

    expect(annotations.highlight).toHaveBeenCalledTimes(1);
    expect(onSelectionCaptured).toHaveBeenCalledTimes(1);
  });

  it('ignores collapsed and whitespace-only selections', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Word');
    collapseSelection();
    document.dispatchEvent(new Event('selectionchange'));
    await flush();

    selectWhitespaceOnly();
    document.dispatchEvent(new Event('selectionchange'));
    await flush();

    expect(annotations.highlight).not.toHaveBeenCalled();
    expect(onSelectionCaptured).not.toHaveBeenCalled();
  });

  it('clears native ranges immediately after capturing', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Temp annotation text');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();

    expect(annotations.highlight).toHaveBeenCalledTimes(1);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('cancel removes only the temporary annotation', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Cancel me');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();
    expect(annotations.highlight).toHaveBeenCalledTimes(1);

    manager.discardHighlight();

    expect(views[0].pane.removeMark).toHaveBeenCalledTimes(1);
    expect(annotations.add).not.toHaveBeenCalled();
    expect(onNoteCreated).not.toHaveBeenCalled();

    // Pending state was cleared: a new selection can be captured again.
    selectText('New selection');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();
    expect(annotations.highlight).toHaveBeenCalledTimes(2);
  });

  it('successful save adds one persisted annotation and removes the temporary one', async () => {
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Save me');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();
    expect(annotations.highlight).toHaveBeenCalledTimes(1);

    const result = await manager.commitHighlight();

    expect(result).toBe(true);
    // Permanent annotation is added first, then the temporary is removed by object.
    expect(annotations.add).toHaveBeenCalledTimes(1);
    expect(annotations.add).toHaveBeenCalledWith('highlight', CFI);
    expect(annotations.add.mock.invocationCallOrder[0]).toBeLessThan(
      views[0].pane.removeMark.mock.invocationCallOrder[0],
    );
    expect(views[0].pane.removeMark).toHaveBeenCalledTimes(1);
    expect(notesService.create).toHaveBeenCalledWith('book-1', {
      content: '',
      cfiRange: CFI,
      selectedText: 'Save me',
    });
    expect(onNoteCreated).toHaveBeenCalledTimes(1);
    expect(manager.highlights()).toEqual([CFI]);
  });

  it('failed save retains the pending highlight and its visual feedback', async () => {
    notesService.create.mockReturnValue(throwError(() => new Error('api down')));
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());

    selectText('Keep me');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();
    expect(annotations.highlight).toHaveBeenCalledTimes(1);

    const result = await manager.commitHighlight();

    expect(result).toBe(false);
    expect(onCommitFailed).toHaveBeenCalledTimes(1);
    expect(onNoteCreated).not.toHaveBeenCalled();
    // No permanent annotation, temporary annotation still attached.
    expect(annotations.add).not.toHaveBeenCalled();
    expect(views[0].pane.removeMark).not.toHaveBeenCalled();

    // Pending state survived: cancel still removes the temporary annotation.
    manager.discardHighlight();
    expect(views[0].pane.removeMark).toHaveBeenCalledTimes(1);
  });

  it('destroy removes document listeners and the temporary annotation', async () => {
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');
    manager.setHighlightMode(true);
    manager.registerContents(makeContents());
    manager.init();

    selectText('Destroy me');
    document.dispatchEvent(new Event('selectionchange'));
    await flush();
    expect(views[0].pane.removeMark).not.toHaveBeenCalled();

    manager.destroy();

    expect(views[0].pane.removeMark).toHaveBeenCalledTimes(1);
    // contextmenu + selectionchange + touchend listeners are removed.
    expect(removeListenerSpy).toHaveBeenCalledTimes(3);
    expect(rendition.off).toHaveBeenCalledWith('selected', expect.any(Function));
  });
});
