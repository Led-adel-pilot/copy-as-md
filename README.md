# Copy as Markdown

A Chrome extension that lets you draw a rectangle on the current web page and copy the intersecting content as Markdown to your clipboard.

## Features

- Click the extension icon to display a snipping-style overlay.
- Drag to select the portion of the page you want to capture.
- Converts the intersecting DOM elements to Markdown and copies the result to the clipboard.
- Provides success and error toasts and supports cancelling with the Escape key.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and choose the repository folder.

## Usage

1. Navigate to any webpage.
2. Click the "Copy as Markdown" extension icon in the toolbar.
3. Drag to draw a rectangle around the content you want to copy.
4. Release the mouse to convert the region to Markdown and copy it to the clipboard.
5. Press `Esc` at any time to cancel the capture.

## Project Structure

```
manifest.json
src/
  background.js         # Handles the browser action click and injects the overlay
  content/
    overlay.js          # Overlay, selection logic, and Markdown conversion
    overlay.css         # Styling for the overlay, selection rectangle, and toasts
```

## Notes

- The overlay cannot run on Chrome system pages or other restricted URLs.
- The Markdown conversion covers common HTML elements (headings, paragraphs, lists, tables, etc.) but may not perfectly capture complex layouts.
