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
};

// 存储当前显示的音频资源
let currentAudioResources = [];
let popupTabId = null;

// 存储音频时长信息
const audioDurations = new Map();

// 音频控制相关变量
let currentAudioInfo = null;
let progressUpdateInterval = null;

// 记录已知音频URL，用于识别新增项
let knownAudioUrls = new Set();
let isFirstLoad = true;

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
  const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
  popupTabId = activeTabs[0]?.id ?? null;

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
    let savedShowFloatIcon = true;
    toggle.disabled = true;
    chrome.storage.local.get(['showFloatIcon'], function(result) {
      if (chrome.runtime.lastError) {
        console.debug('Failed to read float icon setting:', chrome.runtime.lastError);
        return;
      }
      savedShowFloatIcon = result.showFloatIcon !== false;
      toggle.checked = savedShowFloatIcon;
      toggle.disabled = false;
    });

    // 各页面通过存储变化同步，不依赖当前标签页的加载状态。
    toggle.addEventListener('change', async function() {
      const showFloatIcon = this.checked;
      toggle.disabled = true;
      try {
        await chrome.storage.local.set({ showFloatIcon });
        savedShowFloatIcon = showFloatIcon;
      } catch (error) {
        toggle.checked = savedShowFloatIcon;
        console.debug('Failed to save float icon setting:', error);
        alert('悬浮图标设置保存失败，请重试。');
      } finally {
        toggle.disabled = false;
      }
    });
  }

  // 同步音频播放状态
  try {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs[0]) return;

    setupProgressBarEvents();

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
        }
      }
    }
  } catch (error) {
    console.debug('Error syncing audio status:', error);
  }
}

// 绑定进度条的点击与拖动事件，只在初始化时调用一次
function setupProgressBarEvents() {
  const progressBar = document.querySelector('.progress-bar');
  if (!progressBar) return;

  // 由鼠标位置换算成 0-1 的播放位置
  const getPosition = (clientX) => {
    const rect = progressBar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const seekTo = async (pos) => {
    if (!currentAudioInfo) return;
    try {
      await sendMessageToTab(currentAudioInfo.tabId, {
        type: 'SEEK_AUDIO',
        position: pos
      });
    } catch (error) {
      console.debug('Error seeking audio:', error);
    }
  };

  let isDragging = false;

  progressBar.addEventListener('click', (e) => {
    if (!currentAudioInfo) return;
    seekTo(getPosition(e.clientX));
  });

  progressBar.addEventListener('mousedown', () => {
    isDragging = true;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentAudioInfo) return;

    const pos = getPosition(e.clientX);
    const progressCurrent = progressBar.querySelector('.progress-current');
    progressCurrent.style.width = `${pos * 100}%`;
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    seekTo(getPosition(e.clientX));
  });
}

// 重置试听按钮和播放器面板
function resetPreviewUI() {
  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.textContent = '试听';
    btn.classList.remove('playing');
  });

  const previewContainer = document.getElementById('audioPreview');
  if (previewContainer) {
    previewContainer.style.display = 'none';
  }

  const progressCurrent = document.querySelector('.progress-bar .progress-current');
  if (progressCurrent) {
    progressCurrent.style.width = '0%';
  }

  stopProgressUpdate();
}

// 修改 DOMContentLoaded 事件监听
document.addEventListener('DOMContentLoaded', initializePopup);

