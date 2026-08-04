// 修改存储结构，按标签页ID存储音频资源
let audioResourcesByTab = new Map();

// 音频文件的 MIME 类型和扩展名
const AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-wav': 'wav',
  'audio/x-aac': 'aac',
  'audio/webm': 'webm',
  'application/ogg': 'ogg'
  // 移除非音频格式
};

// 监听网络请求，包括请求发起和响应头
chrome.webRequest.onBeforeRequest.addListener(
  handleRequest,
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onHeadersReceived.addListener(
  handleResponse,
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// 处理请求
function handleRequest(details) {
  // 忽略扩展自身和 Service Worker 发起的请求，避免打包时重复嗅探自己
  if (details.tabId < 0) return;

  if (details.method === 'GET' && (details.type === 'media' || isAudioRequest(details.url))) {
    // 直接检查是否是音频请求
    checkAndAddAudio(details.url, details.tabId);
  }
}

// 处理响应
function handleResponse(details) {
  if (details.tabId < 0) return;

  const headers = details.responseHeaders || [];
  const contentType = getHeaderValue(headers, 'content-type');

  if (contentType && isAudioContentType(contentType)) {
    checkAndAddAudio(details.url, details.tabId);
  }
}

// 获取响应头的值
function getHeaderValue(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value.toLowerCase() : '';
}

// 检查是否是音频MIME类型
function isAudioContentType(contentType) {
  return contentType.startsWith('audio/') ||
         contentType === 'application/ogg' ||
         Object.keys(AUDIO_TYPES).includes(contentType);
}

// 检查URL是否为音频请求
function isAudioRequest(url) {
  const urlLower = url.toLowerCase();

  // 1. 严格检查文件扩展名
  const hasAudioExt = /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(urlLower);
  if (!hasAudioExt) return false;  // 如果不是音频扩展名，直接返回false

  // 2. 排除非音频内容
  if (/\/(css|js|images|img|fonts|assets|wp-content|wp-includes)\//i.test(urlLower)) {
    return false;
  }

  return true;
}

// 修改检查和添加音频的函数
function checkAndAddAudio(url, tabId, contentType = '', contentLength = '0', title = '') {
  // 获取或创建标签页的音频资源集合
  if (!audioResourcesByTab.has(tabId)) {
    audioResourcesByTab.set(tabId, new Map());
  }
  const tabResources = audioResourcesByTab.get(tabId);

  // 检查是否已经存在相同的URL
  if (!tabResources.has(url)) {
    // 添加新的音频资源
    tabResources.set(url, {
      url,
      title,
      timestamp: Date.now()
    });

    // 通知popup更新
    notifyPopup(tabId);
  }
}

// 通知 popup 更新
function notifyPopup(tabId) {
  const tabResources = audioResourcesByTab.get(tabId) || new Map();
  const data = Array.from(tabResources.values());

  // 通知 popup
  try {
    chrome.runtime.sendMessage({
      type: 'AUDIO_RESOURCES_UPDATED',
      data: data,
      tabId: tabId
    }).catch(() => {
      // 忽略错误，popup可能未打开
    });

    // 通知对应标签页的 content script
    chrome.tabs.sendMessage(tabId, {
      type: 'AUDIO_RESOURCES_UPDATED',
      data: data,
      tabId: tabId
    }).catch(() => {
      // 忽略错误，content script可能未准备好
    });
  } catch (error) {
    // 忽略错误
    console.debug('Failed to notify popup or content script:', error);
  }
}

// 监听来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'GET_AUDIO_RESOURCES') {
      // 获取当前标签页的资源
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          const tabResources = audioResourcesByTab.get(tabs[0].id) || new Map();
          sendResponse(Array.from(tabResources.values()));
        } else {
          sendResponse([]);
        }
      });
      return true; // 保持消息通道开启
    }

    if (message.type === 'AUDIO_ELEMENT_FOUND') {
      const { url, title } = message.data;
      checkAndAddAudio(url, sender.tab.id, '', '0', title);
    }

    // 处理打开弹窗的消息
    if (message.type === 'OPEN_POPUP') {
      const windowId = sender.tab?.windowId;
      const popupOptions = Number.isInteger(windowId) ? { windowId } : {};

      chrome.action.openPopup(popupOptions)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.debug('Failed to open popup:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
  } catch (error) {
    console.debug('Error handling message:', error);
    sendResponse({ error: error.message });
  }
});

// 添加标签页更新监听
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    // 清空该标签页的音频记录
    audioResourcesByTab.set(tabId, new Map());
    notifyPopup(tabId);
  }
});

// 添加标签页关闭监听
chrome.tabs.onRemoved.addListener((tabId) => {
  // 清理关闭标签页的资源
  audioResourcesByTab.delete(tabId);
});
