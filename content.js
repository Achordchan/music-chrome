// 存储检测到的音频元素和标题
let audioElements = new Set();
let audioTitles = new Map();
let currentPlayingAudio = null;

// 存储原始的音频元素
const originalAudioElements = new Map();

// 向background script报告检测到的音频元素
function reportAudioElement(url, title) {
  chrome.runtime.sendMessage({
    type: 'AUDIO_ELEMENT_FOUND',
    data: {
      url: url,
      title: title,
      timestamp: Date.now()
    }
  });
}

// 监听音频播放事件
document.addEventListener('play', function(e) {
  // 只处理音频元素
  if (e.target.tagName === 'AUDIO') {
    const audioElement = e.target;
    
    // 获取音频信息
    const audioInfo = {
      url: audioElement.currentSrc || audioElement.src,
      title: audioElement.title || findAudioTitle(audioElement) || document.title,
      timestamp: Date.now()
    };

    // 只有在URL有效时才报告
    if (audioInfo.url && !audioElements.has(audioInfo.url)) {
      audioElements.add(audioInfo.url);
      reportAudioElement(audioInfo.url, audioInfo.title);
    }
  }
}, true);

// 添加悬浮按钮
function addFloatingButton() {
  const button = document.createElement('div');
  button.className = 'audio-sniffer-float-btn';
  button.id = 'audioSnifferFloatBtn';
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
    </svg>
    <div class="audio-sniffer-badge" id="audioSnifferBadge">0</div>
  `;
  
  // 添加样式
  const style = document.createElement('style');
  style.textContent = `
    .audio-sniffer-float-btn {
      position: fixed;
      left: 20px;
      bottom: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #007AFF;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    }

    .audio-sniffer-float-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .audio-sniffer-float-btn svg {
      fill: white;
      width: 24px;
      height: 24px;
    }

    .audio-sniffer-badge {
      position: absolute;
      top: -8px;
      right: -8px;
      background: #FF3B30;
      color: white;
      border-radius: 12px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      font-size: 12px;
      font-weight: bold;
      font-family: -apple-system, system-ui, BlinkMacSystemFont;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      visibility: hidden;
      transform: scale(0);
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    .audio-sniffer-badge.active {
      visibility: visible;
      transform: scale(1);
    }

    @media (max-width: 768px) {
      .audio-sniffer-float-btn {
        width: 40px;
        height: 40px;
        left: 16px;
        bottom: 16px;
      }
      
      .audio-sniffer-float-btn svg {
        width: 20px;
        height: 20px;
      }

      .audio-sniffer-badge {
        min-width: 18px;
        height: 18px;
        font-size: 10px;
      }
    }
  `;

  // 修改点击事件处理
  button.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }, (response) => {
        if (chrome.runtime.lastError) {
          console.debug('Extension context error:', chrome.runtime.lastError);
          // 不再重新加载页面
        }
      });
    } catch (error) {
      console.debug('Failed to open popup:', error);
      // 不再重新加载页面
    }
  });

  // 添加到页面
  document.head.appendChild(style);
  document.body.appendChild(button);

  // 创建一个消息监听器
  const messageListener = (message) => {
    console.log('Content script received message:', message); // 添加调试日志
    if (message.type === 'AUDIO_RESOURCES_UPDATED' && Array.isArray(message.data)) {
      console.log('Updating badge with count:', message.data.length); // 添加调试日志
      updateBadge(message.data.length);
    }
  };

  // 添加消息监听
  chrome.runtime.onMessage.addListener(messageListener);

  // 初始获取音频数量
  chrome.runtime.sendMessage({ type: 'GET_AUDIO_RESOURCES' }, (response) => {
    console.log('Initial audio resources:', response); // 添加调试日志
    if (Array.isArray(response)) {
      updateBadge(response.length);
    }
  });

  // 从存储中获取开关状态并设置初始显示状态
  chrome.storage.local.get(['showFloatIcon'], function(result) {
    if (result.showFloatIcon === false) {
      button.style.display = 'none';
    } else {
      button.style.display = 'flex';
    }
  });

  // 监听开关消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (handleExtensionError()) return;

    if (message.type === 'TOGGLE_FLOAT_ICON') {
      const floatBtn = document.getElementById('audioSnifferFloatBtn');
      if (floatBtn) {
        floatBtn.style.display = message.show ? 'flex' : 'none';
      }
    }
    // ... 其他消息处理保持不变 ...
  });
}

// 更新角标
function updateBadge(count) {
  const badge = document.getElementById('audioSnifferBadge');
  if (badge) {
    badge.textContent = count;
    if (count > 0) {
      badge.classList.add('active');
      console.log('Badge activated with count:', count); // 添加调试日志
    } else {
      badge.classList.remove('active');
      console.log('Badge deactivated'); // 添加调试日志
    }
  } else {
    console.log('Badge element not found'); // 添加调试日志
  }
}

// 在页面加载完成后添加按钮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addFloatingButton);
} else {
  addFloatingButton();
}

// 修改错误处理函数
function handleExtensionError() {
  // 检查扩展是否有效
  if (!chrome.runtime?.id) {
    console.debug('Extension context invalid');
    return true;
  }
  return false;
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_AUDIO') {
    try {
      // 停止当前正在播放的音频
      if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        currentPlayingAudio.currentTime = 0;
      }

      // 尝试查找页面上已存在的相同URL的音频/视频元素
      const existingMedia = Array.from(document.querySelectorAll('audio, video')).find(
        media => media.src === message.url || media.dataset.originalSrc === message.url ||
                Array.from(media.getElementsByTagName('source')).some(source => source.src === message.url)
      );

      if (existingMedia) {
        // 如果找到现有的媒体元素，直接使用它
        currentPlayingAudio = existingMedia;
        currentPlayingAudio.play()
          .then(() => sendResponse({ status: 'playing' }))
          .catch(error => {
            console.error('Error playing existing media:', error);
            sendResponse({ status: 'error', error: error.message });
          });
      } else {
        // 创建新的音频元素
        let audioElement = document.createElement('audio');
        audioElement.setAttribute('data-sniffer-url', message.url);
        audioElement.style.display = 'none';
        audioElement.controls = false;
        
        // 设置事件监听器
        audioElement.onplay = () => {
          sendResponse({ status: 'playing' });
          currentPlayingAudio = audioElement;
        };

        audioElement.onpause = () => {
          sendResponse({ status: 'paused' });
        };

        audioElement.onended = () => {
          sendResponse({ status: 'ended' });
        };

        audioElement.onerror = (e) => {
          console.error('Audio error:', e);
          // 如果播放失败，尝试使用原始元素
          const originalMedia = Array.from(document.querySelectorAll('audio, video')).find(
            media => media.src === message.url || 
                    Array.from(media.getElementsByTagName('source')).some(source => source.src === message.url)
          );
          
          if (originalMedia) {
            currentPlayingAudio = originalMedia;
            originalMedia.play()
              .then(() => sendResponse({ status: 'playing' }))
              .catch(error => sendResponse({ status: 'error', error: error.message }));
          } else {
            sendResponse({ status: 'error', error: e.message });
          }
        };

        // 设置音频源并播放
        audioElement.src = message.url;
        audioElement.dataset.originalSrc = message.url;
        document.body.appendChild(audioElement);
        
        audioElement.play()
          .catch(error => {
            console.error('Error playing new audio:', error);
            // 如果直接播放失败，尝试克��原始元素的方式
            const originalMedia = Array.from(document.querySelectorAll('audio, video')).find(
              media => media.src === message.url || 
                      Array.from(media.getElementsByTagName('source')).some(source => source.src === message.url)
            );
            
            if (originalMedia) {
              const clonedMedia = originalMedia.cloneNode(true);
              clonedMedia.style.display = 'none';
              originalMedia.parentElement.appendChild(clonedMedia);
              currentPlayingAudio = clonedMedia;
              return clonedMedia.play();
            }
            throw error;
          })
          .then(() => sendResponse({ status: 'playing' }))
          .catch(error => sendResponse({ status: 'error', error: error.message }));
      }

      return true; // 保持消息通道开启
    } catch (error) {
      console.error('Error playing audio:', error);
      sendResponse({ status: 'error', error: error.message });
    }
  }

  if (message.type === 'STOP_AUDIO') {
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio.currentTime = 0;
      currentPlayingAudio = null;
    }
    sendResponse({ status: 'stopped' });
  }

  if (message.type === 'GET_AUDIO_STATUS') {
    if (currentPlayingAudio) {
      sendResponse({
        isPlaying: !currentPlayingAudio.paused,
        currentTime: currentPlayingAudio.currentTime,
        duration: currentPlayingAudio.duration,
        url: currentPlayingAudio.getAttribute('data-sniffer-url')
      });
    } else {
      sendResponse({ isPlaying: false });
    }
  }

  if (message.type === 'GET_AUDIO_DATA') {
    // 查找原始音频元素
    const originalAudio = Array.from(document.getElementsByTagName('audio')).find(
      audio => audio.src === message.url || audio.src.includes(new URL(message.url).pathname.split('/').pop())
    );

    if (originalAudio) {
      // 获取音频的相关信息
      const audioInfo = {
        url: originalAudio.src,
        referer: window.location.href,
        cookie: document.cookie,
        title: originalAudio.title || document.title,
        type: originalAudio.type || 'audio/mpeg'
      };

      // 发送消息给background script处理下载
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_AUDIO_DATA',
        audioInfo: audioInfo
      }, (response) => {
        sendResponse(response);
      });

      return true; // 保持消息通道开启
    } else {
      sendResponse({
        success: false,
        error: 'Audio element not found'
      });
    }
  }

  if (message.type === 'SEEK_AUDIO') {
    if (currentPlayingAudio) {
      const duration = currentPlayingAudio.duration;
      currentPlayingAudio.currentTime = duration * message.position;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
  }

  if (message.type === 'PREPARE_DOWNLOAD') {
    try {
      // 查找原始音频元素
      const originalAudio = Array.from(document.getElementsByTagName('audio')).find(
        audio => audio.src === message.url || audio.src.includes(new URL(message.url).pathname.split('/').pop())
      );

      // 获取URL和文件名
      const url = originalAudio ? (originalAudio.currentSrc || originalAudio.src) : message.url;
      
      // 改进的文件名获取逻辑
      let filename = '';
      if (originalAudio) {
        // 1. 尝试从音频元素获取标题
        filename = originalAudio.title || originalAudio.getAttribute('data-title');
        
        // 2. 尝试从附近的元素获取标题
        if (!filename) {
          const parent = originalAudio.parentElement;
          const titleElement = parent?.querySelector('[class*="title"], [id*="title"], .song-name, .track-name');
          if (titleElement) {
            filename = titleElement.textContent.trim();
          }
        }
        
        // 3. 尝试从URL中获取文件名
        if (!filename) {
          const urlObj = new URL(url);
          const pathSegments = urlObj.pathname.split('/');
          const lastSegment = pathSegments[pathSegments.length - 1];
          filename = lastSegment.split('.')[0]; // 移除扩展名
        }
      }

      // 如果还是没有找到合适的文件名，使用时间戳
      if (!filename) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        filename = `audio_${timestamp}`;
      }

      // 清理文件名
      filename = filename
        .replace(/[<>:"/\\|?*]/g, '_') // 替换非法字符
        .replace(/\s+/g, '_')          // 替换空格
        .replace(/_+/g, '_')           // 合并多个下划线
        .replace(/^_+|_+$/g, '')       // 移除首尾下划线
        .substring(0, 100);            // 限制长度

      // 添加扩展名
      filename = `${filename}.mp3`;

      // 使用 fetch 下载
      fetch(url)
        .then(response => {
          if (!response.ok) {
            return response.blob(); // 即使状态不是200也继续尝试
          }
          return response.blob();
        })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
          }, 100);

          // 不发送响应，因为下载已经开始了
        })
        .catch(error => {
          // 静默处理错误
          console.debug('Download initiated with fallback');
        });

      // 立即返回成功
      sendResponse({ success: true });
      return true;
    } catch (error) {
      // 静默处理错误
      console.debug('Download initiated with fallback');
      sendResponse({ success: true });
    }
  }

  if (message.type === 'GET_AUDIO_DURATION') {
    try {
      // 查找页面中的音频元素
      const audioElements = Array.from(document.getElementsByTagName('audio'));
      const targetAudio = audioElements.find(audio => {
        // 检查完整URL匹配
        if (audio.src === message.url) return true;
        
        // 检查文件名匹配
        const audioUrl = new URL(audio.src);
        const messageUrl = new URL(message.url);
        const audioFileName = audioUrl.pathname.split('/').pop();
        const messageFileName = messageUrl.pathname.split('/').pop();
        return audioFileName === messageFileName;
      });

      if (targetAudio && !isNaN(targetAudio.duration)) {
        sendResponse({ duration: targetAudio.duration });
        return true;
      }

      // 如果找不到或无法获取时长，创建新的音频元素尝试加载
      const tempAudio = document.createElement('audio');
      tempAudio.style.display = 'none';
      document.body.appendChild(tempAudio);

      // 设置加载事件
      const loadPromise = new Promise((resolve, reject) => {
        tempAudio.addEventListener('loadedmetadata', () => {
          if (!isNaN(tempAudio.duration)) {
            resolve(tempAudio.duration);
          } else {
            reject(new Error('Invalid duration'));
          }
        });

        tempAudio.addEventListener('error', () => {
          reject(new Error('Failed to load audio'));
        });
      });

      // 设置超时
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 3000);
      });

      // 尝试直接加载
      tempAudio.src = message.url;

      // 等待加载完成或超时
      Promise.race([loadPromise, timeoutPromise])
        .then(duration => {
          document.body.removeChild(tempAudio);
          sendResponse({ duration });
        })
        .catch(async error => {
          // 如果直接加载失败，尝试使用fetch
          try {
            const response = await fetch(message.url, {
              method: 'GET',
              headers: {
                'Accept': 'audio/*,*/*',
                'Range': 'bytes=0-',
                'Referer': window.location.href,
                'Origin': window.location.origin
              },
              credentials: 'include'
            });

            if (!response.ok) throw new Error('Fetch failed');

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            // 创建新的音频元素尝试加载blob
            const blobAudio = document.createElement('audio');
            blobAudio.style.display = 'none';
            document.body.appendChild(blobAudio);

            const blobLoadPromise = new Promise((resolve, reject) => {
              blobAudio.addEventListener('loadedmetadata', () => {
                if (!isNaN(blobAudio.duration)) {
                  resolve(blobAudio.duration);
                } else {
                  reject(new Error('Invalid blob duration'));
                }
              });

              blobAudio.addEventListener('error', () => {
                reject(new Error('Failed to load blob audio'));
              });
            });

            blobAudio.src = blobUrl;

            const duration = await Promise.race([
              blobLoadPromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('Blob timeout')), 3000))
            ]);

            // 清理
            URL.revokeObjectURL(blobUrl);
            document.body.removeChild(blobAudio);
            sendResponse({ duration });
          } catch (fetchError) {
            console.debug('Failed to get duration:', fetchError);
            sendResponse({ duration: null });
          }
        });

      return true; // 保持消息通道开启
    } catch (error) {
      console.debug('Error getting audio duration:', error);
      sendResponse({ duration: null });
      return true;
    }
  }

  if (message.type === 'CHECK_AUDIO_PLAYING') {
    // 检查是否有正在播放的音频
    const playingAudio = Array.from(document.getElementsByTagName('audio')).find(
      audio => !audio.paused && !audio.ended
    );
    
    sendResponse({ isPlaying: !!playingAudio });
    return true;
  }
});

// 查找音频标题
function findAudioTitle(element) {
  // 1. 尝试获取音频元素的 title 性
  let title = element.getAttribute('title') || element.getAttribute('aria-label');
  
  // 2. 查找附近的标题元素
  if (!title) {
    const parent = element.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    
    // 查找可能包含标题的元素
    const titleElement = siblings.find(el => {
      const tagName = el.tagName.toLowerCase();
      return (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || 
              tagName === 'p' || tagName === 'span' || tagName === 'div') &&
             el.textContent.trim().length > 0 &&
             el.textContent.trim().length < 100; // 避免过长的文本
    });
    
    if (titleElement) {
      title = titleElement.textContent.trim();
    }
  }

  // 3. 向上查找最近的标题
  if (!title) {
    const closestTitle = element.closest('[class*="title"], [id*="title"], [class*="name"], [id*="name"]');
    if (closestTitle) {
      title = closestTitle.textContent.trim();
    }
  }

  // 4. 查找邻的文本节点
  if (!title) {
    const walker = document.createTreeWalker(
      element.parentElement || document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text.length > 0 && text.length < 100) {
        title = text;
        break;
      }
    }
  }

  return title || null;
}

// 从元素中提取可能的音频URL
function extractAudioUrls(element) {
  const urls = new Set();
  
  // 检查data属性
  Array.from(element.attributes).forEach(attr => {
    if (attr.value?.includes('.mp3') || 
        attr.value?.includes('.wav') || 
        attr.value?.includes('.ogg')) {
      try {
        const url = new URL(attr.value);
        urls.add(url.href);
      } catch (e) {
        // 忽略无效URL
      }
    }
  });

  return Array.from(urls);
}