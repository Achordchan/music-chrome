// 音频文件的 MIME 类型和扩展名
const AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a'
};

// 存储当前显示的音频资源
let currentAudioResources = [];

// 存储音频时长信息
const audioDurations = new Map();

// 音频控制相关变量
let currentAudioInfo = null;
let progressUpdateInterval = null;

// 添加标签页状态检查函数
async function isTabReady(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab && tab.status === 'complete';
  } catch {
    return false;
  }
}

// 在发送消息前检查标签页状态
async function sendMessageToTab(tabId, message) {
  if (!await isTabReady(tabId)) {
    return null;
  }

  try {
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  } catch {
    return null;
  }
}

// 初始化
async function initializePopup() {
  // 获取当前检测到的音频资源
  chrome.runtime.sendMessage({ type: 'GET_AUDIO_RESOURCES' }, (response) => {
    updateAudioList(response || []);
  });

  // 检查元素是否存在后再添加事件监听
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', downloadAll);
  }

  // 检查开关元素是否存在
  const toggle = document.getElementById('floatIconToggle');
  if (toggle) {
    // 从存储中获取开关状态
    chrome.storage.local.get(['showFloatIcon'], function(result) {
      toggle.checked = result.showFloatIcon !== false;
    });

    // 监听开关变化
    toggle.addEventListener('change', async function() {
      const showFloatIcon = this.checked;
      chrome.storage.local.set({ showFloatIcon: showFloatIcon });
      
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs[0]) {
        await sendMessageToTab(tabs[0].id, {
          type: 'TOGGLE_FLOAT_ICON',
          show: showFloatIcon
        });
      }
    });
  }

  // 同步音频播放状态
  try {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs[0]) return;

    const status = await sendMessageToTab(tabs[0].id, {
      type: 'GET_AUDIO_STATUS'
    }) || { isPlaying: false };

    if (status.isPlaying && status.url) {
      // 找到正在播放的音频索引
      const audioIndex = currentAudioResources.findIndex(resource => resource.url === status.url);
      if (audioIndex !== -1) {
        const previewBtn = document.getElementById(`preview-${audioIndex}`);
        const previewContainer = document.getElementById('audioPreview');
        if (previewBtn && previewContainer) {
          // 更新按钮状态
          previewBtn.textContent = '停止';
          previewBtn.classList.add('playing');
          
          // 显示预览容器
          previewContainer.style.display = 'block';

          // 保存当前音频信息
          currentAudioInfo = {
            tabId: tabs[0].id,
            url: status.url,
            index: audioIndex
          };

          // 开始更新进度条
          startProgressUpdate(tabs[0].id);

          // 添加进度条事件监听
          setupProgressBarEvents(tabs[0].id);
        }
      }
    }
  } catch (error) {
    console.debug('Error syncing audio status:', error);
  }
}

// 将进度条事件监听抽取为单独的函数
function setupProgressBarEvents(tabId) {
  const progressBar = document.querySelector('.progress-bar');
  if (!progressBar) return;

  // 移除旧的事件监听器
  const newProgressBar = progressBar.cloneNode(true);
  progressBar.parentNode.replaceChild(newProgressBar, progressBar);

  // 添加点击事件
  newProgressBar.addEventListener('click', async (e) => {
    if (!currentAudioInfo) return;
    
    const rect = newProgressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    
    try {
      await sendMessageToTab(tabId, {
        type: 'SEEK_AUDIO',
        position: pos
      });
    } catch (error) {
      console.debug('Error seeking audio:', error);
    }
  });

  // 添加拖动功能
  let isDragging = false;
  newProgressBar.addEventListener('mousedown', () => {
    isDragging = true;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentAudioInfo) return;
    
    const rect = newProgressBar.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));
    
    const progressCurrent = newProgressBar.querySelector('.progress-current');
    progressCurrent.style.width = `${pos * 100}%`;
  });

  document.addEventListener('mouseup', async (e) => {
    if (!isDragging || !currentAudioInfo) {
      isDragging = false;
      return;
    }
    
    const rect = newProgressBar.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));
    
    try {
      await sendMessageToTab(currentAudioInfo.tabId, {
        type: 'SEEK_AUDIO',
        position: pos
      });
    } catch (error) {
      console.debug('Error seeking audio:', error);
    }
    
    isDragging = false;
  });
}

// 修改 DOMContentLoaded 事件监听
document.addEventListener('DOMContentLoaded', initializePopup);

// 监听来自background的更新消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AUDIO_RESOURCES_UPDATED') {
    updateAudioList(message.data);
  }
});

