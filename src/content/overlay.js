
(() => {
  if (window.__copyAsMdOverlayActive) {
    return;
  }
  window.__copyAsMdOverlayActive = true;

  const overlayAttr = 'data-copy-as-md-overlay';

  const mask = document.createElement('div');
  mask.className = 'copy-as-md-overlay-mask';
  mask.setAttribute(overlayAttr, '');

  const selectionBox = document.createElement('div');
  selectionBox.className = 'copy-as-md-selection';
  selectionBox.setAttribute(overlayAttr, '');
  selectionBox.style.display = 'none';

  const hint = document.createElement('div');
  hint.className = 'copy-as-md-hint';
  hint.setAttribute(overlayAttr, '');
  hint.textContent = 'Drag to capture an area. Press Esc to cancel.';

  document.body.append(mask, selectionBox, hint);

  let isSelecting = false;
  let startX = 0;
  let startY = 0;
  let currentRect = null;

  const onMouseDown = (event) => {
    if (event.button !== 0) {
      event.preventDefault();
      event.stopPropagation();
      cancelSelection();
      return;
    }

    isSelecting = true;
    startX = event.clientX;
    startY = event.clientY;
    currentRect = createRect(startX, startY, startX, startY);
    selectionBox.style.display = 'block';
    updateSelectionBox(currentRect);

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    event.preventDefault();
    event.stopPropagation();
  };

  const onMouseMove = (event) => {
    if (!isSelecting) {
      return;
    }

    currentRect = createRect(startX, startY, event.clientX, event.clientY);
    updateSelectionBox(currentRect);
    event.preventDefault();
    event.stopPropagation();
  };

  const onMouseUp = async (event) => {
    if (!isSelecting || event.button !== 0) {
      return;
    }

    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);

    isSelecting = false;
    selectionBox.style.display = 'none';
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
    mask.remove();
    selectionBox.remove();
    hint.remove();
  };

  const createRect = (x1, y1, x2, y2) => {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);
    return new DOMRect(left, top, right - left, bottom - top);
  };

  const updateSelectionBox = (rect) => {
    selectionBox.style.left = `${rect.x}px`;
    selectionBox.style.top = `${rect.y}px`;
    selectionBox.style.width = `${rect.width}px`;
    selectionBox.style.height = `${rect.height}px`;
  };

  const captureSelection = async (rect) => {
    const elements = collectElementsInRect(rect);
    if (!elements.length) {
      throw new Error('No elements found in selection.');
    }

    const selectedSet = new Set(elements);
    const topLevelElements = elements.filter((el) => {
      let parent = el.parentElement;
      while (parent) {
        if (selectedSet.has(parent)) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });

    const container = document.createElement('div');
    topLevelElements.forEach((element) => {
      const clone = element.cloneNode(true);
      normalizeNode(clone);
      container.appendChild(clone);
    });

    return htmlToMarkdown(container).trim();
  };

  const collectElementsInRect = (rect) => {
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

      const tolerance = 4;
      const fullyContained =
        box.left >= rect.left - tolerance &&
        box.right <= rect.right + tolerance &&
        box.top >= rect.top - tolerance &&
        box.bottom <= rect.bottom + tolerance;

      if (fullyContained) {
        contained.push(node);
        continue;
      }

      const area = Math.max(box.width * box.height, 1);
      const intersectionArea = intersection.width * intersection.height;
      const coverageRatio = intersectionArea / area;
      const horizontalCoverage = intersection.width / Math.max(box.width, 1);
      const verticalCoverage = intersection.height / Math.max(box.height, 1);

      const MIN_INTERSECTION_RATIO = 0.4;
      const MIN_AXIS_COVERAGE = 0.4;

      if (coverageRatio >= MIN_INTERSECTION_RATIO &&
        horizontalCoverage >= MIN_AXIS_COVERAGE &&
        verticalCoverage >= MIN_AXIS_COVERAGE) {
        partial.push({ node, score: coverageRatio });
      }
    }

    if (contained.length) {
      return contained;
    }

    partial.sort((a, b) => b.score - a.score);
    return partial.map((entry) => entry.node);
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

  const htmlToMarkdown = (root) => {
    const context = { listDepth: 0, insidePre: false };
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
        const href = node.getAttribute('href') || '';
        const text = renderInline(node, context) || href;
        return `[${text}](${href})`;
      }
      case 'img': {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        return `![${alt}](${src})`;
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

  mask.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('keydown', onKeyDown, true);
})();
