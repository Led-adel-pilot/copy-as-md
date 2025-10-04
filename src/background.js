chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['src/content/overlay.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/overlay.js']
    });
  } catch (error) {
    console.error('Copy as Markdown failed to inject overlay:', error);
  }
});