// 更新音频列表
async function updateAudioList(resources) {
  currentAudioResources = resources;
  const audioList = document.getElementById('audioList');
  const emptyState = document.getElementById('emptyState');
  const downloadAllBtn = document.getElementById('downloadAllBtn');

  if (resources.length === 0) {
    audioList.style.display = 'none';
    emptyState.style.display = 'block';
    // 禁用下载全部按钮
    downloadAllBtn.disabled = true;
    downloadAllBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M8 1.5a.5.5 0 0 1 .5.5v9.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 11.293V2a.5.5 0 0 1 .5-.5z"/>
      </svg>
      暂无可下载
    `;
    return;
  }

  audioList.style.display = 'block';
  emptyState.style.display = 'none';
  // 启用下载全部按钮
  downloadAllBtn.disabled = false;
  downloadAllBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 1.5a.5.5 0 0 1 .5.5v9.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 11.293V2a.5.5 0 0 1 .5-.5z"/>
    </svg>
    下载全部
  `;

  audioList.innerHTML = resources
    .map((resource, index) => createAudioItemHTML(resource, index))
    .join('');

  // 获取音频时长
  resources.forEach(async (resource, index) => {
    const durationElement = audioList.querySelector(`#preview-${index}`).parentNode.parentNode.querySelector('.audio-duration');
    
    if (!audioDurations.has(resource.url)) {
      try {
        durationElement.textContent = '获取中...';
        const duration = await getAudioDuration(resource.url);
        if (duration !== '时长未知') {
          audioDurations.set(resource.url, duration);
          durationElement.textContent = duration;
        } else {
          durationElement.textContent = '时长未知';
        }
      } catch (error) {
        durationElement.textContent = '时长���知';
      }
    } else {
      durationElement.textContent = audioDurations.get(resource.url);
    }
  });

  // 绑定按钮事件
  resources.forEach((_, index) => {
    document.getElementById(`download-${index}`)
      .addEventListener('click', () => downloadAudio(index));
    document.getElementById(`preview-${index}`)
      .addEventListener('click', () => previewAudio(index));
  });
}

// 创建音频项的HTML
function createAudioItemHTML(resource, index) {
  const filename = getFilenameFromUrl(resource.url, resource);
  const format = getAudioFormat(resource.url);
  const duration = audioDurations.get(resource.url) || '获取中...';
  
  return `
    <div class="audio-item">
      <div class="audio-item-header">
        <div class="audio-info">
          <div class="audio-name">${filename}</div>
          <div class="audio-meta">
            <span class="audio-format">${format}</span>
            <span class="audio-duration">${duration}</span>
            <span>${new Date(resource.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
        <div class="audio-controls">
          <button id="preview-${index}" class="preview-btn">试听</button>
          <button id="download-${index}" class="download-btn">下载</button>
        </div>
      </div>
    </div>
  `;
}

// 从URL中获取文件名
function getFilenameFromUrl(url, resource) {
  try {
    // 1. 优先使用找到的标题
    if (resource.title) {
      // 处理标题中的非法字符
      const cleanTitle = resource.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
      return `${cleanTitle}.${getAudioFormat(url).toLowerCase()}`;
    }

    // 2. 如果没有标题，使用URL中的文件名
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    
    // 3. 如果文件名看起来是ID，添加前缀
    if (/^[a-f0-9]{8,}$/i.test(filename)) {
      return `audio_${filename}`;
    }
    
    return filename || '未知音频';
  } catch (e) {
    return '未知音频';
  }
}

// 下载单个音频
async function downloadAudio(index) {
  const resource = currentAudioResources[index];
  if (!resource) return;

  try {
    // 取当前标签页
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs[0]) {
      return; // 静默失败
    }

    // 发送消息给content script获取下载信息
    await sendMessageToTab(tabs[0].id, {
      type: 'PREPARE_DOWNLOAD',
      url: resource.url
    });
  } catch (error) {
    // 静默处理错误
    console.debug('Download initiated:', resource.url);
  }
}

