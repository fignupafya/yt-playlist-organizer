// Servis çalışanı: araç çubuğu simgesine tıklayınca uygulama sayfasını açar.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  try {
    const existing = await chrome.tabs.query({ url });
    if (existing.length) {
      await chrome.tabs.update(existing[0].id, { active: true });
      if (existing[0].windowId != null) {
        await chrome.windows.update(existing[0].windowId, { focused: true });
      }
      return;
    }
  } catch (e) { /* yoksay */ }
  chrome.tabs.create({ url });
});
