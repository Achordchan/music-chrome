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
  if (details.method === 'GET' && isAudioRequest(details.url)) {
    // 直接检查是否是音频请求
    checkAndAddAudio(details.url, details.tabId);
  }
}

// 处理响应
function handleResponse(details) {
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

// 检查是否为有效的音频响应
function isValidAudioResponse(contentType) {
  // 只接受明确的音频类型
  return contentType.startsWith('audio/') || contentType === 'application/ogg';
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

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'FETCH_AUDIO') {
      // 使用background script发送请求
      fetch(message.url, {
        method: 'GET',
        headers: message.headers
      })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 获取响应数据
        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type');
        
        sendResponse({
          success: true,
          data: arrayBuffer,
          contentType: contentType
        });
      })
      .catch(error => {
        console.error('Failed to fetch audio:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });
      
      return true; // 保持消息通道开启
    }

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
    
    if (message.type === 'DOWNLOAD_AUDIO') {
      chrome.downloads.download({
        url: message.url,
        filename: message.filename || `audio_${Date.now()}.${getFileExtension(message.url)}`
      });
    }

    // 修改清空记录的消息处理
    if (message.type === 'CLEAR_RESOURCES') {
      audioResourcesByTab.clear();
      // 获取当前活动标签页并新注入content script
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          // 先执行页面分析
          chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            function: () => {
              // 模拟点击所有可能的播放按钮
              const playButtons = document.querySelectorAll(
                'button[class*="play"], button[id*="play"], ' +
                'div[class*="play"], div[id*="play"], ' +
                '[class*="player"] button, [id*="player"] button, ' +
                '[aria-label*="播放"], [title*="播放"]'
              );
              
              playButtons.forEach(button => {
                try {
                  button.click();
                  // 短暂延迟后暂停播放
                  setTimeout(() => {
                    const pauseButton = button.closest('[class*="player"]')?.querySelector('[class*="pause"]');
                    if (pauseButton) {
                      pauseButton.click();
                    }
                  }, 100);
                } catch (e) {
                  // 忽略点��错误
                }
              });

              // 查找所有音元素并触发加载
              const audioElements = document.querySelectorAll('audio, [type*="audio"]');
              audioElements.forEach(audio => {
                try {
                  if (audio.tagName.toLowerCase() === 'audio') {
                    audio.load();
                    audio.play().then(() => audio.pause()).catch(() => {});
                  }
                } catch (e) {
                  // 忽略播放错误
                }
              });

              // 重新运行检测
              if (typeof detectAudioElements === 'function') {
                detectAudioElements();
              }
            }
          });

          // 然后重新注入content script以确保继续监听
          chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            files: ['content.js']
          });
        }
      });
      notifyPopup();
      sendResponse({ success: true });
    }

    if (message.type === 'AUDIO_ELEMENT_FOUND') {
      const { url, title } = message.data;
      checkAndAddAudio(url, sender.tab.id, '', '0', title);
    }

    // 处理打开弹窗的消息
    if (message.type === 'OPEN_POPUP') {
      chrome.action.openPopup();
    }

    if (message.type === 'DOWNLOAD_AUDIO_DATA') {
      const audioInfo = message.audioInfo;
      
      // 构建完整的请求头
      const headers = {
        'Accept': 'audio/*,video/*,application/octet-stream;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Range': 'bytes=0-',
        'Referer': audioInfo.referer || '',
        'Origin': new URL(audioInfo.url).origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Sec-Fetch-Dest': 'audio',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      };

      // 处理文件名和扩展名
      try {
        let filename = audioInfo.title || 'audio';
        filename = filename.replace(/[<>:"/\\|?*]/g, '_');
        
        // 从URL和内容类型判断正确的扩展名
        const urlObj = new URL(audioInfo.url);
        const pathParts = urlObj.pathname.split('.');
        let extension = pathParts.length > 1 ? pathParts.pop().toLowerCase() : '';
        
        // 验证扩展名是否为音频格式
        const validAudioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
        if (!validAudioExtensions.includes(extension)) {
          // 如果URL中没有有效的音频扩展名，尝试从内容类型或查询参数中获取
          const format = urlObj.searchParams.get('format') || 
                        urlObj.searchParams.get('type') || 
                        'mp3';
          extension = validAudioExtensions.includes(format.toLowerCase()) ? 
                     format.toLowerCase() : 'mp3';
        }

        const finalFilename = `${filename}.${extension}`;

        // 首先尝试使用fetch下载
        fetch(audioInfo.url, {
          method: 'GET',
          headers: headers,
          credentials: 'include',
          mode: 'cors'
        })
        .then(response => {
          // 检查响应类型
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('text/html')) {
            throw new Error('Received HTML instead of audio');
          }
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.blob();
        })
        .then(blob => {
          // 验证blob类型
          if (blob.type && blob.type.includes('text/html')) {
            throw new Error('Received HTML instead of audio');
          }
          
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({
            url: url,
            filename: finalFilename,
            saveAs: true
          }, (downloadId) => {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            if (chrome.runtime.lastError) {
              throw new Error(chrome.runtime.lastError.message);
            }
            sendResponse({ success: true, downloadId });
          });
        })
        .catch(error => {
          console.error('Fetch failed:', error);
          // 如果fetch失败，尝试直接下载
          chrome.downloads.download({
            url: audioInfo.url,
            filename: finalFilename,
            saveAs: true,
            headers: [
              { name: 'Referer', value: audioInfo.referer || '' },
              { name: 'Origin', value: new URL(audioInfo.url).origin },
              { name: 'Accept', value: 'audio/*,*/*' }
            ]
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message
              });
            } else {
              sendResponse({ success: true, downloadId });
            }
          });
        });

      } catch (error) {
        console.error('Download setup failed:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }

      return true; // 保持��息通道开启
    }

    // 简化的fetch下载函数
    function trySimpleFetch(url, filename, sendResponse) {
      fetch(url)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return response.blob();
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message
              });
            } else {
              sendResponse({
                success: true,
                downloadId: downloadId
              });
            }
          });
        })
        .catch(error => {
          console.error('Fetch download failed:', error);
          // 最后一次尝试：直接下载
          chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message
              });
            } else {
              sendResponse({
                success: true,
                downloadId: downloadId
              });
            }
          });
        });
    }

    if (message.type === 'START_DOWNLOAD') {
      const { url, filename, headers } = message.downloadInfo;
      
      // 使用XMLHttpRequest下载
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      
      // 设置请求头
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.onload = function() {
        if (xhr.status === 200) {
          const blob = xhr.response;
          const url = URL.createObjectURL(blob);
          
          // 使用chrome.downloads API下载
          chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            // 清理URL
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
            if (chrome.runtime.lastError) {
              console.error('Download failed:', chrome.runtime.lastError);
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message
              });
            } else {
              sendResponse({
                success: true,
                downloadId: downloadId
              });
            }
          });
        } else {
          sendResponse({
            success: false,
            error: `HTTP Error: ${xhr.status}`
          });
        }
      };

      xhr.onerror = function() {
        sendResponse({
          success: false,
          error: 'Network Error'
        });
      };

      // 发送请求
      xhr.send();
      return true; // 保持消息通道开启
    }

    if (message.type === 'BATCH_DOWNLOAD_AUDIO') {
      const { resources, tabUrl } = message.data;
      
      (async () => {  // 使用立即执行的异步函数
        try {
          // 创建一个新的 JSZip 实例
          const zip = new JSZip();
          
          // 使用 Promise.all 并行下载所有音频
          const downloads = resources.map(async (resource) => {
            try {
              // 使用 background script 的 fetch 能力
              const response = await fetch(resource.url, {
                method: 'GET',
                headers: {
                  'Referer': tabUrl,
                  'Origin': new URL(tabUrl).origin,
                  'Accept': 'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.8',
                  'User-Agent': navigator.userAgent
                },
                credentials: 'include'
              });

              if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
              }

              const blob = await response.blob();
              const filename = resource.title ? 
                `${resource.title}.mp3` : 
                resource.url.split('/').pop() || 'audio.mp3';

              zip.file(filename, blob);
              return true;
            } catch (error) {
              console.error(`Failed to download ${resource.url}:`, error);
              return false;
            }
          });

          // 等待所有下载完成
          const results = await Promise.all(downloads);
          
          // 检查是否有文件成功下载
          if (!results.some(result => result)) {
            throw new Error('No files were downloaded successfully');
          }

          // 生成 zip 文件
          const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          });

          // 创建下载链接并触发下载
          const url = URL.createObjectURL(zipBlob);
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

          chrome.downloads.download({
            url: url,
            filename: `audio_collection_${timestamp}.zip`,
            saveAs: true
          }, (downloadId) => {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
            if (chrome.runtime.lastError) {
              sendResponse({ 
                success: false, 
                error: chrome.runtime.lastError.message 
              });
            } else {
              sendResponse({ success: true, downloadId });
            }
          });

        } catch (error) {
          console.error('Error in batch download:', error);
          sendResponse({ 
            success: false, 
            error: error.message 
          });
        }
      })();  // 立即执行异步函数

      return true; // 保持消息通道开启
    }

    // 添加新的下载方法
    function downloadViaContentScript(tabId, resources) {
      return new Promise(async (resolve, reject) => {
        try {
          // 注入下载脚本
          await chrome.scripting.executeScript({
            target: { tabId },
            func: async (resources) => {
              const zip = new JSZip();
              
              for (const resource of resources) {
                try {
                  // 使用页面上下文中的 fetch
                  const response = await fetch(resource.url);
                  if (!response.ok) continue;
                  
                  const blob = await response.blob();
                  const filename = resource.title ? 
                    `${resource.title}.mp3` : 
                    resource.url.split('/').pop() || 'audio.mp3';
                    
                  zip.file(filename, blob);
                } catch (error) {
                  console.error(`Failed to download ${resource.url}:`, error);
                }
              }

              // 生成并下载 zip
              const zipBlob = await zip.generateAsync({ type: 'blob' });
              const url = URL.createObjectURL(zipBlob);
              
              // 发送消息给 background 进行下载
              chrome.runtime.sendMessage({
                type: 'COMPLETE_BATCH_DOWNLOAD',
                data: { url }
              });
            },
            args: [resources]
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }
  } catch (error) {
    console.debug('Error handling message:', error);
    sendResponse({ error: error.message });
  }
});

// 获取文件扩展名
function getFileExtension(url) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  const extension = pathname.split('.').pop().toLowerCase();
  
  return Object.values(AUDIO_TYPES).includes(extension) 
    ? extension 
    : 'mp3'; // 默认扩展名
}

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

// 辅助函数：使用fetch尝试下载
function tryFetchDownload(audioInfo, headers, filename, sendResponse) {
  fetch(audioInfo.url, {
    method: 'GET',
    headers: headers,
    credentials: 'include',
    mode: 'cors'
  })
  .then(response => {
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    // 检查内容类型
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('audio') && !contentType.includes('application/octet-stream')) {
      throw new Error('Invalid content type: ' + contentType);
    }
    return response.blob();
  })
  .then(blob => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message
        });
      } else {
        sendResponse({
          success: true,
          downloadId: downloadId
        });
      }
    });
  })
  .catch(error => {
    console.error('Fetch download failed:', error);
    // 最后尝试使用原始URL直接下载
    chrome.downloads.download({
      url: audioInfo.url,
      filename: filename,
      saveAs: true,
      headers: Object.entries(headers).map(([name, value]) => ({name, value}))
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message
        });
      } else {
        sendResponse({
          success: true,
          downloadId: downloadId
        });
      }
    });
  });
}

// 在 isValidAudioResponse 函数后添加
function isAudioContentType(contentType) {
  // 检查是否是音频MIME类型
  return contentType.startsWith('audio/') || 
         contentType === 'application/ogg' ||
         Object.keys(AUDIO_TYPES).includes(contentType);
} 