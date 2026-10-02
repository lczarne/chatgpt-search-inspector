# ChatGPT Search Inspector

A local Chrome extension that shows search queries and source URLs exposed in your ChatGPT tab’s network traffic. No backend, telemetry, API key, or additional ChatGPT requests.

## Install

Requires Chrome 125 or newer.

1. Download this repository using **Code → Download ZIP** and extract it, or clone it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Open https://chatgpt.com and click the extension icon.
5. Click **Start** before sending a question that uses web search.

Chrome displays a debugging banner while capture is active. Close DevTools on the captured tab, since opening it can disconnect the extension.

To update, replace the files and click **Reload** on the extension’s card in `chrome://extensions`, then reopen its panel.

## Features

- Search queries grouped by operation, with domain-specific searches highlighted.
- Compact source tiles with full URLs, titles, and source references.
- Response selection, filtering, and query copying.
- Separate query and source CSV downloads in the **Export** tab.
- Green status while capture is active and grey when stopped, with progress details below.
- Live WebSocket and fetch/SSE capture, with completed-response and conversation-batch fallbacks and deduplication.

**Stop** ends capture. **Clear** ends capture and removes the collected data. Starting a new capture replaces the previous session, so export first if needed.

## Privacy and permissions

Capture starts manually for the selected ChatGPT tab. The `debugger` permission lets the extension inspect that tab’s network communication and attached targets. Host access is limited to `https://chatgpt.com/*`.

Parsed summaries are stored in `chrome.storage.session`. The extension does not save raw network frames, cookies, authentication headers, or resume tokens. Response bodies may be processed temporarily in memory. Queries and exported data can contain information from your conversation; review them before sharing.

`demo.json` contains fictional sample data for the local UI preview, not captured conversation data.

## Limitations

This is an unofficial tool and is not affiliated with OpenAI. It displays only data exposed to the browser, not a complete view of ChatGPT’s internal retrieval system. Network formats can change and require parser updates.

WebSocket and fetch/SSE results can appear during generation. On Chrome versions without response streaming support, SSE falls back to reading the completed response. Conversation-batch results may arrive later. Interrupted responses or targets outside the captured tab’s tree may not be available.

An empty list does not prove that no search occurred. A source reference does not prove the full page was read, and a link in the answer does not establish how much that source influenced it. Source counts are not counts of all internal search-engine calls. The same URL can appear under different reference types.

## Local development

Plain JavaScript, HTML, and CSS; no build step or dependencies required.

For a UI-only sample preview, run from this folder:

```sh
python3 -m http.server 8769 --bind 127.0.0.1
```

Then open http://127.0.0.1:8769/panel.html?preview=1. Actual capture requires the installed extension.

JavaScript syntax can be checked with a recent Node.js version:

```sh
node --check background.js
node --check panel.js
node --check parser.js
node --check progress.js
```

Run the synthetic regression tests with:

```sh
node --test tests/*.test.mjs
```
