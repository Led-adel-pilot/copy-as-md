const defaultOptions = {
  includeLinks: false,
  includeMedia: false
};

const form = document.getElementById('options-form');
const includeLinks = document.getElementById('include-links');
const includeMedia = document.getElementById('include-media');
const status = document.getElementById('status');

const loadOptions = () =>
  new Promise((resolve) => {
    chrome.storage.sync.get(defaultOptions, (items) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to load options', chrome.runtime.lastError);
        resolve({ ...defaultOptions });
        return;
      }
      resolve({ ...defaultOptions, ...items });
    });
  });

const saveOptions = (options) =>
  new Promise((resolve, reject) => {
    chrome.storage.sync.set(options, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });

const showStatus = (message, isError = false) => {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('show', true);
  status.style.color = isError ? 'var(--status-error, #b91c1c)' : '';

  setTimeout(() => {
    status.hidden = true;
    status.classList.toggle('show', false);
  }, 2200);
};

const onFormChange = async () => {
  const options = {
    includeLinks: includeLinks.checked,
    includeMedia: includeMedia.checked
  };

  try {
    await saveOptions(options);
    showStatus('Options saved.');
  } catch (error) {
    console.error('Failed to save options', error);
    showStatus('Failed to save options.', true);
  }
};

const init = async () => {
  const options = await loadOptions();
  includeLinks.checked = options.includeLinks;
  includeMedia.checked = options.includeMedia;

  form.addEventListener('change', onFormChange);
};

document.addEventListener('DOMContentLoaded', init);