// 下载所有音频
async function downloadAll() {
  // 检查音频数量
  if (currentAudioResources.length === 0) {
    return; // 如果没有音频，直接返回
  }

  // 如果只有一个音频，显示提示并直接下载
  if (currentAudioResources.length === 1) {
    alert('就一个你还要批量下载啊？');
    // 直接调用单个下载
    await downloadAudio(0);
    return;
  }

  const downloadBtn = document.getElementById('downloadAllBtn');
  const originalText = downloadBtn.innerHTML;
  
  try {
    // 更新按钮状态
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
      打包中...
    `;

    // 获取当前标签页
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs[0]) {
      throw new Error('No active tab found');
    }

    // 创建一个新的 JSZip 实例
    const zip = new JSZip();
    
    // 用于存储所有下载Promise的数组
    const downloads = currentAudioResources.map(async (resource) => {
      try {
        const response = await fetch(resource.url, {
          method: 'GET',
          headers: {
            'Accept': 'audio/*,*/*',
            'Referer': tabs[0].url,
            'Origin': new URL(tabs[0].url).origin
          },
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }

        const blob = await response.blob();
        const filename = getFilenameFromUrl(resource.url, resource);
        await zip.file(filename, blob);
        return true;
      } catch (error) {
        console.debug(`Failed to download ${resource.url}:`, error);
        return false;
      }
    });

    // 等待所有下载完成
    const results = await Promise.all(downloads);
    
    // 检查是否有文件成功下载
    if (!results.some(result => result)) {
      throw new Error('No files were downloaded successfully');
    }

    // 生成zip文件
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
    });

  } catch (error) {
    console.debug('Error in batch download:', error);
    alert('批量下载失败，请重试');
  } finally {
    // 恢复按钮状态
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = originalText;
  }
}

// 获取音频格式
function getAudioFormat(url) {
  try {
    // 1. 从URL的文件扩展名获取格式
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const extension = pathname.split('.').pop();
    
    // 检查是否是已知的音频格式
    const knownFormats = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma', 'webm'];
    if (knownFormats.includes(extension)) {
      return extension.toUpperCase();
    }
    
    // 2. 从MIME类型获取格式
    const mimeType = Object.keys(AUDIO_TYPES).find(type => url.includes(type));
    if (mimeType) {
      return AUDIO_TYPES[mimeType].toUpperCase();
    }
    
    // 3. 从URL参数获取格式
    const searchParams = new URLSearchParams(urlObj.search);
    const format = searchParams.get('format') || searchParams.get('type');
    if (format && knownFormats.includes(format.toLowerCase())) {
      return format.toUpperCase();
    }
    
    // 4. 默认返回MP3
    return 'MP3';
  } catch (e) {
    return 'MP3';
  }
}

// 预览音频
async function previewAudio(index) {
  const resource = currentAudioResources[index];
  if (!resource) return;

  const previewContainer = document.getElementById('audioPreview');
  if (!previewContainer) return;

  const previewBtn = document.getElementById(`preview-${index}`);
  if (!previewBtn) return;

  try {
    // 获取当前标签页
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs[0]) {
      throw new Error('No active tab found');
    }

    // 获取当前播放状态
    let status;
    try {
      status = await sendMessageToTab(tabs[0].id, {
        type: 'GET_AUDIO_STATUS'
      }) || { isPlaying: false };
    } catch (error) {
      status = { isPlaying: false };
    }

    // 如果当前正在播放这个音频，就停止它
    if (status.isPlaying && status.url === resource.url) {
      try {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'STOP_AUDIO'
          }, resolve);
        });
      } catch (error) {
        console.error('Error stopping audio:', error);
      }
      
      previewBtn.textContent = '试听';
      previewBtn.classList.remove('playing');
      previewContainer.style.display = 'none';
      stopProgressUpdate();
      return;
    }

    // 显示预览容器
    previewContainer.style.display = 'block';

    // 播放新的音频
    const response = await sendMessageToTab(tabs[0].id, {
      type: 'PLAY_AUDIO',
      url: resource.url
    }) || { status: 'error', error: 'Failed to connect' };

    if (response.status === 'playing') {
      // 更新按钮状态
      const allPreviewBtns = document.querySelectorAll('.preview-btn');
      allPreviewBtns.forEach(btn => {
        btn.textContent = '试听';
        btn.classList.remove('playing');
      });
      previewBtn.textContent = '停止';
      previewBtn.classList.add('playing');

      // 保存当前音频信息
      currentAudioInfo = {
        tabId: tabs[0].id,
        url: resource.url,
        index: index
      };

      // 开始更新进度条
      startProgressUpdate(tabs[0].id);

      // 添加进度条点击事件
      const progressBar = document.querySelector('.progress-bar');
      progressBar.addEventListener('click', async (e) => {
        if (!currentAudioInfo) return;
        
        const rect = progressBar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        
        try {
          await sendMessageToTab(tabs[0].id, {
            type: 'SEEK_AUDIO',
            position: pos
          });
        } catch (error) {
          console.debug('Error seeking audio:', error);
        }
      });

      // 添加进度条拖动功能
      let isDragging = false;
      progressBar.addEventListener('mousedown', () => {
        isDragging = true;
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging || !currentAudioInfo) return;
        
        const rect = progressBar.getBoundingClientRect();
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos)); // 限制在 0-1 之间
        
        // 更新进度条显示
        const progressCurrent = progressBar.querySelector('.progress-current');
        progressCurrent.style.width = `${pos * 100}%`;
      });

      document.addEventListener('mouseup', async (e) => {
        if (!isDragging || !currentAudioInfo) {
          isDragging = false;
          return;
        }
        
        const rect = progressBar.getBoundingClientRect();
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos)); // 限制在 0-1 之间
        
        try {
          await sendMessageToTab(currentAudioInfo.tabId, {
            type: 'SEEK_AUDIO',
            position: pos
          });
        } catch (error) {
          console.debug('Error seeking audio:', error);
        }
        
        isDragging = false;
      });
    } else {
      throw new Error(response.error || 'Failed to play audio');
    }
  } catch (error) {
    console.error('Failed to play audio:', error);
    alert('无法播放音频，请检查网络连接或重试。');
    
    // 重置按钮状态
    previewBtn.textContent = '试听';
    previewBtn.classList.remove('playing');
    previewContainer.style.display = 'none';
    stopProgressUpdate();
  }
}

// 开始更新进度条
function startProgressUpdate(tabId) {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
  }

  progressUpdateInterval = setInterval(async () => {
    try {
      const status = await sendMessageToTab(tabId, {
        type: 'GET_AUDIO_STATUS'
      });
      if (!status) {
        stopProgressUpdate();
        return;
      }

      const progressBar = document.querySelector('.progress-bar');
      const progressCurrent = progressBar.querySelector('.progress-current');
      const currentTimeEl = document.querySelector('.current-time');
      const durationEl = document.querySelector('.duration');

      // 更新进度条
      const progress = (status.currentTime / status.duration) * 100;
      progressCurrent.style.width = `${progress}%`;

      // 更新时间显示
      currentTimeEl.textContent = formatTime(status.currentTime);
      durationEl.textContent = formatTime(status.duration);
    } catch (error) {
      console.error('Error updating progress:', error);
      stopProgressUpdate();
    }
  }, 100);
}

// 停止更新进度条
function stopProgressUpdate() {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
    progressUpdateInterval = null;
  }
  currentAudioInfo = null;
}

// 格式化时间
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 获取音频时长
async function getAudioDuration(url) {
  return new Promise((resolve) => {
    // 首先尝试从页面中查找已存在的音频元素
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs[0]) {
        resolve('时长未知');
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'GET_AUDIO_DURATION',
        url: url
      }, (response) => {
        if (response && response.duration) {
          const duration = response.duration;
          const minutes = Math.floor(duration / 60);
          const seconds = Math.floor(duration % 60);
          resolve(`${minutes}:${seconds.toString().padStart(2, '0')}`);
          return;
        }

        // 如果无法从页面获取，创建新的音频元素尝试
        const audio = new Audio();
        
        const cleanup = () => {
          audio.removeEventListener('loadedmetadata', handleSuccess);
          audio.removeEventListener('error', handleError);
          if (audio.src.startsWith('blob:')) {
            URL.revokeObjectURL(audio.src);
          }
        };

        const handleSuccess = () => {
          const duration = audio.duration;
          cleanup();
          if (isNaN(duration) || duration === Infinity) {
            resolve('时长未知');
          } else {
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60);
            resolve(`${minutes}:${seconds.toString().padStart(2, '0')}`);
          }
        };

        const handleError = () => {
          cleanup();
          resolve('时长未知');
        };

        audio.addEventListener('loadedmetadata', handleSuccess);
        audio.addEventListener('error', handleError);

        // 置跨域属性
        audio.crossOrigin = 'anonymous';

        // 先尝试直接加载
        audio.src = url;
        
        // 如果直接加载失败，尝试使用fetch
        audio.onerror = async () => {
          try {
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Accept': '*/*',
                'Range': 'bytes=0-',
                'Referer': url
              }
            });

            if (!response.ok) {
              handleError();
              return;
            }

            const blob = await response.blob();
            audio.src = URL.createObjectURL(blob);
          } catch (error) {
            handleError();
          }
        };

        // 3秒超时
        setTimeout(handleError, 3000);
      });
    });
  });
}

// 添加加载动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spinner {
    animation: spin 1s linear infinite;
  }
  .download-all-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
`;
document.head.appendChild(style); 