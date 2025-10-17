
(() => {
  if (window.__copyAsMdOverlayActive) {
    return;
  }
  window.__copyAsMdOverlayActive = true;

  const overlayAttr = 'data-copy-as-md-overlay';

  const defaultOptions = {
    includeLinks: false,
    includeMedia: false
  };

  let cachedOptions = null;
  let optionsPromise = null;

  const loadOptionsFromStorage = () =>
    new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve({ ...defaultOptions });
        return;
      }

      chrome.storage.sync.get(defaultOptions, (items) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('Copy as Markdown: failed to load options', chrome.runtime.lastError);
          resolve({ ...defaultOptions });
          return;
        }
        resolve({ ...defaultOptions, ...items });
      });
    });

  const refreshOptions = () => {
    optionsPromise = loadOptionsFromStorage().then((options) => {
      cachedOptions = options;
      return options;
    });
    return optionsPromise;
  };

  const getOptions = () => {
    if (cachedOptions) {
      return Promise.resolve(cachedOptions);
    }
    if (optionsPromise) {
      return optionsPromise;
    }
    return refreshOptions();
  };

  refreshOptions();

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') {
        return;
      }

      const nextOptions = { ...(cachedOptions || defaultOptions) };
      let updated = false;

      if (Object.prototype.hasOwnProperty.call(changes, 'includeLinks')) {
        nextOptions.includeLinks = changes.includeLinks.newValue ?? defaultOptions.includeLinks;
        updated = true;
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'includeMedia')) {
        nextOptions.includeMedia = changes.includeMedia.newValue ?? defaultOptions.includeMedia;
        updated = true;
      }

      if (updated) {
        cachedOptions = nextOptions;
      }
    });
  }

  const mask = document.createElement('div');
  mask.className = 'copy-as-md-overlay-mask';
  mask.setAttribute(overlayAttr, '');

  const highlightLayer = document.createElement('div');
  highlightLayer.className = 'copy-as-md-highlight-layer';
  highlightLayer.setAttribute(overlayAttr, '');

  const selectionBox = document.createElement('div');
  selectionBox.className = 'copy-as-md-selection';
  selectionBox.setAttribute(overlayAttr, '');
  selectionBox.style.display = 'none';

  const hint = document.createElement('div');
  hint.className = 'copy-as-md-hint';
  hint.setAttribute(overlayAttr, '');
  hint.textContent = 'Drag to capture an area. Press Esc to cancel.';

  document.body.append(mask, highlightLayer, selectionBox, hint);

  let isSelecting = false;
  let startPageX = 0;
  let startPageY = 0;
  let latestClientX = 0;
  let latestClientY = 0;
  let latestPageX = 0;
  let latestPageY = 0;
  let currentRect = null;
  const highlightCache = new Map();
  let pendingHighlightRect = null;
  let pendingHighlightFrame = null;
  let autoScrollFrame = null;
  let scrollVelocityX = 0;
  let scrollVelocityY = 0;

  const updatePointerFromEvent = (event) => {
    latestClientX = event.clientX;
    latestClientY = event.clientY;
    latestPageX = event.clientX + window.scrollX;
    latestPageY = event.clientY + window.scrollY;
  };

  const syncPagePointer = () => {
    latestPageX = latestClientX + window.scrollX;
    latestPageY = latestClientY + window.scrollY;
  };

  const refreshSelection = () => {
    if (!isSelecting) {
      return;
    }
    currentRect = createRect(startPageX, startPageY, latestPageX, latestPageY);
    updateSelectionBox(currentRect);
    scheduleHighlightRefresh(currentRect);
  };

  const stopAutoScroll = () => {
    if (autoScrollFrame) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
    scrollVelocityX = 0;
    scrollVelocityY = 0;
  };

  const stepAutoScroll = () => {
    autoScrollFrame = null;
    if (!isSelecting) {
      return;
    }

    const root = document.documentElement;
    const body = document.body;
    const maxScrollX = Math.max(0, Math.max(root.scrollWidth, body ? body.scrollWidth : 0) - window.innerWidth);
    const maxScrollY = Math.max(0, Math.max(root.scrollHeight, body ? body.scrollHeight : 0) - window.innerHeight);
    const nextScrollX = Math.min(Math.max(window.scrollX + scrollVelocityX, 0), maxScrollX);
    const nextScrollY = Math.min(Math.max(window.scrollY + scrollVelocityY, 0), maxScrollY);

    const scrolledX = nextScrollX !== window.scrollX;
    const scrolledY = nextScrollY !== window.scrollY;

    if (scrolledX || scrolledY) {
      window.scrollTo(nextScrollX, nextScrollY);
    } else {
      if ((scrollVelocityX < 0 && window.scrollX === 0) || (scrollVelocityX > 0 && window.scrollX === maxScrollX)) {
        scrollVelocityX = 0;
      }
      if ((scrollVelocityY < 0 && window.scrollY === 0) || (scrollVelocityY > 0 && window.scrollY === maxScrollY)) {
        scrollVelocityY = 0;
      }
    }

    syncPagePointer();
    refreshSelection();

    if (scrollVelocityX !== 0 || scrollVelocityY !== 0) {
      autoScrollFrame = requestAnimationFrame(stepAutoScroll);
    }
  };

  const updateAutoScroll = () => {
    if (!isSelecting) {
      return;
    }

    const edgeThreshold = 48;
    const maxStep = 42;
    const bottomEdge = window.innerHeight - edgeThreshold;
    const rightEdge = window.innerWidth - edgeThreshold;

    const topIntensity = latestClientY < edgeThreshold ? edgeThreshold - Math.max(latestClientY, 0) : 0;
    const bottomIntensity = latestClientY > bottomEdge ? Math.min(edgeThreshold, latestClientY - bottomEdge) : 0;
    const leftIntensity = latestClientX < edgeThreshold ? edgeThreshold - Math.max(latestClientX, 0) : 0;
    const rightIntensity = latestClientX > rightEdge ? Math.min(edgeThreshold, latestClientX - rightEdge) : 0;

    const toStep = (intensity) => {
      if (intensity <= 0) {
        return 0;
      }
      return Math.min(maxStep, Math.ceil((intensity / edgeThreshold) * maxStep));
    };

    if (bottomIntensity > 0) {
      scrollVelocityY = toStep(bottomIntensity);
    } else if (topIntensity > 0) {
      scrollVelocityY = -toStep(topIntensity);
    } else {
      scrollVelocityY = 0;
    }

    if (rightIntensity > 0) {
      scrollVelocityX = toStep(rightIntensity);
    } else if (leftIntensity > 0) {
      scrollVelocityX = -toStep(leftIntensity);
    } else {
      scrollVelocityX = 0;
    }

    if (scrollVelocityX !== 0 || scrollVelocityY !== 0) {
      if (!autoScrollFrame) {
        autoScrollFrame = requestAnimationFrame(stepAutoScroll);
      }
    } else {
      stopAutoScroll();
    }
  };

  const onMouseDown = (event) => {
    if (event.button !== 0) {
      event.preventDefault();
      event.stopPropagation();
      cancelSelection();
      return;
    }

    isSelecting = true;
    stopAutoScroll();
    updatePointerFromEvent(event);
    startPageX = latestPageX;
    startPageY = latestPageY;
    selectionBox.style.display = 'block';
    refreshSelection();
    updateAutoScroll();

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    event.preventDefault();
    event.stopPropagation();
  };

  const onMouseMove = (event) => {
    if (!isSelecting) {
      return;
    }

    updatePointerFromEvent(event);
    refreshSelection();
    updateAutoScroll();
    event.preventDefault();
    event.stopPropagation();
  };

  const onMouseUp = async (event) => {
    if (!isSelecting || event.button !== 0) {
      return;
    }

    updatePointerFromEvent(event);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);

    stopAutoScroll();
    isSelecting = false;
    selectionBox.style.display = 'none';
    clearHighlights();
    mask.style.cursor = 'wait';

    if (!currentRect || currentRect.width < 5 || currentRect.height < 5) {
      cancelSelection();
      return;
    }

    try {
      const markdown = await captureSelection(currentRect);
      await navigator.clipboard.writeText(markdown);
      showToast('Markdown copied to clipboard!', false);
    } catch (error) {
      console.error('Copy as Markdown failed:', error);
      showToast('Failed to copy Markdown. Check permissions and try again.', true);
    } finally {
      cleanup();
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelSelection();
    }
  };

  const cancelSelection = () => {
    cleanup();
  };

  const cleanup = () => {
    window.__copyAsMdOverlayActive = false;
    mask.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    stopAutoScroll();
    clearHighlights();
    mask.remove();
    highlightLayer.remove();
    selectionBox.remove();
    hint.remove();
  };

  const createRect = (pageX1, pageY1, pageX2, pageY2) => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const leftPage = Math.min(pageX1, pageX2);
    const topPage = Math.min(pageY1, pageY2);
    const rightPage = Math.max(pageX1, pageX2);
    const bottomPage = Math.max(pageY1, pageY2);
    const left = leftPage - scrollX;
    const top = topPage - scrollY;
    const width = rightPage - leftPage;
    const height = bottomPage - topPage;
    return new DOMRect(left, top, width, height);
  };

  const updateSelectionBox = (rect) => {
    selectionBox.style.left = `${rect.x}px`;
    selectionBox.style.top = `${rect.y}px`;
    selectionBox.style.width = `${rect.width}px`;
    selectionBox.style.height = `${rect.height}px`;
  };

  const captureSelection = async (rect) => {
    const targets = deriveSelectionTargets(rect);
    if (!targets.length) {
      throw new Error('No elements found in selection.');
    }

    const options = await getOptions();

    const container = document.createElement('div');
    targets.forEach(({ node }) => {
      const clone = node.cloneNode(true);
      normalizeNode(clone);
      container.appendChild(clone);
    });

    return htmlToMarkdown(container, options).trim();
  };

  const scheduleHighlightRefresh = (rect) => {
    pendingHighlightRect = rect;
    if (!rect || rect.width < 2 || rect.height < 2) {
      clearHighlights();
      return;
    }

    if (pendingHighlightFrame) {
      return;
    }

    pendingHighlightFrame = requestAnimationFrame(() => {
      pendingHighlightFrame = null;
      if (!pendingHighlightRect || pendingHighlightRect.width < 2 || pendingHighlightRect.height < 2) {
        clearHighlights();
        return;
      }

      const targets = deriveSelectionTargets(pendingHighlightRect);
      reconcileHighlights(targets);
    });
  };

  const reconcileHighlights = (targets) => {
    const seen = new Set();

    targets.forEach(({ node, box }) => {
      if (!box || box.width === 0 || box.height === 0) {
        return;
      }

      let overlay = highlightCache.get(node);
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'copy-as-md-highlight';
        overlay.setAttribute(overlayAttr, '');
        highlightLayer.appendChild(overlay);
        highlightCache.set(node, overlay);
      }

      overlay.style.left = `${box.left}px`;
      overlay.style.top = `${box.top}px`;
      overlay.style.width = `${box.width}px`;
      overlay.style.height = `${box.height}px`;
      seen.add(node);
    });

    for (const [element, overlay] of Array.from(highlightCache.entries())) {
      if (!seen.has(element)) {
        overlay.remove();
        highlightCache.delete(element);
      }
    }
  };

  const clearHighlights = () => {
    if (pendingHighlightFrame) {
      cancelAnimationFrame(pendingHighlightFrame);
      pendingHighlightFrame = null;
    }
    pendingHighlightRect = null;
    highlightCache.forEach((overlay) => overlay.remove());
    highlightCache.clear();
  };

  const deriveSelectionTargets = (rect) => {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return [];
    }

    const selectionArea = Math.max(rect.width * rect.height, 1);
    const candidateMetrics = new Map();

    const considerCandidate = (node, box, intersection) => {
      if (!node || node === document.body || node === document.documentElement) {
        return;
      }
      if (node.hasAttribute && node.hasAttribute(overlayAttr)) {
        return;
      }

      const metrics = computeCandidateMetrics(node, rect, selectionArea, box, intersection);
      if (!metrics) {
        return;
      }

      const existing = candidateMetrics.get(node);
      if (existing) {
        if ((!existing.accepted && metrics.accepted) || metrics.score > existing.score) {
          candidateMetrics.set(node, metrics);
        }
        return;
      }

      candidateMetrics.set(node, metrics);
    };

    const walkerCandidates = collectWalkerCandidates(rect);
    walkerCandidates.forEach(({ node, box, intersection }) => {
      considerCandidate(node, box, intersection);
    });

    const sampledCandidates = sampleElementsInRect(rect);
    sampledCandidates.forEach((node) => {
      considerCandidate(node);
    });

    const metricsList = Array.from(candidateMetrics.values());
    if (!metricsList.length) {
      return [];
    }

    const accepted = metricsList.filter((entry) => entry.accepted);
    const pool = accepted.length ? accepted : metricsList;
    const sorted = sortByDocumentOrder(pool);
    const pruned = pruneCandidates(sorted);

    if (pruned.length) {
      return pruned.map(({ node, box }) => ({ node, box }));
    }

    const bestFallback = metricsList.slice().sort((a, b) => b.score - a.score)[0];
    return bestFallback ? [{ node: bestFallback.node, box: bestFallback.box }] : [];
  };

  const collectWalkerCandidates = (rect) => {
    const contained = [];
    const partial = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (node.hasAttribute && node.hasAttribute(overlayAttr)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const hasMathMLElement = typeof MathMLElement !== 'undefined';

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const isElement =
        node instanceof HTMLElement ||
        node instanceof SVGElement ||
        (hasMathMLElement && node instanceof MathMLElement);
      if (!isElement) {
        continue;
      }
      if (node.tagName === 'HTML' || node.tagName === 'BODY') {
        continue;
      }

      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        continue;
      }

      const box = node.getBoundingClientRect();
      if (!box || !intersects(rect, box)) {
        continue;
      }

      const intersection = intersectionRect(rect, box);
      if (!intersection || intersection.width === 0 || intersection.height === 0) {
        continue;
      }

      const tolerance = 2;
      const fullyContained =
        box.left >= rect.left - tolerance &&
        box.right <= rect.right + tolerance &&
        box.top >= rect.top - tolerance &&
        box.bottom <= rect.bottom + tolerance;

      const targetArray = fullyContained ? contained : partial;
      targetArray.push({ node, box, intersection });
    }

    return contained.concat(partial);
  };

  const sampleElementsInRect = (rect) => {
    const hits = new Set();
    const cols = Math.max(3, Math.ceil(rect.width / 250));
    const rows = Math.max(3, Math.ceil(rect.height / 200));

    const performSampling = () => {
      for (let row = 0; row < rows; row += 1) {
        const y = rect.top + ((row + 0.5) / rows) * rect.height;
        if (y < 0 || y > window.innerHeight) {
          continue;
        }
        for (let col = 0; col < cols; col += 1) {
          const x = rect.left + ((col + 0.5) / cols) * rect.width;
          if (x < 0 || x > window.innerWidth) {
            continue;
          }
          const element = document.elementFromPoint(x, y);
          if (!element) {
            continue;
          }
          const candidate = promoteToBlockCandidate(element, rect);
          if (candidate) {
            hits.add(candidate);
          }
        }
      }
    };

    withOverlaySuspended(performSampling);
    return Array.from(hits);
  };

  const promoteToBlockCandidate = (element, rect) => {
    let current = element;
    while (current) {
      if (current.hasAttribute && current.hasAttribute(overlayAttr)) {
        current = current.parentElement;
        continue;
      }
      if (!(current instanceof Element)) {
        current = current.parentElement;
        continue;
      }
      if (current === document.body || current === document.documentElement) {
        return null;
      }
      const style = window.getComputedStyle(current);
      if (style.display !== 'inline' && style.display !== 'contents') {
        const box = current.getBoundingClientRect();
        if (box && intersects(rect, box)) {
          return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  };

  const computeCandidateMetrics = (node, rect, selectionArea, precomputedBox, precomputedIntersection) => {
    const box = precomputedBox || node.getBoundingClientRect();
    if (!box) {
      return null;
    }

    const intersection = precomputedIntersection || intersectionRect(rect, box);
    if (!intersection || intersection.width <= 0 || intersection.height <= 0) {
      return null;
    }

    const elementArea = Math.max(box.width * box.height, 1);
    const intersectionArea = intersection.width * intersection.height;
    const insideRatio = intersectionArea / elementArea;
    const selectionFill = intersectionArea / selectionArea;
    const horizontalCoverage = intersection.width / Math.max(box.width, 1);
    const verticalCoverage = intersection.height / Math.max(box.height, 1);

    const overflowLeft = Math.max(0, rect.left - box.left);
    const overflowRight = Math.max(0, box.right - rect.right);
    const overflowTop = Math.max(0, rect.top - box.top);
    const overflowBottom = Math.max(0, box.bottom - rect.bottom);
    const overflowX = (overflowLeft + overflowRight) / Math.max(box.width, 1);
    const overflowY = (overflowTop + overflowBottom) / Math.max(box.height, 1);

    const overflowLimitX = Math.min(64, rect.width * 0.4);
    const overflowLimitY = Math.min(64, rect.height * 0.4);
    const extendsTooFar =
      overflowLeft > overflowLimitX ||
      overflowRight > overflowLimitX ||
      overflowTop > overflowLimitY ||
      overflowBottom > overflowLimitY;

    const normalizedOverflow = Math.max(overflowX, overflowY);
    const overflowPenalty = normalizedOverflow > 0.25 ? (normalizedOverflow - 0.25) * 1.8 : 0;
    const coverageScore = (horizontalCoverage + verticalCoverage) / 2;
    const score = insideRatio * 0.6 + selectionFill * 0.25 + coverageScore * 0.15 - overflowPenalty;

    const accepted = !(
      (insideRatio < 0.55 && selectionFill < 0.35) ||
      horizontalCoverage < 0.55 ||
      verticalCoverage < 0.55 ||
      overflowX > 0.45 ||
      overflowY > 0.45 ||
      extendsTooFar
    );

    return {
      node,
      box,
      insideRatio,
      selectionFill,
      horizontalCoverage,
      verticalCoverage,
      overflowX,
      overflowY,
      overflowPenalty,
      score,
      accepted
    };
  };

  const sortByDocumentOrder = (entries) => {
    return entries.slice().sort((a, b) => {
      if (a.node === b.node) {
        return 0;
      }
      const position = a.node.compareDocumentPosition(b.node);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
      return 0;
    });
  };

  const pruneCandidates = (candidates) => {
    const result = [];

    candidates.forEach((candidate) => {
      let discard = false;
      for (let i = result.length - 1; i >= 0 && !discard; i -= 1) {
        const existing = result[i];
        if (existing.node === candidate.node) {
          discard = true;
          break;
        }

        if (existing.node.contains(candidate.node)) {
          const preferCandidate =
            candidate.insideRatio >= existing.insideRatio + 0.2 ||
            candidate.score >= existing.score * 1.1 ||
            existing.overflowX + existing.overflowY - (candidate.overflowX + candidate.overflowY) > 0.15;
          if (preferCandidate) {
            result.splice(i, 1);
            continue;
          }
          discard = true;
          break;
        }

        if (candidate.node.contains(existing.node)) {
          const preferExisting =
            existing.insideRatio >= candidate.insideRatio - 0.1 &&
            existing.score >= candidate.score * 0.9;
          if (preferExisting) {
            discard = true;
            break;
          }
          result.splice(i, 1);
        }
      }

      if (!discard) {
        result.push(candidate);
      }
    });

    return result;
  };

  const withOverlaySuspended = (callback) => {
    const previousMaskPointerEvents = mask.style.pointerEvents;
    const previousHintPointerEvents = hint.style.pointerEvents;
    const previousHighlightPointerEvents = highlightLayer.style.pointerEvents;
    const previousSelectionPointerEvents = selectionBox.style.pointerEvents;
    mask.style.pointerEvents = 'none';
    hint.style.pointerEvents = 'none';
    highlightLayer.style.pointerEvents = 'none';
    selectionBox.style.pointerEvents = 'none';
    try {
      callback();
    } finally {
      mask.style.pointerEvents = previousMaskPointerEvents;
      hint.style.pointerEvents = previousHintPointerEvents;
      highlightLayer.style.pointerEvents = previousHighlightPointerEvents;
      selectionBox.style.pointerEvents = previousSelectionPointerEvents;
    }
  };

  const normalizeNode = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(node.tagName)) {
        node.remove();
        continue;
      }
      if (node.hasAttribute('src')) {
        node.setAttribute('src', makeAbsoluteUrl(node.getAttribute('src')));
      }
      if (node.hasAttribute('href')) {
        node.setAttribute('href', makeAbsoluteUrl(node.getAttribute('href')));
      }
      if (node.hasAttribute('srcset')) {
        const srcset = node.getAttribute('srcset');
        if (srcset) {
          const normalized = srcset
            .split(',')
            .map((entry) => {
              const [url, descriptor] = entry.trim().split(/\s+/, 2);
              const absolute = makeAbsoluteUrl(url);
              return descriptor ? `${absolute} ${descriptor}` : absolute;
            })
            .join(', ');
          node.setAttribute('srcset', normalized);
        }
      }
    }
  };

  const makeAbsoluteUrl = (value) => {
    if (!value) {
      return value;
    }
    try {
      return new URL(value, document.baseURI).href;
    } catch (error) {
      return value;
    }
  };

  const intersects = (a, b) => {
    return (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );
  };

  const intersectionRect = (a, b) => {
    if (!intersects(a, b)) {
      return null;
    }
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return new DOMRect(left, top, right - left, bottom - top);
  };

  const showToast = (message, isError) => {
    const toast = document.createElement('div');
    toast.className = 'copy-as-md-toast';
    toast.setAttribute(overlayAttr, '');
    toast.textContent = message;
    if (isError) {
      toast.classList.add('error');
    }

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  };

  const htmlToMarkdown = (root, options) => {
    const context = { listDepth: 0, insidePre: false, options: options || defaultOptions };
    const content = renderChildren(root, context);
    return normalizeMarkdown(content);
  };

  const renderChildren = (node, context) => {
    let output = '';
    node.childNodes.forEach((child) => {
      output += nodeToMarkdown(child, context);
    });
    return output;
  };

  const nodeToMarkdown = (node, context) => {
    const { options } = context;
    if (node.nodeType === Node.TEXT_NODE) {
      return context.insidePre ? node.textContent : collapseWhitespace(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'br':
        return '  \n';
      case 'p':
      case 'div':
      case 'section':
      case 'article':
      case 'header':
      case 'footer':
      case 'main':
      case 'aside':
      case 'figure':
      case 'figcaption':
        return `\n${renderChildren(node, context).trim()}\n\n`;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return `\n${'#'.repeat(Number(tag[1]))} ${renderInline(node, context)}\n\n`;
      case 'strong':
      case 'b':
        return `**${renderInline(node, context)}**`;
      case 'em':
      case 'i':
        return `*${renderInline(node, context)}*`;
      case 'u':
        return `_${renderInline(node, context)}_`;
      case 'code': {
        if (context.insidePre) {
          return node.textContent;
        }
        return `\`${renderInline(node, { ...context, insidePre: false })}\``;
      }
      case 'pre': {
        const code = node.textContent.replace(/\s+$/, '');
        return '\n\n```\n' + code + '\n```\n\n';
      }
      case 'blockquote': {
        const inner = renderChildren(node, context)
          .trim()
          .split(/\n/)
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n');
        return `\n${inner}\n\n`;
      }
      case 'ul':
      case 'ol':
        return `\n${renderList(node, context)}\n`;
      case 'li':
        return renderListItem(node, context);
      case 'a': {
        if (!options.includeLinks) {
          return renderInline(node, context);
        }
        const href = node.getAttribute('href') || '';
        const text = renderInline(node, context) || href;
        if (!href) {
          return text;
        }
        return `[${text}](${href})`;
      }
      case 'img': {
        if (!options.includeMedia) {
          return '';
        }
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
      case 'svg': {
        if (!options.includeMedia) {
          return '';
        }
        const markup = serializeSvg(node);
        if (!markup) {
          return '';
        }
        return `\n\n${markup}\n\n`;
      }
      case 'hr':
        return '\n---\n\n';
      case 'table':
        return `\n${renderTable(node, context)}\n`;
      default:
        return renderChildren(node, context);
    }
  };

  const renderInline = (node, context) => {
    return collapseWhitespace(renderChildren(node, context)).trim();
  };

  const renderList = (listNode, context) => {
    const isOrdered = listNode.tagName.toLowerCase() === 'ol';
    let index = isOrdered ? parseInt(listNode.getAttribute('start') || '1', 10) : 1;
    const indent = '  '.repeat(context.listDepth);
    const lines = [];

    Array.from(listNode.children).forEach((child) => {
      if (child.tagName && child.tagName.toLowerCase() === 'li') {
        const marker = isOrdered ? `${index}. ` : '- ';
        const childContext = { ...context, listDepth: context.listDepth + 1 };
        const content = renderChildren(child, childContext).trim();
        const contentLines = content.split(/\n+/).filter((line) => line.length);
        if (contentLines.length === 0) {
          lines.push(`${indent}${marker}`.trimEnd());
        } else {
          lines.push(`${indent}${marker}${contentLines[0]}`);
          for (let i = 1; i < contentLines.length; i += 1) {
            lines.push(`${indent}  ${contentLines[i]}`);
          }
        }
        index += 1;
      }
    });

    return lines.join('\n');
  };

  const renderListItem = (node, context) => {
    const wrapper = document.createElement('div');
    wrapper.appendChild(node.cloneNode(true));
    return renderChildren(wrapper, context);
  };

  const renderTable = (table, context) => {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) {
      return '';
    }

    const headerCells = Array.from(rows[0].querySelectorAll('th'));
    const hasHeader = headerCells.length > 0;
    const tableRows = rows.map((row) =>
      Array.from(row.children)
        .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
        .map((cell) => collapseWhitespace(renderChildren(cell, context)))
    );

    const columnCount = Math.max(0, ...tableRows.map((cells) => cells.length));
    if (columnCount === 0) {
      return '';
    }
    const normalizedRows = tableRows.map((cells) => {
      const padded = cells.slice();
      while (padded.length < columnCount) {
        padded.push('');
      }
      return padded;
    });

    let header = null;
    const bodyRows = [];
    if (hasHeader) {
      header = normalizedRows.shift();
      bodyRows.push(...normalizedRows);
    } else {
      header = normalizedRows[0] || [];
      bodyRows.push(...normalizedRows.slice(1));
    }

    const separator = new Array(columnCount).fill('---');
    const lines = [];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${separator.join(' | ')} |`);
    bodyRows.forEach((cells) => {
      lines.push(`| ${cells.join(' | ')} |`);
    });
    return lines.join('\n');
  };

  const collapseWhitespace = (text) => {
    if (!text) {
      return '';
    }
    const collapsed = text.replace(/\s+/g, ' ');
    return collapsed.trim() === '' ? '' : collapsed;
  };

  const normalizeMarkdown = (text) => {
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[\s\n]+|[\s\n]+$/g, '')
      .trim();
  };

  const serializeSvg = (node) => {
    try {
      return new XMLSerializer().serializeToString(node);
    } catch (error) {
      console.warn('Copy as Markdown: failed to serialize SVG', error);
      return '';
    }
  };

  mask.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('keydown', onKeyDown, true);
})();