// 监听来自background的更新消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AUDIO_RESOURCES_UPDATED' && message.tabId === popupTabId) {
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
    emptyState.style.display = 'flex';
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

  // 按时间降序排序，新音频在前
  resources.sort((a, b) => b.timestamp - a.timestamp);

  // 识别新增的音频URL
  const now = Date.now();
  const newUrls = new Set();
  if (isFirstLoad) {
    // 首次加载：最近5秒内检测到的标为新
    resources.forEach(r => {
      if (now - r.timestamp < 5000) {
        newUrls.add(r.url);
      }
    });
  } else {
    // 后续更新：不在已知集合中的标为新
    resources.forEach(r => {
      if (!knownAudioUrls.has(r.url)) {
        newUrls.add(r.url);
      }
    });
  }
  // 更新已知URL集合
  resources.forEach(r => knownAudioUrls.add(r.url));
  isFirstLoad = false;

  audioList.innerHTML = resources
    .map((resource, index) => createAudioItemHTML(resource, index, newUrls.has(resource.url)))
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
        durationElement.textContent = '时长未知';
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
function createAudioItemHTML(resource, index, isNew = false) {
  const filename = getFilenameFromUrl(resource.url, resource);
  const format = getAudioFormat(resource.url, resource.contentType) || '未知';
  const duration = audioDurations.get(resource.url) || '获取中...';
  const newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';

  return `
    <div class="audio-item">
      <div class="audio-item-header">
        <div class="audio-info">
          <div class="audio-name"><span class="audio-name-text">${filename}</span>${newBadge}</div>
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
  // 无法判断格式时统一按 mp3 处理，避免下载出无扩展名的文件
  const ext = (getAudioFormat(url, resource?.contentType) || 'MP3').toLowerCase();

  try {
    // 1. 优先使用找到的标题
    if (resource.title) {
      // 处理标题中的非法字符
      const cleanTitle = resource.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
      if (cleanTitle) {
        return `${cleanTitle}.${ext}`;
      }
    }

    // 2. 如果没有标题，使用URL中的文件名
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();

    if (!filename) {
      return `未知音频.${ext}`;
    }

    // 3. 如果文件名看起来是ID，添加前缀
    if (/^[a-f0-9]{8,}$/i.test(filename)) {
      return `audio_${filename}.${ext}`;
    }

    // 4. 文件名自带音频扩展名时直接使用，否则补上推断出的扩展名
    const currentExt = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    return KNOWN_FORMATS.includes(currentExt) ? filename : `${filename}.${ext}`;
  } catch (e) {
    return `未知音频.${ext}`;
  }
}

// 下载单个音频
async function downloadAudio(index) {
  const resource = currentAudioResources[index];
  if (!resource) return;

  try {
    // 获取当前标签页
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

  // 固定本次打包列表，网络嗅探更新不得改变正在执行的循环
  const resourcesToDownload = [...currentAudioResources];

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
    const failedDownloads = [];
    let successCount = 0;

    // 逐个获取，避免多个大文件同时转 base64 导致弹窗内存暴涨
    for (let index = 0; index < resourcesToDownload.length; index += 1) {
      const resource = resourcesToDownload[index];
      downloadBtn.innerHTML = `
        <svg class="spinner" width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
        获取中 ${index + 1}/${resourcesToDownload.length}
      `;

      try {
        const blob = await fetchAudioBlob(resource.url);
        const filename = getFilenameFromUrl(resource.url, resource);
        zip.file(filename, blob);
        successCount += 1;
      } catch (error) {
        console.debug(`Failed to download ${resource.url}:`, error);
        failedDownloads.push(error.message || '未知错误');
      }
    }
    
    // 检查是否有文件成功下载
    if (successCount === 0) {
      throw new Error(failedDownloads[0] || '所有音频获取失败');
    }

    // 生成zip文件
    downloadBtn.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
      正在生成 ZIP...
    `;
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // 创建下载链接并触发下载
    const url = URL.createObjectURL(zipBlob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    try {
      await chrome.downloads.download({
        url: url,
        filename: `audio_collection_${timestamp}.zip`,
        saveAs: true
      });
    } finally {
      // 留出充足时间让 downloads API 读取 blob URL
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    if (failedDownloads.length > 0) {
      alert(`已打包 ${successCount} 个音频，${failedDownloads.length} 个获取失败`);
    }

  } catch (error) {
    console.debug('Error in batch download:', error);
    alert(`批量下载失败：${error.message || '未知错误'}`);
  } finally {
    // 恢复按钮状态
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = originalText;
  }
}

// 扩展页面借助 host_permissions 与 DNR 请求头规则获取音频
async function fetchAudioBlob(url) {
  let directError = null;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'audio/*,*/*',
        'Range': 'bytes=0-'
      },
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (blob.size === 0) {
      throw new Error('音频文件为空');
    }
    return blob;
  } catch (error) {
    directError = error;
  }

  throw directError || new Error('音频获取失败');
}

// 已知音频扩展名
const KNOWN_FORMATS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma', 'webm'];

// 获取音频格式，contentType 来自响应头，比 URL 更可靠
function getAudioFormat(url, contentType = '') {
  // 1. 优先用响应头的 MIME 类型
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (AUDIO_TYPES[mime]) {
    return AUDIO_TYPES[mime].toUpperCase();
  }

  try {
    const urlObj = new URL(url);

    // 2. 从URL的文件扩展名获取格式
    const extension = urlObj.pathname.toLowerCase().split('.').pop();
    if (KNOWN_FORMATS.includes(extension)) {
      return extension.toUpperCase();
    }

    // 3. 从URL参数获取格式
    const searchParams = urlObj.searchParams;
    const format = (searchParams.get('format') || searchParams.get('type') || '').toLowerCase();
    if (KNOWN_FORMATS.includes(format)) {
      return format.toUpperCase();
    }
  } catch (e) {
    // URL 解析失败时走下面的兜底
  }

  // 4. 无从判断时返回空，由调用方决定是否补扩展名
  return '';
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
      
      resetPreviewUI();
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
    } else {
      throw new Error(response.error || 'Failed to play audio');
    }
  } catch (error) {
    console.error('Failed to play audio:', error);
    alert('无法播放音频，请检查网络连接或重试。');
    resetPreviewUI();
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
      if (!status || !status.isPlaying) {
        resetPreviewUI();
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

        // 设置跨域属性
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
