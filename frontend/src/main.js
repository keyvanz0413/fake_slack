// ==================== Import Configuration and Helper Functions ====================
import { 
  fileToDataUrl, 
  messageAPI,
  validator, 
  authAPI,
  channelAPI,
  userAPI,
  showError, 
  hideError, 
  showCreateChannelModal,
  hideCreateChannelModal,
  showChannelDetailsModal,
  hideChannelDetailsModal,
  showChannelChatbox,
  hideChannelChatbox,
  getToken,
  setToken, 
  setUser, 
  getUser,
  removeToken, 
  removeUser,
  clearForm,
  formatFullDateTime,
  formatTimestamp
} from './helpers.js';
let currentChannelId = null;
let editMessageId = null, editMessageText = null, editMessageImage = null, editMessageSender = null;
let uploadedAvatarDataUrl = null, uploadedMessageImage = null;
let loadedMessageCount = 0, isLoadingMessages = false, hasMoreMessages = true, currentMessageStart = 0;
const MESSAGES_PER_PAGE = 20;
let notificationPollingInterval = null, channelMessageCounts = {}, cachedUserChannels = [], isPollingInProgress = false;
let unreadChannels = {};
let isNavigatingViaRouter = false;

// ==================== Offline Functionality Variables ====================
let isOfflineMode = false;
const OFFLINE_CACHE_KEY = 'slackr_offline_channel_cache';
const OFFLINE_LAST_CHANNEL_KEY = 'slackr_offline_last_channel_id';


// ==================== Offline Functionality Core Functions ====================

/**
 * Check current network status
 * @returns {boolean} - Whether online
 */
function isOnline() {
  return navigator.onLine;
}

/**
 * Save channel data to offline cache
 * @param {number} channelId - Channel ID
 * @param {Object} channelData - Channel data
 */
function saveOfflineCache(channelId, channelData) {
  try {
    const cacheObject = {
      channelId: channelId,
      channelInfo: channelData.channelInfo || {},
      messages: channelData.messages || [],
      members: channelData.members || [],
      cachedAt: new Date().toISOString(),
    };

    if (cacheObject.messages.length > 50) {
      cacheObject.messages = cacheObject.messages.slice(-50);
    }

    const jsonString = JSON.stringify(cacheObject);
    const sizeInBytes = new Blob([jsonString]).size;

    if (sizeInBytes > 4.5 * 1024 * 1024) {
      console.warn('Cache data too large, skipping save');
      return;
    }

    localStorage.setItem(OFFLINE_CACHE_KEY, jsonString);
    localStorage.setItem(OFFLINE_LAST_CHANNEL_KEY, channelId.toString());
  } catch (error) {
    console.error('Failed to save offline cache:', error);
  }
}

/**
 * Load channel data from offline cache
 * @returns {Object|null} - Cached data, returns null if not found
 */
function loadOfflineCache() {
  try {
    const cachedJson = localStorage.getItem(OFFLINE_CACHE_KEY);
    
    if (!cachedJson) {
      console.log('No offline cache found');
      return null;
    }

    const cachedData = JSON.parse(cachedJson);
    console.log(`Loaded offline cache: channel ${cachedData.channelId}, ${cachedData.messages.length} messages`);
    
    return cachedData;
  } catch (error) {
    console.error('Failed to load offline cache:', error);
    return null;
  }
}

/**
 * Initialize network status listeners
 */
function initNetworkListeners() {
  // Listen for online event
  window.addEventListener('online', () => {
    isOfflineMode = false;
    hideOfflineIndicator();
    showError('网络连接已恢复');
    setTimeout(() => hideError(), 2000);
    
    // Re-enable interactive elements
    enableInteractiveElements();
    
    const token = getToken();
    if (token && typeof startNotificationPolling === 'function') {
      startNotificationPolling();
    }
  });

  // Listen for offline event
  window.addEventListener('offline', () => {
    isOfflineMode = true;
    showOfflineIndicator();
    showError('您现在处于离线模式。您只能查看缓存内容，无法进行任何操作。');
    
    // Disable interactive elements
    disableInteractiveElementsInOfflineMode();
    
    if (typeof stopNotificationPolling === 'function') {
      stopNotificationPolling();
    }
  });

  if (!isOnline()) {
    isOfflineMode = true;
    showOfflineIndicator();
    
    if (typeof stopNotificationPolling === 'function') {
      stopNotificationPolling();
    }
    
    setTimeout(() => {
      tryLoadCachedChannelInOfflineMode();
    }, 500);
  }
}

/**
 * Re-enable interactive elements
 */
function enableInteractiveElements() {
  // Re-enable message input
  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    messageInput.setAttribute('contenteditable', 'true');
    messageInput.classList.remove('disabled-offline');
    messageInput.style.backgroundColor = '';
    messageInput.title = '';
  }
  
  // Re-enable send button
  const sendBtn = document.getElementById('channel-chatbox-send-btn');
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.classList.remove('disabled-offline');
    sendBtn.title = '';
  }
  
  // Re-enable image upload button
  const imageBtn = document.getElementById('channel-chatbox-image-btn');
  if (imageBtn) {
    imageBtn.disabled = false;
    imageBtn.classList.remove('disabled-offline');
    imageBtn.title = '';
  }
  
  // Re-enable create channel button
  const createChannelBtn = document.getElementById('dashboard-create-channel-btn');
  if (createChannelBtn) {
    createChannelBtn.disabled = false;
    createChannelBtn.classList.remove('disabled-offline');
    createChannelBtn.title = '';
  }
  
  // Re-enable all message menu buttons
  const messageMenuBtns = document.querySelectorAll('.message-menu-btn');
  messageMenuBtns.forEach(btn => {
    btn.classList.remove('disabled-offline');
    btn.style.pointerEvents = '';
  });
  
  // Re-enable emoji picker
  const emojiOptions = document.querySelectorAll('.emoji-option');
  emojiOptions.forEach(option => {
    option.classList.remove('disabled-offline');
    option.style.pointerEvents = '';
  });
}

/**
 * Show offline mode indicator
 */
function showOfflineIndicator() {
  // Check if indicator already exists
  let indicator = document.getElementById('offline-indicator');
  
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'offline-indicator';
    indicator.className = 'offline-banner';
    indicator.textContent = '🔌 离线模式 - 仅能查看缓存内容，无法进行任何操作';
    document.body.prepend(indicator);
  }
  
  indicator.style.display = 'block';
}

/**
 * Hide offline mode indicator
 */
function hideOfflineIndicator() {
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

/**
 * Try to load cached channel when offline
 * Automatically loads the last accessed channel when user is offline
 */
function tryLoadCachedChannelInOfflineMode() {
  if (!isOnline()) {
    const cachedData = loadOfflineCache();
    
    if (cachedData) {
      // Show channel chatbox
      showChannelChatbox();
      
      // Set current channel ID
      currentChannelId = cachedData.channelId;
      
      // Update channel title and add cache indicator
      const channelTitle = document.getElementById('channel-chatbox-title');
      if (channelTitle && cachedData.channelInfo) {
        channelTitle.textContent = '#' + (cachedData.channelInfo.name || cachedData.channelId);
      }
      
      // Show cached time indicator
      showCachedChannelIndicator(cachedData.cachedAt);
      
      // Render cached messages
      renderMessages(cachedData.messages);
      
      // Show cached time notification
      const cachedTime = new Date(cachedData.cachedAt).toLocaleString('en-US');
      showError('离线模式：正在显示缓存内容（最后更新时间：' + cachedTime + '）');
      
      // Disable all interactive elements
      disableInteractiveElementsInOfflineMode();
    }
  }
}

/**
 * Show cached channel time indicator
 * @param {string} cachedAt - Cache time (ISO string)
 */
function showCachedChannelIndicator(cachedAt) {
  const channelHeader = document.querySelector('.channel-chatbox-header');
  if (!channelHeader) return;
  
  // Check if indicator already exists
  let indicator = document.getElementById('cached-channel-indicator');
  
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.id = 'cached-channel-indicator';
    indicator.className = 'cached-indicator';
    channelHeader.appendChild(indicator);
  }
  
  // Calculate cache time
  const cachedDate = new Date(cachedAt);
  const now = new Date();
  const diffMinutes = Math.floor((now - cachedDate) / (1000 * 60));
  
  let timeText = '';
  if (diffMinutes < 1) {
    timeText = 'Cached just now';
  } else if (diffMinutes < 60) {
    timeText = `Cached ${diffMinutes} min ago`;
  } else {
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      timeText = `Cached ${diffHours} hr ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      timeText = `Cached ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
  }
  
  indicator.textContent = `📦 ${timeText}`;
  indicator.style.display = 'inline-block';
}

/**
 * Hide cached channel time indicator
 */
function hideCachedChannelIndicator() {
  const indicator = document.getElementById('cached-channel-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

/**
 * Disable all interactive elements in offline mode
 */
function disableInteractiveElementsInOfflineMode() {
  // Disable message input
  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    messageInput.setAttribute('contenteditable', 'false');
    messageInput.classList.add('disabled-offline');
    messageInput.style.backgroundColor = '#f5f5f5';
    messageInput.title = 'Offline mode: Cannot input messages';
  }
  
  // Disable send button
  const sendBtn = document.getElementById('channel-chatbox-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.classList.add('disabled-offline');
    sendBtn.title = 'Offline mode: Cannot send';
  }
  
  // Disable image upload button
  const imageBtn = document.getElementById('channel-chatbox-image-btn');
  if (imageBtn) {
    imageBtn.disabled = true;
    imageBtn.classList.add('disabled-offline');
    imageBtn.title = 'Offline mode: Cannot upload images';
  }
  
  // Disable create channel button
  const createChannelBtn = document.getElementById('dashboard-create-channel-btn');
  if (createChannelBtn) {
    createChannelBtn.disabled = true;
    createChannelBtn.classList.add('disabled-offline');
    createChannelBtn.title = 'Offline mode: Cannot create channels';
  }
  
  const messageMenuBtns = document.querySelectorAll('.message-menu-btn');
  messageMenuBtns.forEach(btn => {
    btn.classList.add('disabled-offline');
    btn.style.pointerEvents = 'none';
  });
  
  // Disable emoji picker
  const emojiOptions = document.querySelectorAll('.emoji-option');
  emojiOptions.forEach(option => {
    option.classList.add('disabled-offline');
    option.style.pointerEvents = 'none';
  });
}


/**
 * Clear editing state
 */
function clearEditingState() {
  editMessageId = null;
  editMessageText = null;
  editMessageImage = null;
  editMessageSender = null;
  
  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    messageInput.textContent = '';
  }
  
  // Clear image preview
  const channelChatboxImagePreview = document.getElementById('channel-chatbox-image-preview');
  const channelChatboxImageInput = document.getElementById('channel-chatbox-image-input');
  if (channelChatboxImagePreview) {
    uploadedMessageImage = null;
    channelChatboxImagePreview.style.display = 'none';
    channelChatboxImagePreview.src = '#';
  }
  if (channelChatboxImageInput) {
    channelChatboxImageInput.value = '';
  }
}


// ==================== URL Routing Functionality ====================

/**
 * Listen for hash changes and navigate to corresponding page
 */
function initializeRouter() {
  window.addEventListener('hashchange', handleRouteChange);
  window.addEventListener('load', handleRouteChange);
}

/**
 * Called when URL hash changes
 */
function handleRouteChange() {
  if (isNavigatingViaRouter) {
    return;
  }
  
  const hash = window.location.hash;
  
  // If no hash or empty hash, do nothing
  if (!hash || hash === '#') {
    return;
  }
  
  // If user is not logged in, ignore route changes
  const token = getToken();
  if (!token) {
    return;
  }
  
  // Parse and route to corresponding page
  parseAndRoute(hash);
}

/**
 * Parse hash and route
 * @param {string} hash - URL hash 
 */
function parseAndRoute(hash) {
  // Remove leading #
  const route = hash.substring(1);
  
  // Case 1: #channel={channelId}
  if (route.startsWith('channel=')) {
    const channelIdStr = route.split('=')[1];
    
    // Convert to number
    const channelId = parseInt(channelIdStr, 10);
    
    // Validate channel ID
    if (isNaN(channelId) || channelId <= 0) {
      showError('URL 中的频道 ID 无效');
      return;
    }
    
    navigateToChannelById(channelId);
    return;
  }
  
  // Case 2: #profile
  if (route === 'profile') {
    navigateToOwnProfile();
    return;
  }
  
  // Case 3: #profile={userId}
  if (route.startsWith('profile=')) {
    const userIdStr = route.split('=')[1];
    
    // Convert to number
    const userId = parseInt(userIdStr, 10);
    
    // Validate user ID
    if (isNaN(userId) || userId <= 0) {
      showError('URL 中的用户 ID 无效');
      return;
    }
    
    navigateToUserProfileById(userId);
    return;
  }
}

/**
 * Navigate to specified channel by channel ID
 * @param {number} channelId - Channel ID
 */
function navigateToChannelById(channelId) {
  // Check if user is logged in
  const currentUser = getUser();
  const token = getToken();
  if (!currentUser || !token) {
    // Silently redirect to login without showing error
    window.location.hash = '';
    showLoginForm();
    return;
  }
  
  // Mark as navigating via router
  isNavigatingViaRouter = true;
  
  // Get channel information
  channelAPI.getChannels()
    .then(response => {
      if (!response.ok) {
        // If authentication failed (401/403), clear token and show login
        if (response.status === 401 || response.status === 403) {
          removeToken();
          removeUser();
          showLoginForm();
          window.location.hash = '';
          throw new Error('Session expired, please login again');
        }
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to fetch channels');
        });
      }
      return response.json();
    })
    .then(data => {
      // Find by channel ID
      const targetChannel = data.channels.find(ch => ch.id === channelId);
      
      if (!targetChannel) {
        throw new Error(`Channel with ID ${channelId} does not exist or you don't have access to it`);
      }
      
      joinChannel(targetChannel);
      
      // Reset navigation flag
      isNavigatingViaRouter = false;
    })
    .catch(error => {
      showError('无法访问此频道: ' + error.message);
      
      // Clear invalid hash
      window.location.hash = '';
      
      // Reset navigation flag
      isNavigatingViaRouter = false;
    });
}

/**
 * Navigate to specified user's profile by user ID
 * Show read-only profile page
 * @param {number} userId - User ID
 */
function navigateToUserProfileById(userId) {
  // Check if user is logged in
  const currentUser = getUser();
  const token = getToken();
  if (!currentUser || !token) {
    // Silently redirect to login without showing error
    window.location.hash = '';
    showLoginForm();
    return;
  }
  
  // Mark as navigating via router
  isNavigatingViaRouter = true;
  
  // Get all users to verify the user exists
  userAPI.getUsers()
    .then(response => {
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          removeToken();
          removeUser();
          showLoginForm();
          window.location.hash = '';
          throw new Error('Session expired, please login again');
        }
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to fetch users');
        });
      }
      return response.json();
    })
    .then(data => {
      // Check if user exists
      const targetUser = data.users.find(user => user.id === userId);
      
      if (!targetUser) {
        throw new Error(`User with ID ${userId} does not exist`);
      }
      
      // Show user profile 
      showUserProfile(userId, 'view');
      
      // Reset navigation flag 
      setTimeout(() => {
        isNavigatingViaRouter = false;
      }, 100);
    })
    .catch(error => {
      showError('无法查看用户资料: ' + error.message);
      
      // Clear invalid hash
      window.location.hash = '';
      
      // Reset navigation flag
      isNavigatingViaRouter = false;
    });
}

/**
 * Navigate to own profile (editable mode)
 */
function navigateToOwnProfile() {
  // Check if user is logged in
  const currentUser = getUser();
  const token = getToken();
  if (!currentUser || !token) {
    // Silently redirect to login without showing error
    window.location.hash = '';
    showLoginForm();
    return;
  }
  
  // Mark as navigating via router
  isNavigatingViaRouter = true;
  
  try {
    showUserProfile(currentUser.userId, 'edit');
    
    // Reset navigation flag (execute in next frame to ensure showUserProfile completes)
    setTimeout(() => {
      isNavigatingViaRouter = false;
    }, 100);
  } catch (error) {
    showError('无法查看您的资料: ' + error.message);
    window.location.hash = '';
    isNavigatingViaRouter = false;
  }
}

// ==================== URL Update Functionality ====================

/**
 * Update browser URL
 * @param {string} hash - New hash value
 */
function updateURL(hash) {
  const normalizedHash = hash.startsWith('#') ? hash : `#${hash}`;
  
  if (window.location.hash !== normalizedHash) {
    window.location.hash = normalizedHash;
  }
}


// ==================== Business Logic Layer ====================

/**
 * Handle user login
 * @param {string} email - User email
 * @param {string} password - User password
 */
function login(email, password) {
  // Frontend validation
  if (!validator.isValidEmail(email)) {
    showError('邮箱地址无效');
    return;
  }
  if (!validator.isValidPassword(password)) {
    showError('密码长度必须至少为 8 个字符');
    return;
  }

  // Call API
  authAPI.login(email, password)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Login failed');
        });
      }
      return response.json();
    })
    .then(data => {
      // Save token first (needed for getUserInfo call)
      setToken(data.token);
      
      // Get complete user info (including name)
      return userAPI.getUserInfo(data.userId)
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(err.error || 'Failed to get user info');
            });
          }
          return response.json();
        })
        .then(userInfo => {
          // Save complete user information
          setUser({ 
            userId: data.userId, 
            email: userInfo.email,
            name: userInfo.name 
          });
          
          // Navigate to dashboard (will automatically start notification polling)
          showDashboard();

          // Clear form
          clearForm('login-form');
        });
    })
    .catch(error => {
      showError('登录失败: ' + error.message);
    });
}

/**
 * Handle user registration
 * @param {string} name - Username
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} passwordConfirm - Password confirmation
 */
function register(name, email, password, passwordConfirm) {
  // Frontend validation
  if (!validator.isValidEmail(email)) {
    showError('邮箱地址无效');
    return;
  }
  if (!validator.isValidPassword(password)) {
    showError('密码长度必须至少为 8 个字符');
    return;
  }
  if (!validator.isValidName(name)) {
    showError('姓名长度必须至少为 2 个字符');
    return;
  }
  if (password !== passwordConfirm) {
    showError('两次输入的密码不一致');
    return;
  }

  // Call API
  authAPI.register(name, email, password)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Registration failed');
        });
      }
      return response.json();
    })
    .then(data => {
      // Save token and user info
      setToken(data.token);
      setUser({ userId: data.userId, name, email });
      
      // Navigate to dashboard (will automatically start notification polling)
      showDashboard();

      // Clear form
      clearForm('register-form');
    })
    .catch(error => {
      showError('注册失败: ' + error.message);
    });
}

/**
 * Handle user logout
 */
function logout() {
  // 🛑 Stop notification polling first
  stopNotificationPolling();
  
  authAPI.logout()
    .then(() => {
      // Clear local storage
      removeToken();
      removeUser();
      
      // Return to login page
      showLoginForm();
    })
    .catch(error => {
      console.error('Logout error:', error);
      throw error;
    });
}

/**
 * Get channel list and render
 */
function getChannels() {
  const token = getToken();
  
  // If no token, don't make API call
  if (!token) {
    return;
  }
  
  channelAPI.getChannels()
    .then(response => {
      // First .then: handle HTTP response object
      if (!response.ok) {
        // If authentication failed (401/403), clear token and show login
        if (response.status === 401 || response.status === 403) {
          return response.json()
            .then(err => {
              // Clear invalid token and user info
              removeToken();
              removeUser();
              // Stop notification polling
              stopNotificationPolling();
              // Show login form
              showLoginForm();
              throw new Error('Session expired, please login again');
            });
        }
        return response.json()
          .then(err => {
            throw new Error(err.error);
          });
      }
      return response.json();
    })
    .then(data => {
      renderChannels(data.channels);
    })
    .catch(error => {
      showError('错误: ' + error.message);
    });
}

/**
 * Render channel list
 * @param {Array} channels - Channel list
 */
function renderChannels(channels) {
  const channelContainer = document.getElementById('channel-list');
  // Clear container without using innerHTML
  while (channelContainer.firstChild) {
    channelContainer.removeChild(channelContainer.firstChild);
  }
  
  channels.forEach(channel => {
    // Create li element
    const li = document.createElement('li');
    li.className = 'channel-container';
    li.dataset.channelId = channel.id;
    
    // Create unread message dot indicator
    const unreadDot = document.createElement('span');
    unreadDot.className = 'unread-dot';
    // If there are unread messages, add active class to show red dot
    if (unreadChannels[channel.id]) {
      unreadDot.classList.add('active');
    }
    
    // Create channel name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'channel-name';
    const icon = channel.private ? '🔒' : '#';
    nameSpan.textContent = `${icon} ${channel.name}`;
    
    // Create three-dot button
    const menuBtn = document.createElement('button');
    menuBtn.className = 'channel-menu-btn';
    menuBtn.textContent = '⋯';  // Three dots
    menuBtn.setAttribute('aria-label', 'Channel options');
    
    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'channel-dropdown-menu';
    
    // Create "Edit Channel" menu item
    const editItem = document.createElement('button');
    editItem.className = 'channel-menu-item';
    editItem.dataset.action = 'edit';
    editItem.textContent = '编辑频道';
    
    // Create "Delete Channel" menu item
    const deleteItem = document.createElement('button');
    deleteItem.className = 'channel-menu-item';
    deleteItem.dataset.action = 'delete';
    deleteItem.textContent = '删除频道';
    
    // Add menu items to dropdown menu
    dropdownMenu.appendChild(editItem);
    dropdownMenu.appendChild(deleteItem);
    
    li.appendChild(unreadDot);
    li.appendChild(nameSpan);
    li.appendChild(menuBtn);
    li.appendChild(dropdownMenu);

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Close all other menus
      document.querySelectorAll('.channel-dropdown-menu').forEach(menu => {
        if (menu !== dropdownMenu) {
          menu.classList.remove('show');
        }
      });
      
      // Toggle current menu
      dropdownMenu.classList.toggle('show');
    });

    editItem.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.remove('show');
      loadAndShowChannelDetails(channel.id);
    });
    
    deleteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.remove('show');
    });

    nameSpan.addEventListener('dblclick', () => {
      updateURL(`#channel=${channel.id}`);
    });
    
    // Add to list
    channelContainer.appendChild(li);
  });
}

/**
 * Refresh channel list UI
 * Used to update unread message dot status
 */
function refreshChannelListUI() {
  if (cachedUserChannels && cachedUserChannels.length > 0) {
    renderChannels(cachedUserChannels);
  }
}

/**
 * Get current user's channel
 * @returns {number|null} Channel ID
 */
function getCurrentChannelId() {
  return currentChannelId;
}

/**
 * Set current channel ID
 * @param {number} channelId Channel ID
 */
function setCurrentChannelId(channelId) {
  currentChannelId = channelId;
  
  // Clear unread marker for this channel
  if (channelId) {
    const hadUnread = unreadChannels[channelId];
    delete unreadChannels[channelId];
    
    // If there was an unread marker, refresh channel list UI to update dot display
    if (hadUnread) {
      refreshChannelListUI();
    }
  }
}

/**
 * Join channel and display (core function)
 * @param {object} channel - Channel object
 */
function joinChannel(channel) {
  // Get current user
  const currentUser = getUser();
  if (!currentUser) {
    showError('请先登录');
    return;
  }
  
  // Check if user is already a channel member
  const isMember = channel.members && channel.members.includes(currentUser.userId);
  
  setCurrentChannelId(channel.id);
  // Decide operation based on member status and channel type
  if (isMember) {
    // Scenario 1: Already a member → directly show channel
    updateChannelHeader(channel);
    showChannelChatbox();
    getMessages(channel.id);
  } else if (!channel.private) {
    if (!isOnline()) {
      showError('离线模式：无法加入频道');
      return;
    }
    
    // Scenario 2: Not a member + public channel → join channel first
    channelAPI.joinChannel(channel.id)
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => {
            throw new Error(err.error);
          });
        }
        return response.json();
      })
      .then(() => {
        // Refresh channel list to get latest member info
        return channelAPI.getChannels();
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => {
            throw new Error(err.error);
          });
        }
        return response.json();
      })
      .then(data => {
        renderChannels(data.channels);
        
        cachedUserChannels = data.channels.filter(ch => 
          ch.members && ch.members.includes(currentUser.userId)
        );
        
        updateChannelHeader(channel);
        showChannelChatbox();
        getMessages(channel.id);
        
        return messageAPI.getMessages(channel.id, 0)
          .then(response => response.ok ? response.json() : Promise.resolve({messages: []}))
          .then(msgData => {
            channelMessageCounts[channel.id] = msgData.messages.length;
          })
          .catch(err => {
            console.error('Failed to init channel baseline:', err);
            channelMessageCounts[channel.id] = 0;
          });
      })
      .catch(error => {
        showError('错误: ' + error.message);
      });
  } else {
    // Scenario 3: Not a member + private channel → show error
    showError('这是一个私有频道。您需要被邀请才能加入。');
  }
}



/**
 * Leave channel
 * @param {number} channelId - Channel ID
 */
function leaveChannel(channelId) {
  if (!isOnline()) {
    showError('离线模式：无法离开频道');
    return;
  }
  
  // Call API to leave channel
  channelAPI.leaveChannel(channelId)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to leave channel');
        });
      }
      return response.json();
    })
    .then(() => {
      delete channelMessageCounts[channelId];
      
      cachedUserChannels = cachedUserChannels.filter(ch => ch.id !== channelId);
      
      hideChannelChatbox();
      getChannels();
    })
    .catch(error => {
      showError('无法离开频道: ' + error.message);
    });
}

/**
 * Update channel header display
 * @param {object} channel - Channel object
 */
function updateChannelHeader(channel) {
  // Update channel name display
  const channelNameElement = document.getElementById('channel-chatbox-channel-name');
  if (channelNameElement) {
    const icon = channel.private ? '🔒' : '#';
    channelNameElement.textContent = `${icon} ${channel.name}`;
  }
  
  // Update member count display
  const membersIconElement = document.getElementById('channel-chatbox-members-icon');
  if (membersIconElement && channel.members) {
    const memberCount = channel.members.length;
    membersIconElement.textContent = memberCount === 1 ? '1 个成员' : `${memberCount} 个成员`;
  }
  
  // Save channel info to header's dataset for other features
  const header = document.querySelector('.channel-chatbox-header');
  if (header) {
    header.dataset.channelId = channel.id;
    header.dataset.channelName = channel.name;
  }
  
  // Update active state in channel list
  setActiveChannel(channel.id);
}

/**
 * Set current active channel (add active class)
 * @param {number} channelId - Channel ID
 */
function setActiveChannel(channelId) {
  // Remove active class from all channels
  document.querySelectorAll('.channel-container').forEach(container => {
    container.classList.remove('active');
  });
  
  // Add active class to current channel
  const currentChannel = document.querySelector(`.channel-container[data-channel-id="${channelId}"]`);
  if (currentChannel) {
    currentChannel.classList.add('active');
  }
}

/**
 * Create channel
 * @param {string} name - Channel name
 * @param {boolean} isPrivate - Whether private
 * @param {string} description - Channel description
 * @returns {Promise<Response>}
 */
function createChannel(name, isPrivate, description) {
  if (!isOnline()) {
    showError('离线模式：无法创建频道');
    return;
  }
  
  // First get all channels to check for duplicate names
  channelAPI.getChannels()
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to fetch channels');
        });
      }
      return response.json();
    })
    .then(data => {
      // Check if channel with same name already exists (case-insensitive)
      const duplicateChannel = data.channels.find(ch => 
        ch.name.toLowerCase() === name.toLowerCase()
      );
      
      if (duplicateChannel) {
        throw new Error(`Channel name "${name}" already exists, please use another name`);
      }
      
      // If no duplicate, continue creating channel
      return channelAPI.createChannel(name, isPrivate, description);
    })
    .then(response => {
      if(!response.ok) {
        return response.json()
          .then(err => {
            throw new Error(err.error);
          })
      }
      return response.json();
    })
    .then(data => {
      // Close modal
      hideCreateChannelModal();
      // Refresh channel list
      getChannels();
    })
    .catch(error => {
      showError('无法创建频道: ' + error.message);
    });
}

/**
 * Load and show channel details
 * @param {number} channelId - Channel ID
 */
function loadAndShowChannelDetails(channelId) {
  channelAPI.getChannelInfo(channelId)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(fullChannelData => {
      showChannelDetailsModal(channelId);
      
      const modal = document.getElementById('channel-details-container');
      if (modal) {
        modal.dataset.creatorId = fullChannelData.creator;
      }

      document.getElementById('channel-details-name').value = fullChannelData.name;
      document.getElementById('channel-details-description').value = fullChannelData.description || '';
      
      document.getElementById('channel-details-type').textContent = fullChannelData.private ? '私有' : '公开';
      document.getElementById('channel-details-create-date').textContent = formatFullDateTime(fullChannelData.createdAt);
      
      const creatorElement = document.getElementById('channel-details-creator');
      creatorElement.textContent = `用户 ${fullChannelData.creator}`;
      
      getUserInfo(fullChannelData.creator).then(userInfo => {
        if (userInfo) {
          creatorElement.textContent = userInfo.name;
        }
      });
    })
    .catch(error => {
      showError('无法加载频道详情: ' + error.message);
    });
}

/**
 * Update channel information
 * @param {number} channelId - Channel ID
 * @param {string} name - Channel name
 * @param {string} description - Channel description
 */
function updateChannel(channelId, name, description) {
  channelAPI.updateChannelInfo(channelId, name, description)
    .then(response => {
      if (!response.ok) {
        return response.json()
          .then(err => {
            throw new Error(err.error);
          });
      }
      return response.json();
    })
    .then(data => {
      hideChannelDetailsModal();
      getChannels();
    })
    .catch(error => {
      showError('错误: ' + error.message);
    });
}



/**
 * Create single message DOM element
 * @param {object} message - Message object
 * @returns {HTMLElement} Message DOM element
 */
function createMessageElement(message) {
  // 1. Create message container
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-container';
  messageDiv.dataset.messageId = message.id;

  // 2. Create message header container
  const messageHeader = document.createElement('div');
  messageHeader.className = 'message-header';

  const messageheaderReacts = document.createElement('div');
  messageheaderReacts.className = 'message-header-reacts';

  // 3. Create left info container
  const messageHeaderLeft = document.createElement('div');
  messageHeaderLeft.className = 'message-header-left';

  const messageHeaderRight = document.createElement('div');
  messageHeaderRight.className = 'message-header-right';

  const senderAvatar = document.createElement('img');
  senderAvatar.className = 'message-user-avatar';
  senderAvatar.src = 'img/000648150011.jpg';
  senderAvatar.alt = 'User Avatar';
  
  const senderName = document.createElement('div');
  senderName.className = 'message-user-name';  
  senderName.textContent = `用户 ${message.sender}`;
  
  getUserInfo(message.sender).then(userInfo => {
    if (userInfo) {
      senderName.textContent = userInfo.name;
      
      senderName.dataset.userName = userInfo.name;
      senderAvatar.dataset.userName = userInfo.name;
      
      // Store user ID for URL routing
      senderName.dataset.userId = message.sender;
      senderAvatar.dataset.userId = message.sender;
      
      if (userInfo.image) {
        senderAvatar.src = userInfo.image;
      } else {
        senderAvatar.src = 'img/000648150011.jpg';
      }
    }
  });

  const messageTimeStamp = document.createElement('div');
  messageTimeStamp.className = 'message-timestamp';
  messageTimeStamp.textContent = formatTimestamp(message.sentAt);

  const messageTextInfo = document.createElement('div');
  messageTextInfo.className = 'message-text-info';
  messageTextInfo.appendChild(senderName);
  messageTextInfo.appendChild(messageTimeStamp);

  if (message.editedAt) {
    const editIndicator = document.createElement('div');
    editIndicator.className = 'message-edit-indicator';
    editIndicator.textContent = `（已编辑 ${formatTimestamp(message.editedAt)}）`;
    messageTextInfo.appendChild(editIndicator);
  }

  messageHeaderLeft.appendChild(senderAvatar);
  messageHeaderLeft.appendChild(messageTextInfo);

  const messageText = document.createElement('div');
  messageText.className = 'message-text';
  messageText.textContent = message.message || '';

  let messageImage = null;
  if (message.image) {
    messageImage = document.createElement('img');
    messageImage.className = 'message-image';
    messageImage.src = message.image;
    messageImage.alt = 'Message Image';
    
    messageImage.addEventListener('click', () => {
      showMessageImageModal(message.image);
    });
  }

  const messageMenuButton = document.createElement('button');
  messageMenuButton.className = 'message-menu-btn';
  messageMenuButton.textContent = '⋯';
  messageMenuButton.setAttribute('aria-label', 'Message options');
  
  messageMenuButton.dataset.messageId = message.id;
  messageMenuButton.dataset.messageText = message.message;
  messageMenuButton.dataset.messageImage = message.image || '';
  messageMenuButton.dataset.messageSender = message.sender;

  senderAvatar.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const userId = senderAvatar.dataset.userId || message.sender;
    updateURL(`#profile=${userId}`);
  });

  senderName.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const userId = senderName.dataset.userId || message.sender;
    updateURL(`#profile=${userId}`);
  });

  messageMenuButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const globalMenu = document.getElementById('global-message-menu');
    const pinButton = globalMenu.querySelector('[data-action="pin"]');
    const editButton = globalMenu.querySelector('[data-action="edit"]');
    const deleteButton = globalMenu.querySelector('[data-action="delete"]');
    
    const currentUser = getUser();
    const isOwner = currentUser && currentUser.userId === message.sender;
    
    if (editButton) {
      editButton.style.display = isOwner ? 'block' : 'none';
    }
    if (deleteButton) {
      deleteButton.style.display = isOwner ? 'block' : 'none';
    }
    
    const rect = messageMenuButton.getBoundingClientRect();
    
    globalMenu.style.top = `${rect.bottom + 4}px`;
    globalMenu.style.right = `${window.innerWidth - rect.right}px`;
    globalMenu.style.left = 'auto';
    
    globalMenu.dataset.currentMessageId = message.id;
    globalMenu.dataset.currentMessageText = message.message;
    globalMenu.dataset.currentMessageImage = message.image || '';
    globalMenu.dataset.currentMessageSender = message.sender;
    
    if (pinButton) {
      pinButton.textContent = message.pinned ? '取消置顶' : '置顶';
    }
    
    globalMenu.classList.add('show');
  });

  messageHeader.appendChild(messageHeaderLeft);
  messageHeader.appendChild(messageheaderReacts);
  messageHeader.appendChild(messageMenuButton);

  messageDiv.appendChild(messageHeader);
  messageDiv.appendChild(messageText);
  if (messageImage) {
    messageDiv.appendChild(messageImage);
  }

  return messageDiv;
}

/**
 * Render message list in real-time
 * @param {Array} messages - Message array
 */
function renderMessages(messages) {
  const messagesList = document.getElementById('messages-list');

  while (messagesList.firstChild) {
    messagesList.removeChild(messagesList.firstChild);
  }

  const sortedMessages = [...messages].sort((a, b) =>
    new Date(a.sentAt) - new Date(b.sentAt)
  );

  sortedMessages.forEach(message => {
    const messageElement = createMessageElement(message);
    messagesList.appendChild(messageElement);
  });

  const pinnedMessages = messages.filter(message => message.pinned);
  renderPinnedMessages(pinnedMessages);

  renderMessageReacts(messages);

  setTimeout(() => {
    const scrollContainer = document.querySelector('.channel-chatbox-body');
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, 0);
}

/**
 * Append old messages at the top
 * @param {Array} messages - Array of messages to append
 */
function appendOldMessages(messages) {
  const messagesList = document.getElementById('messages-list');
  
  if (!messages || messages.length === 0) {
    return;
  }

  const sortedMessages = [...messages].sort((a, b) =>
    new Date(a.sentAt) - new Date(b.sentAt)
  );

  const loadingIndicator = document.getElementById('loading-indicator');
  const firstMessage = messagesList.querySelector('.message-container');
  
  sortedMessages.forEach(message => {
    const messageElement = createMessageElement(message);
    
    if (firstMessage) {
      messagesList.insertBefore(messageElement, firstMessage);
    } else if (loadingIndicator) {
      if (loadingIndicator.nextSibling) {
        messagesList.insertBefore(messageElement, loadingIndicator.nextSibling);
      } else {
        messagesList.appendChild(messageElement);
      }
    } else {
      messagesList.appendChild(messageElement);
    }
  });

  const allMessages = Array.from(messagesList.querySelectorAll('.message-container'))
    .map(el => parseInt(el.dataset.messageId));
  
  renderMessageReacts(messages);
}

/**
 * Render message reactions
 * @param {Array} messages - Message array
 */
function renderMessageReacts(messages) {
  const emojiMap = {
    'Like': '👍',
    'Love': '❤️',
    'Sad': '😢',
    'Happy': '😊',
    'Angry': '😠',
    'Surprise': '😲',
    'Confused': '😕',
    'Thinking': '🤔'
  };

  messages.forEach(message => {
    if (!message.reacts || message.reacts.length === 0) {
      return;
    }
    
    const messageContainer = document.querySelector(`[data-message-id="${message.id}"]`);
    if (!messageContainer) {
      return;
    }
    
    const messageheaderReacts = messageContainer.querySelector('.message-header-reacts');
    if (!messageheaderReacts) {
      return;
    }
    
    while (messageheaderReacts.firstChild) {
      messageheaderReacts.removeChild(messageheaderReacts.firstChild);
    }
    
    message.reacts.forEach(react => {
      const reactItem = document.createElement('span');
      reactItem.className = 'message-react-item';
      reactItem.textContent = emojiMap[react.react];
      messageheaderReacts.appendChild(reactItem);    
    });
  });
}


/**
 * Get channel messages and render
 * @param {number} channelId 
 * @param {number} start - Start position
 * @param {boolean} isInitialLoad - Whether this is initial load
 */
function getMessages(channelId, start = 0, isInitialLoad = true) {
  if (!isOnline() && isInitialLoad) {
    const cachedData = loadOfflineCache();
    
    if (cachedData && cachedData.channelId === channelId) {
      renderMessages(cachedData.messages);
      showError('离线模式：正在显示缓存内容（最后更新时间：' + new Date(cachedData.cachedAt).toLocaleString('zh-CN') + '）');
      return;
    } else if (cachedData) {
      showError('离线模式：无法加载此频道。只能查看缓存的频道 #' + cachedData.channelId);
      return;
    } else {
      showError('离线模式：无可用缓存数据');
      return;
    }
  }
  
  if (!isOnline() && !isInitialLoad) {
    showError('离线模式：无法加载更多消息');
    return;
  }
  
  if (!isInitialLoad) {
    if (isLoadingMessages) {
      return;
    }
    if (!hasMoreMessages) {
      return;
    }
  }
  
  isLoadingMessages = true;
  
  if (isInitialLoad) {
    loadedMessageCount = 0;
    hasMoreMessages = true;
  }
  
  const messagesContainer = document.getElementById('messages-list');
  let oldScrollHeight = 0;
  
  if (isInitialLoad) {
    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }
    
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-indicator';
    loadingDiv.textContent = '正在加载消息...';
    loadingDiv.style.textAlign = 'center';
    loadingDiv.style.padding = '20px';
    messagesContainer.appendChild(loadingDiv);
  } else {
    const scrollContainer = document.querySelector('.channel-chatbox-body');
    oldScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
    
    let loadingIndicator = document.getElementById('loading-indicator');
    if (!loadingIndicator) {
      loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'loading-indicator';
      loadingIndicator.style.textAlign = 'center';
      loadingIndicator.style.padding = '10px';
      loadingIndicator.style.color = '#666';
    }
    loadingIndicator.textContent = '正在加载更多消息...';
    loadingIndicator.style.display = 'block';
    
    messagesContainer.insertBefore(loadingIndicator, messagesContainer.firstChild);
  }
  
  messageAPI.getMessages(channelId, start)
    .then(response => {
      if(!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(data => {
      if (data.messages.length < MESSAGES_PER_PAGE) {
        hasMoreMessages = false;
      }
      
      loadedMessageCount += data.messages.length;
      
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
      
      if (isInitialLoad) {
        renderMessages(data.messages);
        
        if (isOnline()) {
          hideCachedChannelIndicator();
          
          channelAPI.getChannelInfo(channelId)
            .then(response => response.ok ? response.json() : null)
            .then(channelInfo => {
              if (channelInfo) {
                saveOfflineCache(channelId, {
                  channelInfo: channelInfo,
                  messages: data.messages,
                  members: channelInfo.members || []
                });
              }
            })
            .catch(err => {
              console.warn('Unable to get channel info for caching:', err);
            });
        }
      } else {
        appendOldMessages(data.messages);
        
        const scrollContainer = document.querySelector('.channel-chatbox-body');
        if (scrollContainer) {
          const newScrollHeight = scrollContainer.scrollHeight;
          scrollContainer.scrollTop = newScrollHeight - oldScrollHeight;
        }
      }
      
      isLoadingMessages = false;
    })
    .catch(error => {
      showError('错误: ' + error.message);
      
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
      
      isLoadingMessages = false;
    });
}

/**
 * Create single pinned message DOM element
 * @param {Object} message - Single message object
 * @returns {HTMLElement} - Pinned message DOM element
 */
function createPinnedMessages(message) {
  const pinnedMessageDiv = document.createElement('div');
  pinnedMessageDiv.className = 'pinned-message-item';
  pinnedMessageDiv.dataset.messageId = message.id;

  const content = document.createElement('div');
  content.className = 'pinned-message-content';

  const senderName = document.createElement('span');
  senderName.className = 'pinned-message-sender';
  senderName.textContent = `用户 ${message.sender}: `;
  
  getUserInfo(message.sender).then(userInfo => {
    if (userInfo) {
      senderName.textContent = `${userInfo.name}: `;
    }
  });

  const messageText = document.createElement('span');
  messageText.className = 'pinned-message-text';
  const maxLength = 100;
  messageText.textContent = message.message && message.message.length > maxLength
    ? message.message.substring(0, maxLength) + '...'
    : message.message || '[Image]';

  content.appendChild(senderName);
  content.appendChild(messageText);

  const unpinBtn = document.createElement('button');
  unpinBtn.className = 'pinned-message-unpin-btn';
  unpinBtn.textContent = '×';
  unpinBtn.setAttribute('aria-label', 'Unpin message');
  
  unpinBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const channelId = getCurrentChannelId();
    
    messageAPI.unpinMessage(channelId, message.id)
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => {
            throw new Error(err.error);
          });
        }
      return response.json();
    })
    .then(data => {
      getMessages(channelId);
    })
      .catch(error => {
        showError('错误: ' + error.message);
      });
  });

  pinnedMessageDiv.appendChild(content);
  pinnedMessageDiv.appendChild(unpinBtn);

  return pinnedMessageDiv;
}


/**
 * Render pinned messages banner
 * @param {Array} messages - Pinned messages array
 */
function renderPinnedMessages(messages) {
  const banner = document.querySelector('.channel-chatbox-banner');
  const pinnedMessagesList = document.getElementById('pinned-messages-list');
  const toggleButton = document.getElementById('channel-chatbox-banner-toggle');
  
  if (!pinnedMessagesList) {
    return;
  }
  
  if (banner) {
    banner.style.display = 'block';
  }
  
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', 'true');
    const icon = toggleButton.querySelector('.pinned-banner-icon');
    if (icon) {
      icon.textContent = 'v';
    }
  }
  
  pinnedMessagesList.classList.remove('collapsed');
  
  while (pinnedMessagesList.firstChild) {
    pinnedMessagesList.removeChild(pinnedMessagesList.firstChild);
  }

  if (!messages || messages.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'pinned-messages-empty';
    emptyState.textContent = '暂无置顶消息';
    pinnedMessagesList.appendChild(emptyState);
    return;
  }

  const sortedMessages = [...messages].sort((a, b) =>
    new Date(b.sentAt) - new Date(a.sentAt)
  );

  sortedMessages.forEach(message => {
    const messageElement = createPinnedMessages(message);
    pinnedMessagesList.appendChild(messageElement);
  });
}

// User info cache
const userInfoCache = {}, currentChannelImages = [], currentImageIndex = 0;

/**
 * Get all user information
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Returns user info object
 */
function getUserInfo(userId) {
  if (userInfoCache[userId]) {
    return Promise.resolve(userInfoCache[userId]);
  }

  return userAPI.getUserInfo(userId)
    .then(response => {
      if(!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(data => {
      userInfoCache[userId] = data;
      return data;
    })
    .catch(error => {
      console.error('Error fetching user info:', error.message);
      return null;
    });
}

/**
 * Send message
 * @param {number} channelId - Channel ID
 * @param {string} message - Message content
 * @param {string} image - Message image (optional)
 */
function sendMessage(channelId, message, image = null) {
  if (!isOnline()) {
    showError('离线模式：无法发送消息');
    return;
  }
  
  // Frontend validation and cleanup
  const trimmedMessage = message.trim();
  if (!trimmedMessage || trimmedMessage.length === 0) {
    showError('消息内容不能为空');
    return;
  }

  // Call API
  messageAPI.sendMessage(channelId, trimmedMessage, image)
    .then(response => {
      if(!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(data => {
      if (channelMessageCounts[channelId] !== undefined) {
        channelMessageCounts[channelId] += 1;
      }

      // Refresh message list
      getMessages(channelId);
    })
    .catch(error => {
      showError('错误: ' + error.message);
    });
}

/**
 * Delete message
 * @param {number} messageId - Message ID
 */
function deleteMessage(messageId) {
  if (!isOnline()) {
    showError('离线模式：无法删除消息');
    return;
  }
  
  if(!confirm('Are you sure you want to delete this message?')) {
    return;
  }

  const actionChannelId = getCurrentChannelId();

  messageAPI.deleteMessage(actionChannelId, messageId)
    .then(response => {
      if(!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(data => {
      getMessages(actionChannelId);
    })
    .catch(error => {
      showError('错误: ' + error.message);
    });
}

/**
 * Edit sent message
 * @param {number} messageId - Message ID
 * @param {string} message - Message content
 * @param {string} image - Message image
 */
function editMessage(messageId, message, image = null) {
  if (!isOnline()) {
    showError('离线模式：无法编辑消息');
    return;
  }
  
  const currentUser = getUser();
  
  if (!currentUser) {
    showError('请先登录');
    return;
  }
  
  if (editMessageSender !== null && currentUser.userId !== editMessageSender) {
    showError('您只能编辑自己的消息');
    clearEditingState();
    return;
  }

  const trimmedMessage = message.trim();
  const originalMessage = editMessageText ? editMessageText.trim() : '';
  const originalImage = editMessageImage || null;
  
  if (trimmedMessage === originalMessage && image === originalImage) {
    showError('消息内容未发生改变');
    return;
  }

  const actionChannelId = getCurrentChannelId();

  messageAPI.editMessage(actionChannelId, messageId, message, image)
    .then(response => {
      if(!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(data => {
      getMessages(actionChannelId);
    })
    .catch(error => {
      showError('错误: ' + error.message);
    });
} 


/**
 * Check if user has already sent this emoji reaction
 * @param {number} channelId - Channel ID
 * @param {number} messageId - Message ID
 * @param {number} userId - User ID
 * @param {string} emoji - Emoji
 * @returns {Promise<boolean>}
 */
function isEmojiPicked(channelId, messageId, userId, emojiType) {
  return messageAPI.getMessages(channelId, 0)
    .then(response => {
      if(!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(data => {
      const message = data.messages.find(message => message.id === messageId);
      if(!message) return false;
      const hasReacted = message.reacts && message.reacts.some(
        r => r.react === emojiType && r.user === userId
      );
      return hasReacted;
    })
    .catch(error => {
      showError('错误: ' + error.message);
    });

}

/**
 * Show invite users modal
 * @param {number} channelId - Channel ID
 */
function showInviteUsersModal(channelId) {
  const modal = document.getElementById('channel-invite-container');
  const usersList = document.getElementById('invite-users-list');
  
  if (!modal || !usersList) {
    showError('未找到邀请弹窗');
    return;
  }
  
  // Clear user list
  while (usersList.firstChild) {
    usersList.removeChild(usersList.firstChild);
  }
  
  // Get current channel info
  channelAPI.getChannelInfo(channelId)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error);
        });
      }
      return response.json();
    })
    .then(channelData => {
      const channelMembers = channelData.members || [];
      
      // Get all users list
      return userAPI.getUsers()
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(err.error);
            });
          }
          return response.json();
        })
        .then(usersData => {
          // Filter out users not in channel
          const allUsers = usersData.users || [];
          const usersNotInChannel = allUsers.filter(user => 
            !channelMembers.includes(user.id)
          );
          
          if (usersNotInChannel.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.textContent = '所有用户均已加入此频道';
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.color = '#666';
            emptyMessage.style.padding = '20px';
            usersList.appendChild(emptyMessage);
            
            // Disable submit button
            const submitBtn = document.getElementById('invite-submit-button');
            if (submitBtn) {
              submitBtn.disabled = true;
            }
            
            return Promise.resolve();
          } else {
            // Get all users' detailed info in parallel
            const userInfoPromises = usersNotInChannel.map(user => 
              getUserInfo(user.id)
                .then(userInfo => ({
                  id: user.id,
                  email: user.email,
                  name: userInfo ? userInfo.name : user.email
                }))
                .catch(error => {
                  console.error(`Failed to get info for user ${user.id}:`, error);
                  return {
                    id: user.id,
                    email: user.email,
                    name: user.email
                  };
                })
            );
            
            // Wait for all user info to load
            return Promise.all(userInfoPromises)
              .then(usersWithNames => {
                // Sort by username
                usersWithNames.sort((a, b) => {
                  const nameA = a.name || '';
                  const nameB = b.name || '';
                  return nameA.localeCompare(nameB);
                });
                
                // Render user list
                usersWithNames.forEach(user => {
                  const userItem = document.createElement('div');
                  userItem.className = 'invite-user-item';
                  userItem.style.display = 'flex';
                  userItem.style.alignItems = 'center';
                  userItem.style.padding = '12px';
                  userItem.style.borderBottom = '1px solid #eee';
                  userItem.style.cursor = 'pointer';
                  userItem.style.transition = 'background-color 0.2s';
                  
                  // Hover effect
                  userItem.addEventListener('mouseenter', () => {
                    userItem.style.backgroundColor = '#f5f5f5';
                  });
                  userItem.addEventListener('mouseleave', () => {
                    userItem.style.backgroundColor = 'transparent';
                  });
                  
                  // Checkbox
                  const checkbox = document.createElement('input');
                  checkbox.type = 'checkbox';
                  checkbox.className = 'invite-member-checkbox';
                  checkbox.value = user.id;
                  checkbox.id = `invite-user-${user.id}`;
                  checkbox.style.marginRight = '12px';
                  checkbox.style.width = '18px';
                  checkbox.style.height = '18px';
                  checkbox.style.cursor = 'pointer';
                  
                  // Username
                  const userName = document.createElement('label');
                  userName.className = 'invite-member-name';
                  userName.htmlFor = `invite-user-${user.id}`;
                  userName.textContent = user.name;
                  userName.style.flex = '1';
                  userName.style.cursor = 'pointer';
                  userName.style.fontWeight = '500';
                  userName.style.textAlign = 'left';  // Left align
                  
                  // Click entire row to select
                  userItem.addEventListener('click', (e) => {
                    if (e.target !== checkbox) {
                      checkbox.checked = !checkbox.checked;
                    }
                  });
                  
                  userItem.appendChild(checkbox);
                  userItem.appendChild(userName);
                  usersList.appendChild(userItem);
                });
                
                // Enable submit button
                const submitBtn = document.getElementById('invite-submit-button');
                if (submitBtn) {
                  submitBtn.disabled = false;
                }
              });
          }
        })
        .then(() => {
          // Store channelId in modal's dataset
          modal.dataset.channelId = channelId;
          
          // Show modal
          modal.classList.remove('hidden');
          modal.style.display = 'flex';
        });
    })
    .catch(error => {
      showError('无法加载用户列表: ' + error.message);
    });
}

/**
 * Hide invite users modal
 */
function hideInviteUsersModal() {
  const modal = document.getElementById('channel-invite-container');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

/**
 * Invite selected users to channel
 * @param {number} channelId - Channel ID
 */
function inviteUsersToChannel(channelId) {
  if (!isOnline()) {
    showError('离线模式：无法邀请用户');
    return;
  }
  
  // Get all checked checkboxes
  const checkboxes = document.querySelectorAll('.invite-member-checkbox:checked');
  
  if (checkboxes.length === 0) {
    showError('请选择至少一名要邀请的用户');
    return;
  }
  
  // Get selected user IDs
  const userIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
  
  // Invite users one by one (backend API only supports single user invitation)
  const invitePromises = userIds.map(userId => 
    channelAPI.inviteToChannel(channelId, userId)
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => {
            throw new Error(`Failed to invite user ${userId}: ${err.error}`);
          });
        }
        return response.json();
      })
  );
  
  // Wait for all invitations to complete
  Promise.all(invitePromises)
    .then(() => {
      hideInviteUsersModal();
      getChannels();
    })
    .catch(error => {
      showError(error.message);
    });
}

/**
 * Show user profile modal
 * @param {number} userId - User ID
 * @param {string} status - 'view' for view mode or 'edit' for edit mode
 */
function showUserProfile(userId, status = 'view') {
  const userProfileModal = document.getElementById('profile-container');

  // Get user info (call only once)
  getUserInfo(userId)
    .then(userInfo => {
      if (!userInfo) {
        showError('无法加载用户信息');
        return;
      }
      
      // Set avatar (both modes need to display)
      const profileImage = document.getElementById('profile-image');
      if (userInfo.image) {
        // If user has set custom avatar, use custom avatar
        profileImage.src = userInfo.image;
      } else {
        // If user hasn't set avatar, use local default avatar
        profileImage.src = 'img/000648150011.jpg';
      }
      profileImage.alt = userInfo.name + "'s avatar";
      
      if (status === 'view') {
        
        // Show read-only elements
        profileImage.style.display = 'block';
        document.getElementById('profile-name').style.display = 'block';
        document.getElementById('profile-bio').style.display = 'block';
        document.getElementById('profile-email').style.display = 'block';
        
        // Hide all edit elements
        document.querySelectorAll('.profile-edit').forEach(element => {
          element.style.display = 'none';
        });
        
        // Fill read-only data
        document.getElementById('profile-name').textContent = userInfo.name;
        document.getElementById('profile-bio').textContent = userInfo.bio || '该用户暂未设置个人简介';
        document.getElementById('profile-email').textContent = userInfo.email;
        
      } else {
        // Show avatar
        profileImage.style.display = 'block';
        
        // Hide read-only elements (span)
        document.getElementById('profile-name').style.display = 'none';
        document.getElementById('profile-bio').style.display = 'none';
        document.getElementById('profile-email').style.display = 'none';
        
        // Show all edit elements
        document.querySelectorAll('.profile-edit').forEach(element => {
          element.style.display = 'block';
        });
        
        // Fill edit form data
        document.getElementById('profile-name-input').value = userInfo.name;
        document.getElementById('profile-bio-input').value = userInfo.bio || '';
        document.getElementById('profile-email-input').value = userInfo.email;
        document.getElementById('profile-new-password-input').value = '';
        
        // Store original user info in modal's dataset for comparison
        userProfileModal.dataset.originalName = userInfo.name;
        userProfileModal.dataset.originalBio = userInfo.bio || '';
        userProfileModal.dataset.originalEmail = userInfo.email;
      }
      
      // Show modal
      userProfileModal.classList.remove('hidden');
      userProfileModal.style.display = 'flex';
    })
    .catch(error => {
      showError('Failed to load user profile: ' + error.message);
    });
}

/**
 * Hide user profile modal
 */
function hideUserProfile() {
  const userProfileModal = document.getElementById('profile-container');
  if (userProfileModal) {
    userProfileModal.classList.add('hidden');
    userProfileModal.style.display = 'none';
  }
  
  // Clear uploaded avatar data
  uploadedAvatarDataUrl = null;
  
  // Clear URL hash to avoid automatic modal popup after refresh
  if (window.location.hash === '#profile' || window.location.hash.startsWith('#profile=')) {
    window.location.hash = '';
  }
}

/**
 * Show message image modal
 * @param {string} imageUrl - Image URL
 */
function showMessageImageModal(imageUrl) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('image-modal-img');
  const counter = document.getElementById('image-modal-counter');
  const prevBtn = document.getElementById('image-modal-prev');
  const nextBtn = document.getElementById('image-modal-next');
  
  // Get all images in current channel
  const channelId = getCurrentChannelId();
  messageAPI.getMessages(channelId, 0)
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }
      return response.json();
    })
    .then(data => {
      // Extract all messages with images
      currentChannelImages = data.messages
        .filter(msg => msg.image)
        .map(msg => msg.image);
      
      // Find current image index
      currentImageIndex = currentChannelImages.indexOf(imageUrl);
      
      // Show image
      img.src = imageUrl;
      modal.classList.remove('hidden');
      
      // Update counter
      if (currentChannelImages.length > 0) {
        counter.textContent = `${currentImageIndex + 1} / ${currentChannelImages.length}`;
      }
      
      // Show/hide arrow buttons
      prevBtn.style.display = currentImageIndex > 0 ? 'block' : 'none';
      nextBtn.style.display = currentImageIndex < currentChannelImages.length - 1 ? 'block' : 'none';
    })
    .catch(error => {
      console.error('Error loading channel images:', error);
      // Show current image even if error occurs
      img.src = imageUrl;
      modal.classList.remove('hidden');
      counter.textContent = '1 / 1';
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    });
}

/**
 * Hide image modal
 */
function hideMessageImageModal() {
  const modal = document.getElementById('image-modal');
  modal.classList.add('hidden');
  currentChannelImages = [];
  currentImageIndex = 0;
}

/**
 * Show previous image
 */
function showPreviousImage() {
  if (currentImageIndex > 0) {
    currentImageIndex--;
    const img = document.getElementById('image-modal-img');
    const counter = document.getElementById('image-modal-counter');
    const prevBtn = document.getElementById('image-modal-prev');
    const nextBtn = document.getElementById('image-modal-next');
    
    img.src = currentChannelImages[currentImageIndex];
    counter.textContent = `${currentImageIndex + 1} / ${currentChannelImages.length}`;
    
    prevBtn.style.display = currentImageIndex > 0 ? 'block' : 'none';
    nextBtn.style.display = 'block';
  }
}

/**
 * Show next image
 */
function showNextImage() {
  if (currentImageIndex < currentChannelImages.length - 1) {
    currentImageIndex++;
    const img = document.getElementById('image-modal-img');
    const counter = document.getElementById('image-modal-counter');
    const prevBtn = document.getElementById('image-modal-prev');
    const nextBtn = document.getElementById('image-modal-next');
    
    img.src = currentChannelImages[currentImageIndex];
    counter.textContent = `${currentImageIndex + 1} / ${currentChannelImages.length}`;
    
    prevBtn.style.display = 'block';
    nextBtn.style.display = currentImageIndex < currentChannelImages.length - 1 ? 'block' : 'none';
  }
}

// ==================== Setup Login/Registration Event Listeners ====================
function setupAuthListeners() {
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const loginButton = document.getElementById('login-submit');
  const registerLink = document.getElementById('register-link');
  const forgetPasswordLink = document.getElementById('forget-password-link');

  loginButton.addEventListener('click', (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;
    login(email, password);
  });

  registerLink.addEventListener('click', (e) => {
    e.preventDefault();
    showRegisterForm();
  });

  forgetPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    showForgetPasswordForm();
  });
}

// ==================== Setup Registration Event Listeners ====================
function setupRegisterListeners() {
  const nameInput = document.getElementById('register-name');
  const emailInput = document.getElementById('register-email');
  const passwordInput = document.getElementById('register-password');
  const passwordConfirmInput = document.getElementById('register-password-confirm');
  const registerButton = document.getElementById('register-submit');
  const loginLink = document.getElementById('login-link');

  registerButton.addEventListener('click', (e) => {
    e.preventDefault();
    const name = nameInput.value;
    const email = emailInput.value;
    const password = passwordInput.value;
    const passwordConfirm = passwordConfirmInput.value;
    register(name, email, password, passwordConfirm);
  });

  loginLink.addEventListener('click', (e) => {
    e.preventDefault();
    showLoginForm();
  });
}

// ==================== Dashboard Event Listeners ====================
/**
 * Setup Dashboard related event listeners
 */
function setupDashboardListeners() {
  const userProfile = document.getElementById('avatar-label');
  
  const logoutButton = document.getElementById('logout-button');
  const createChannelButton = document.getElementById('create-channel-button');
  const createChannelModal = document.getElementById('create-channel-container');
  const createChannelModalClose = document.getElementById('create-channel-container-close');
  const createChannelForm = document.getElementById('create-channel-form');
  const channelDetailsModal = document.getElementById('channel-details-container');
  const channelDetailsClose = document.getElementById('channel-details-close');
  const channelDetailsSave = document.getElementById('channel-details-save');
  const channelToggleBtn = document.getElementById('channel-board-button');
  const channelListContainer = document.querySelector('.channel-list-container');
  
  getChannels();
  hideChannelChatbox();

  // Channel list toggle button (applicable to all screen sizes)
  if (channelToggleBtn && channelListContainer) {
    channelToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const dashboardContent = document.querySelector('.dashboard-content');
      channelListContainer.classList.toggle('channel-list-hidden');
      
      // Add/remove class to parent container to adjust layout (better browser compatibility)
      if (dashboardContent) {
        dashboardContent.classList.toggle('channel-list-collapsed');
      }
    });
  }

  // Username click event (Step 7: Navigate via URL)
  if (userProfile) {
    userProfile.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Get current user
      const currentUser = getUser();
      if (!currentUser) {
        showError('请先登录');
        return;
      }
      
      // Directly show edit mode profile (without relying on URL routing)
      showUserProfile(currentUser.userId, 'edit');
      
      // Update URL (but don't rely on routing system to open modal)
      if (window.location.hash !== '#profile') {
        window.location.hash = '#profile';
      }
    });
  }

  // Click outside modal to close
  const profileModal = document.getElementById('profile-container');
  if (profileModal) {
    profileModal.addEventListener('click', (e) => {
      if (e.target === profileModal) {
        hideUserProfile();
      }
    });
  }

  // Logout button
  if (logoutButton) {
    logoutButton.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  if (createChannelButton) {
    createChannelButton.addEventListener('click', (e) => {
      e.preventDefault();
      showCreateChannelModal();
    });
  }

  // Close modal button
  if (createChannelModalClose) {
    createChannelModalClose.addEventListener('click', (e) => {
      e.preventDefault();
      hideCreateChannelModal();
    });
  }

  // Create channel form submit
  if (createChannelForm) {
    createChannelForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const name = document.getElementById('create-channel-name').value.trim();
      const description = document.getElementById('create-channel-description').value.trim() || 'No description';
      const isPrivate = document.getElementById('create-channel-is-private').checked;

      // Validate channel name
      if (!name) {
        showError('频道名称是必填项');
        return;
      }
      
      // Call create channel API
      createChannel(name, isPrivate, description);
    });
  }

  // Channel details modal close button
  if (channelDetailsClose) {
    channelDetailsClose.addEventListener('click', (e) => {
      e.preventDefault();
      hideChannelDetailsModal();
    });
  }

  // Channel details save button
  if (channelDetailsSave) {
    channelDetailsSave.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Get current logged-in user's ID
      const currentUser = getUser();
      if (!currentUser) {
        showError('您必须先登录才能更新频道');
        return;
      }
      
      // Get channelId and creatorId from modal's dataset
      const modal = document.getElementById('channel-details-container');
      const channelId = modal.dataset.channelId;
      const creatorId = modal.dataset.creatorId;
      
      // Permission validation: only creator can modify
      if (currentUser.userId != creatorId) {
        showError('仅频道创建者可以更新频道信息');
        return;
      }
      
      // Get form data
      const name = document.getElementById('channel-details-name').value.trim();
      const description = document.getElementById('channel-details-description').value.trim();
      
      // Validate channel name
      if (!name) {
        showError('频道名称是必填项');
        return;
      }
      
      // Call update API
      updateChannel(channelId, name, description);
    });
  }
}

// ==================== Setup Invite Users Modal Event Listeners ====================
function setupInviteUsersListeners() {
  const inviteModal = document.getElementById('channel-invite-container');
  const inviteModalClose = document.getElementById('invite-modal-close');
  const inviteSubmitButton = document.getElementById('invite-submit-button');
  
  // Close button
  if (inviteModalClose) {
    inviteModalClose.addEventListener('click', (e) => {
      e.preventDefault();
      hideInviteUsersModal();
    });
  }
  
  // Submit button
  if (inviteSubmitButton) {
    inviteSubmitButton.addEventListener('click', (e) => {
      e.preventDefault();
      const channelId = inviteModal?.dataset.channelId;
      if (channelId) {
        inviteUsersToChannel(parseInt(channelId));
      }
    });
  }
  
  // Click outside modal to close
  if (inviteModal) {
    inviteModal.addEventListener('click', (e) => {
      if (e.target === inviteModal) {
        hideInviteUsersModal();
      }
    });
  }
}

// ==================== Setup User Profile Modal Event Listeners ====================
function setupUserProfileListeners() {
  const userProfileClose = document.getElementById('profile-close');
  const profileImage = document.getElementById('profile-image');
  const userAvatarUploadBtn = document.getElementById('user-profile-avatar-upload');
  const userAvatarInput = document.getElementById('profile-avatar-input');
  const profileSave = document.getElementById('profile-save');
  const passwordToggleBtn = document.getElementById('password-toggle-btn');
  const passwordInput = document.getElementById('profile-new-password-input');

  if (userProfileClose) {
    userProfileClose.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideUserProfile();
    });
  }

  if (userAvatarUploadBtn) {
    userAvatarUploadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      userAvatarInput.click();
    });
  }

  if (userAvatarInput) {
    userAvatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];

      if (file) {
        fileToDataUrl(file)
          .then(dataUrl => {
            uploadedAvatarDataUrl = dataUrl;
            profileImage.src = dataUrl;
          })
          .catch(error => {
            showError('Failed to upload avatar: ' + error.message);
            // Ensure uploaded data is cleared
            uploadedAvatarDataUrl = null;
            userAvatarInput.value = '';
          });
      }
    });
  }

  // Password toggle functionality
  if (passwordToggleBtn && passwordInput) {
    passwordToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        passwordToggleBtn.textContent = '🙈';
      } else {
        passwordInput.type = 'password';
        passwordToggleBtn.textContent = '👁️';
      }
    });
  }

  if (profileSave) {
    profileSave.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Get original values (from modal's dataset)
      const modal = document.getElementById('profile-container');
      const originalName = modal.dataset.originalName;
      const originalBio = modal.dataset.originalBio;
      const originalEmail = modal.dataset.originalEmail;
      
      // Get input values
      const editedEmail = document.getElementById('profile-email-input').value.trim();
      const editedPassword = document.getElementById('profile-new-password-input').value;
      const editedName = document.getElementById('profile-name-input').value.trim();
      const editedBio = document.getElementById('profile-bio-input').value.trim();
      
      // Frontend validation
      if (!editedName) {
        showError('姓名不能为空');
        return;
      }
      
      if (!editedEmail) {
        showError('邮箱不能为空');
        return;
      }
      
      if (!validator.isValidEmail(editedEmail)) {
        showError('邮箱地址无效');
        return;
      }
      
      if (editedPassword && !validator.isValidPassword(editedPassword)) {
        showError('密码长度必须至少为 8 个字符');
        return;
      }
      
      // Only send modified fields
      const changedEmail = editedEmail !== originalEmail ? editedEmail : null;
      const changedName = editedName !== originalName ? editedName : null;
      const changedBio = editedBio !== originalBio ? editedBio : null;
      
      userAPI.updateUserInfo(changedEmail, editedPassword, changedName, changedBio, uploadedAvatarDataUrl)
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(err.error);
            });
          }
          return response.json();
        })
      .then(data => {
        // Update locally stored user info
          const currentUser = getUser();
          setUser({
            ...currentUser,
            name: changedName || originalName,
            email: changedEmail || originalEmail
          });
          
          // Clear user info cache, force re-fetch
          const userId = getUser().userId;
          if (userInfoCache[userId]) {
            delete userInfoCache[userId];
          }
          
          // Update username displayed in header
          const userNameDisplay = document.getElementById('avatar-label');
          if (userNameDisplay) {
            userNameDisplay.textContent = changedName || originalName;
          }
          
          hideUserProfile();
        })
        .catch(error => {
          showError('Failed to update profile: ' + error.message);
        });
    });
  }
}

// ==================== Rich Text Editor Functionality ====================

/**
 * Apply text format to selected content
 * @param {string} command - Format command (bold, italic, underline, strikeThrough)
 */
function applyTextFormat(command) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  const messageInput = document.getElementById('message-input');
  
  // Ensure selection is within input box
  if (!messageInput.contains(range.commonAncestorContainer)) {
    return;
  }
  
  // If no content selected, focus input box
  if (range.collapsed) {
    messageInput.focus();
    return;
  }
  
  // Apply format using document.execCommand
  document.execCommand(command, false, null);
  
  // Keep focus on input box
  messageInput.focus();
}

/**
 * Get input box's plain text content (for empty check)
 */
function getInputText() {
  const messageInput = document.getElementById('message-input');
  return messageInput.textContent.trim();
}

/**
 * Get input box's HTML content
 */
function getInputHTML() {
  const messageInput = document.getElementById('message-input');
  return messageInput.textContent.trim();
}

/**
 * Clear input box
 */
function clearInputContent() {
  const messageInput = document.getElementById('message-input');
  messageInput.textContent = '';
}

/**
 * Set input box content (text)
 */
function setInputHTML(html) {
  const messageInput = document.getElementById('message-input');
  messageInput.textContent = html;
}

/**
 * Set input box plain text content
 */
function setInputText(text) {
  const messageInput = document.getElementById('message-input');
  messageInput.textContent = text;
}

// ==================== Setup Channel Chatbox Event Listeners ====================
function setupChannelChatboxListeners() {
  const inviteUserButton = document.getElementById('invite-user-button');
  const leaveChannelButton = document.getElementById('leave-channel-button');
  const chatboxInput = document.getElementById('message-input');
  const chatboxImageButton = document.getElementById('chatbox-input-attachments-image');
  const channelChatboxImageInput = document.getElementById('channel-chatbox-image-input');
  const channelChatboxImagePreview = document.getElementById('channel-chatbox-image-preview');
  const sendButton = document.getElementById('message-send-button');
  const chatboxBody = document.querySelector('.channel-chatbox-body');
  
  // ==================== Infinite Scroll Event Listener ====================
  if (chatboxBody) {
    chatboxBody.addEventListener('scroll', () => {
      // Load more messages when scrolled to top (scroll up to load history messages)
      if (chatboxBody.scrollTop === 0 && !isLoadingMessages && hasMoreMessages) {
        const channelId = getCurrentChannelId();
        if (channelId) {
          // Use current loaded message count as start position
          getMessages(channelId, loadedMessageCount, false);
        }
      }
    });
  }
  
  // ==================== Font Format Button Event Listeners ====================
  const boldButton = document.getElementById('chatbox-input-font-bold');
  const italicButton = document.getElementById('chatbox-input-font-italic');
  const underlineButton = document.getElementById('chatbox-input-font-underline');
  const strikethroughButton = document.getElementById('chatbox-input-font-strikethrough');
  
  if (boldButton) {
    boldButton.addEventListener('click', (e) => {
      e.preventDefault();
      applyTextFormat('bold');
    });
  }
  
  if (italicButton) {
    italicButton.addEventListener('click', (e) => {
      e.preventDefault();
      applyTextFormat('italic');
    });
  }
  
  if (underlineButton) {
    underlineButton.addEventListener('click', (e) => {
      e.preventDefault();
      applyTextFormat('underline');
    });
  }
  
  if (strikethroughButton) {
    strikethroughButton.addEventListener('click', (e) => {
      e.preventDefault();
      applyTextFormat('strikeThrough');
    });
  }
  
  // Keyboard shortcut support
  if (chatboxInput) {
    chatboxInput.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch(e.key.toLowerCase()) {
          case 'b':
            e.preventDefault();
            applyTextFormat('bold');
            break;
          case 'i':
            e.preventDefault();
            applyTextFormat('italic');
            break;
          case 'u':
            e.preventDefault();
            applyTextFormat('underline');
            break;
        }
      }
    });
  }
  
  if (inviteUserButton) {
    inviteUserButton.addEventListener('click', (e) => {
      e.preventDefault();
      const channelId = getCurrentChannelId();
      if (channelId) {
        showInviteUsersModal(channelId);
      } else {
        showError('未选择当前活动频道');
      }
    });
  }

  if (leaveChannelButton) {
    leaveChannelButton.addEventListener('click', (e) => {
      e.preventDefault();
      // Get current channel ID from header's dataset
      const header = document.querySelector('.channel-chatbox-header');
      const channelId = header?.dataset.channelId;
      
      // Call leave channel function
      if (channelId) {
        leaveChannel(parseInt(channelId));
      } else {
        showError('无当前活动频道可离开');
      }
    });
  }

  if (chatboxImageButton) {
    chatboxImageButton.addEventListener('click', (e) => {
      e.preventDefault();
      
      if (!isOnline()) {
        showError('离线模式：无法上传图片');
        return;
      }
      
      channelChatboxImageInput.click();
    });
  }

  if (channelChatboxImageInput) {
    channelChatboxImageInput.addEventListener('change', (e) => {
      if (!isOnline()) {
        showError('离线模式：无法上传图片');
        e.target.value = '';
        return;
      }
      
      const file = e.target.files[0];
      if (file) {
        fileToDataUrl(file)
          .then(dataUrl => {
            uploadedMessageImage = dataUrl;
            channelChatboxImagePreview.src = dataUrl;
            channelChatboxImagePreview.style.display = 'inline-block';
          })
          .catch(error => {
            showError('错误: ' + error.message);
          });
      }
    });
  }
  
  // Click preview image to remove
  if (channelChatboxImagePreview) {
    channelChatboxImagePreview.addEventListener('click', (e) => {
      e.preventDefault();
      uploadedMessageImage = null;
      channelChatboxImagePreview.style.display = 'none';
      channelChatboxImagePreview.src = '#';
      channelChatboxImageInput.value = '';
    });
  }

  if (sendButton) {
    sendButton.addEventListener('click', (e) => {
      e.preventDefault();
      
      if (!isOnline()) {
        showError('离线模式：无法发送消息');
        return;
      }
      
      const channelId = getCurrentChannelId();
      const messageHTML = getInputHTML();
      const messageText = getInputText();
      
      if (editMessageId !== null) {
        editMessage(editMessageId, messageHTML, uploadedMessageImage);
        clearEditingState();
      } else {
        if (uploadedMessageImage) {
          sendMessage(channelId, messageHTML, uploadedMessageImage);
          uploadedMessageImage = null;
          channelChatboxImagePreview.style.display = 'none';
          channelChatboxImagePreview.src = '#';
          channelChatboxImageInput.value = '';
          clearInputContent();
          return;
        }
        
        if (!messageText) {
          return;
        }
        
        sendMessage(channelId, messageHTML);
        clearInputContent();
      }
    });
  }

  if (chatboxInput) {
    chatboxInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        
        if (!isOnline()) {
          showError('离线模式：无法发送消息');
          return;
        }
        
        const channelId = getCurrentChannelId();
        const messageHTML = getInputHTML();
        const messageText = getInputText();
        
        if (!channelId) {
          showError('没有活动频道');
          return;
        }
        
        if (editMessageId !== null) {
          editMessage(editMessageId, messageHTML, uploadedMessageImage);
          clearEditingState();
        } else {
          if (uploadedMessageImage) {
            sendMessage(channelId, messageHTML, uploadedMessageImage);
            uploadedMessageImage = null;
            channelChatboxImagePreview.style.display = 'none';
            channelChatboxImagePreview.src = '#';
            channelChatboxImageInput.value = '';
            clearInputContent();
            return;
          }
          
          if (!messageText) {
            return;
          }
          
          sendMessage(channelId, messageHTML);
          clearInputContent();
        }
      }
    });
  }
}

// ==================== Setup Emoji Event Listeners ====================
function setupEmojiPickerListeners() {
  const emojiPicker = document.getElementById('emoji-picker');
  const emojiIcons = document.querySelectorAll('.emoji-option');

  emojiIcons.forEach(icon => {
    icon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!isOnline()) {
        showError('离线模式：无法添加表情回应');
        return;
      }

      const channelId = getCurrentChannelId();
      const messageId = parseInt(emojiPicker.dataset.currentMessageId);
      const userId = getUser().userId;
      const emojiType = icon.dataset.emoji;

      isEmojiPicked(channelId, messageId, userId, emojiType)
        .then(hasReacted => {
          const apiCall = hasReacted
            ? messageAPI.unreactMessage(channelId, messageId, emojiType)
            : messageAPI.reactMessage(channelId, messageId, emojiType);
          
          return apiCall;
        })
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(err.error);
            });
          }
        return response.json();
      })
      .then(data => {
        getMessages(channelId);
      })
        .catch(error => {
          showError('错误: ' + error.message);
        });
    });
  });
}

// ==================== Setup Pinned Messages Banner Event Listeners ====================
/**
 * Setup Pinned Messages banner collapse/expand functionality
 */
function setupPinnedMessagesBanner() {
  const toggleButton = document.getElementById('channel-chatbox-banner-toggle');
  const pinnedList = document.getElementById('pinned-messages-list');
  const icon = document.querySelector('.pinned-banner-icon');
  
  if (!toggleButton || !pinnedList) {
    return;
  }
  
  // Click to toggle expand/collapse
  toggleButton.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    
    // Toggle state
    toggleButton.setAttribute('aria-expanded', !isExpanded);
    
    // Toggle icon
    if (icon) {
      icon.textContent = isExpanded ? '>' : 'v';
    }
    
    // Toggle list display
    if (isExpanded) {
      pinnedList.classList.add('collapsed');
    } else {
      pinnedList.classList.remove('collapsed');
    }
  });
  
  // Keyboard support (Enter and Space)
  toggleButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleButton.click();
    }
  });
}


// ==================== Error Modal Event Listeners ====================
/**
 * Setup error modal event listeners
 */
function setupErrorModalListeners() {
  const closeButton = document.getElementById('error-close');
  const errorModal = document.getElementById('error-modal');

  if (closeButton) {
    closeButton.addEventListener('click', hideError);
  }

  // Click outside modal to close
  if (errorModal) {
    errorModal.addEventListener('click', (e) => {
      if (e.target === errorModal) {
        hideError();
      }
    });
  }
}

// ==================== Image Modal Event Listeners ====================
/**
 * Setup image modal event listeners
 */
function setupImageModalListeners() {
  const imageModal = document.getElementById('image-modal');
  const closeButton = document.getElementById('image-modal-close');
  const prevButton = document.getElementById('image-modal-prev');
  const nextButton = document.getElementById('image-modal-next');
  
  // Close button
  if (closeButton) {
    closeButton.addEventListener('click', hideMessageImageModal);
  }
  
  // Previous button
  if (prevButton) {
    prevButton.addEventListener('click', showPreviousImage);
  }
  
  // Next button
  if (nextButton) {
    nextButton.addEventListener('click', showNextImage);
  }
  
  // Click modal background to close
  if (imageModal) {
    imageModal.addEventListener('click', (e) => {
      if (e.target === imageModal) {
        hideMessageImageModal();
      }
    });
  }
  
  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !imageModal.classList.contains('hidden')) {
      hideMessageImageModal();
    }
    // Left/right arrow keys to switch images
    if (!imageModal.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft') {
        showPreviousImage();
      } else if (e.key === 'ArrowRight') {
        showNextImage();
      }
    }
  });
}

// ==================== Page Switching Functions ====================

/**
 * Show login form
 */
function showLoginForm() {
  const loginContainer = document.getElementById('login-container');
  const registerContainer = document.getElementById('register-container');
  const dashboardContainer = document.getElementById('dashboard-container');
  const dashboardHeader = document.getElementById('dashboard-header');
  const authContainer = document.querySelector('.auth-container');
  const channelToggleBtn = document.getElementById('channel-board-button');
  
  if (loginContainer) loginContainer.style.display = 'block';
  if (registerContainer) registerContainer.style.display = 'none';
  if (dashboardContainer) dashboardContainer.style.display = 'none';
  if (dashboardHeader) dashboardHeader.style.display = 'none';
  if (authContainer) authContainer.style.display = 'flex';
  
  // Hide channel list toggle button
  if (channelToggleBtn) {
    channelToggleBtn.classList.add('hidden');
  }
}

/**
 * Show registration form
 */
function showRegisterForm() {
  const loginContainer = document.getElementById('login-container');
  const registerContainer = document.getElementById('register-container');
  const dashboardContainer = document.getElementById('dashboard-container');
  const dashboardHeader = document.getElementById('dashboard-header');
  const authContainer = document.querySelector('.auth-container');
  const channelToggleBtn = document.getElementById('channel-board-button');
  
  if (loginContainer) loginContainer.style.display = 'none';
  if (registerContainer) registerContainer.style.display = 'block';
  if (dashboardContainer) dashboardContainer.style.display = 'none';
  if (dashboardHeader) dashboardHeader.style.display = 'none';
  if (authContainer) authContainer.style.display = 'flex';
  
  // Hide channel list toggle button
  if (channelToggleBtn) {
    channelToggleBtn.classList.add('hidden');
  }
}

/**
 * Show main page (Dashboard)
 */
function showDashboard() {
  const loginContainer = document.getElementById('login-container');
  const registerContainer = document.getElementById('register-container');
  const dashboardContainer = document.getElementById('dashboard-container');
  const dashboardHeader = document.getElementById('dashboard-header');
  const authContainer = document.querySelector('.auth-container');
  const channelToggleBtn = document.getElementById('channel-board-button');
  
  if (loginContainer) loginContainer.style.display = 'none';
  if (registerContainer) registerContainer.style.display = 'none';
  if (authContainer) authContainer.style.display = 'none';
  if (dashboardContainer) dashboardContainer.style.display = 'flex';
  
  if (channelToggleBtn) {
    channelToggleBtn.classList.remove('hidden');
  }
  
  if (dashboardHeader) {
    dashboardHeader.style.display = 'flex';
    const user = getUser();
    const userNameDisplay = document.getElementById('avatar-label');
    if (user && userNameDisplay) {
      const displayName = user.name;
      userNameDisplay.textContent = `${displayName}`;
    }
  }
  
  getChannels();
  
  startNotificationPolling();
}

/**
 * Show forgot password form
 */
function showForgetPasswordForm() {
  alert('忘记密码功能尚未实现');
}


// ==================== Push Notification Core Functionality ====================

/**
 * Get all channels user has joined
 * @returns {Promise<Array>} Returns list of channels user joined
 */
function getUserJoinedChannels() {
  const currentUser = getUser();
  const token = getToken();
  
  // If no user or no token, return empty array without making API calls
  if (!currentUser || !token) {
    return Promise.resolve([]);
  }
  
  // Call existing API to get all channels
  return channelAPI.getChannels()
    .then(response => {
      if (!response.ok) {
        // If authentication failed, stop polling and redirect to login
        if (response.status === 401 || response.status === 403) {
          stopNotificationPolling();
          removeToken();
          removeUser();
          showLoginForm();
          return [];
        }
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to fetch channels');
        });
      }
      return response.json();
    })
    .then(data => {
      // Filter out channels user has joined
      const joinedChannels = data.channels.filter(channel => 
        channel.members && channel.members.includes(currentUser.userId)
      );
      
      // Update cache
      cachedUserChannels = joinedChannels;
      
      return joinedChannels;
    })
    .catch(error => {
      return [];
    });
}

/**
 * Check for new messages in single channel
 * @param {number} channelId - Channel ID
 * @returns {Promise<Array>} Returns new messages array
 */
function checkSingleChannelNewMessages(channelId) {
  // Offline check - Don't check for new messages when offline
  if (!isOnline()) {
    return Promise.resolve([]);
  }
  
  // Get latest messages from this channel
  return messageAPI.getMessages(channelId, 0)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to fetch messages');
        });
      }
      return response.json();
    })
    .then(data => {
      const currentMessageCount = data.messages.length;
      
      // Get previously recorded message count
      const previousMessageCount = channelMessageCounts[channelId] || 0;
      
      // If message count increased, there are new messages
      if (currentMessageCount > previousMessageCount) {
        const newMessageCount = currentMessageCount - previousMessageCount;
        
        // Extract new messages (latest ones)
        const newMessages = data.messages.slice(-newMessageCount);
        
        // Update message count
        channelMessageCounts[channelId] = currentMessageCount;
        
        return newMessages;
      } else {
        // No new messages, still update count (messages may have been deleted)
        channelMessageCounts[channelId] = currentMessageCount;
        return [];
      }
    })
    .catch(error => {
      return [];
    });
}

/**
 * Filter out messages sent by other users
 * @param {Array} messages - Messages array
 * @returns {Array} Filtered messages array
 */
function filterOthersMessages(messages) {
  const currentUser = getUser();
  
  if (!currentUser) {
    return [];
  }
  
  const othersMessages = messages.filter(message => {
    const isSelf = message.sender == currentUser.userId;
    return !isSelf;
  });
  
  return othersMessages;
}


// ==================== API Request Optimization ====================

/**
 * Delay utility function
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after specified time
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process all channels' new message detection sequentially
 * @param {Array} channels - Channel list
 * @returns {Promise<Array>} Returns all new messages array
 */
function checkAllChannelsSequentially(channels) {
  if (isPollingInProgress) {
    return Promise.resolve([]);
  }
  
  isPollingInProgress = true;
  
  const allNewMessages = [];
  
  return channels.reduce((promiseChain, channel) => {
    return promiseChain
      .then(() => {
        return checkSingleChannelNewMessages(channel.id);
      })
      .then(newMessages => {
        if (newMessages.length > 0) {
          const othersMessages = filterOthersMessages(newMessages);
          
          if (othersMessages.length > 0) {
            allNewMessages.push({
              channelId: channel.id,
              channelName: channel.name,
              messages: othersMessages
            });
            
            if (channel.id !== currentChannelId) {
              unreadChannels[channel.id] = true;
            }
          }
        }
        
        return delay(50);
      })
      .catch(error => {
        return delay(50);
      });
  }, Promise.resolve())
    .then(() => {
      isPollingInProgress = false;
      
      if (allNewMessages.length > 0) {
        refreshChannelListUI();
      }
      
      return allNewMessages;
    })
    .catch(error => {
      isPollingInProgress = false;
      return [];
    });
}


// ==================== Toast Notification Display Functionality ====================

/**
 * Show Toast notification
 * @param {string} channelName - Channel name
 * @param {number} messageCount - New message count
 */
function showToastNotification(channelName, messageCount) {
  const container = document.getElementById('toast-container');
  
  if (!container) {
    return;
  }
  
  // Create Toast element
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  
  // Create toast-content
  const toastContent = document.createElement('div');
  toastContent.className = 'toast-content';
  
  // Create toast-icon
  const toastIcon = document.createElement('span');
  toastIcon.className = 'toast-icon';
  toastIcon.textContent = '🔔';
  
  // Create toast-text
  const toastText = document.createElement('div');
  toastText.className = 'toast-text';
  
  const channelNameStrong = document.createElement('strong');
  channelNameStrong.textContent = '# ' + channelName;
  
  const messageCountSpan = document.createElement('span');
  messageCountSpan.textContent = '有 ' + messageCount + ' 条新消息';
  
  toastText.appendChild(channelNameStrong);
  toastText.appendChild(messageCountSpan);
  
  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', '关闭通知');
  closeBtn.textContent = '×';
  
  // Assemble toast-content
  toastContent.appendChild(toastIcon);
  toastContent.appendChild(toastText);
  toastContent.appendChild(closeBtn);
  
  // Assemble toast
  toast.appendChild(toastContent);
  
  // Add close button event
  closeBtn.addEventListener('click', () => {
    dismissToast(toast);
  });
  
  // Add to container
  container.appendChild(toast);
  
  // Auto close after 3 seconds
  setTimeout(() => {
    dismissToast(toast);
  }, 3000);
}

/**
 * Close Toast notification (with animation)
 * @param {HTMLElement} toast - Toast element
 */
function dismissToast(toast) {
  if (!toast || !toast.parentElement) {
    return;
  }
  
  // Add fade out animation
  toast.style.animation = 'slideOut 0.3s ease-out forwards';
  
  // Remove element after animation ends
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 300);
}

/**
 * Show Toast notifications for all new messages
 * @param {Array} allNewMessages - Array containing channel info and messages [{channelId, channelName, messages}, ...]
 */
function showAllToastNotifications(allNewMessages) {
  if (!allNewMessages || allNewMessages.length === 0) {
    return;
  }
  
  // Show Toast notification for each channel with new messages
  allNewMessages.forEach(item => {
    showToastNotification(item.channelName, item.messages.length);
  });
}


// ==================== Polling Control Functionality ====================

/**
 * Initialize message baseline for all channels
 * @returns {Promise}
 */
function initializeChannelBaseline() {
  return getUserJoinedChannels()
    .then(channels => {
      if (channels.length === 0) {
        return;
      }
      
      return channels.reduce((promiseChain, channel) => {
        return promiseChain
          .then(() => {
            return messageAPI.getMessages(channel.id, 0);
          })
          .then(response => {
            if (!response.ok) {
              throw new Error(`Failed to fetch messages for channel ${channel.id}`);
            }
            return response.json();
          })
          .then(data => {
            channelMessageCounts[channel.id] = data.messages.length;
            
            return delay(50);
          })
          .catch(error => {
            channelMessageCounts[channel.id] = 0;
            return delay(50);
          });
      }, Promise.resolve());
    });
}

/**
 * Auto refresh message list if current channel has new messages
 * @param {Array} allNewMessages - Detected new messages list
 */
function refreshCurrentChannelIfNeeded(allNewMessages) {
  if (!currentChannelId) {
    return;
  }
  
  const currentChannelHasNewMessages = allNewMessages.some(
    item => item.channelId === currentChannelId
  );
  
  if (currentChannelHasNewMessages) {
    getMessages(currentChannelId, 0, true);
  }
}

/**
 * Main polling task
 */
function pollForNewMessages() {
  const token = getToken();
  
  // If no token, stop polling
  if (!token) {
    stopNotificationPolling();
    return;
  }
  
  let channelsPromise;
  
  if (cachedUserChannels.length > 0) {
    channelsPromise = Promise.resolve(cachedUserChannels);
  } else {
    channelsPromise = getUserJoinedChannels();
  }
  
  channelsPromise
    .then(channels => {
      if (channels.length === 0) {
        return [];
      }
      
      return checkAllChannelsSequentially(channels);
    })
    .then(allNewMessages => {
      if (allNewMessages.length > 0) {
        showAllToastNotifications(allNewMessages);
        refreshCurrentChannelIfNeeded(allNewMessages);
      }
    })
    .catch(error => {
    });
}

/**
 * Start push notification polling
 */
function startNotificationPolling() {
  if (notificationPollingInterval !== null) {
    return;
  }
  
  initializeChannelBaseline()
    .then(() => {
      notificationPollingInterval = setInterval(() => {
        pollForNewMessages();
      }, 1000);
    })
    .catch(error => {
    });
}

/**
 * Stop push notification polling
 */
function stopNotificationPolling() {
  if (notificationPollingInterval !== null) {
    clearInterval(notificationPollingInterval);
    notificationPollingInterval = null;
  }
  
  channelMessageCounts = {};
  cachedUserChannels = [];
  isPollingInProgress = false;
  unreadChannels = {};
}


// ==================== Application Initialization ====================

/**
 * Initialize application
 */
function initializeApp() {
  const token = getToken();
  
  if (token) {
    showDashboard();
  } else {
    // If no token, clear any URL hash to prevent route handling errors
    if (window.location.hash) {
      window.location.hash = '';
    }
    showLoginForm();
  }
}


/**
 * Setup global event listeners for channel and message menus
 */
function setupChannelMenuListeners() {
  const emojiPicker = document.getElementById('emoji-picker');
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.channel-menu-btn') && !e.target.closest('.channel-dropdown-menu')) {
      document.querySelectorAll('.channel-dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
    }
    
    if (!e.target.closest('.message-menu-btn') && !e.target.closest('.message-dropdown-menu')) {
      document.querySelectorAll('.message-dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
    }
    
    if (emojiPicker && !e.target.closest('.emoji-picker') && !e.target.closest('[data-action="react"]')) {
      emojiPicker.classList.remove('show');
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.channel-dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
      document.querySelectorAll('.message-dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
      if (emojiPicker) {
        emojiPicker.classList.remove('show');
      }
    }
  });
}

/**
 * Setup global message menu event listeners
 */
function setupGlobalMessageMenuListeners() {
  const globalMenu = document.getElementById('global-message-menu');
  const emojiPicker = document.getElementById('emoji-picker');
  const messageInput = document.getElementById('message-input');
  
  if (!globalMenu || !emojiPicker) {
    return;
  }
  
  // Get menu items
  const editButton = globalMenu.querySelector('[data-action="edit"]');
  const reactionButton = globalMenu.querySelector('[data-action="react"]');
  const pinButton = globalMenu.querySelector('[data-action="pin"]');
  const deleteButton = globalMenu.querySelector('[data-action="delete"]');
  
  editButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    const currentUser = getUser();
    const messageSender = parseInt(globalMenu.dataset.currentMessageSender);
    
    if (!currentUser) {
      showError('请先登录');
      globalMenu.classList.remove('show');
      return;
    }
    
    if (currentUser.userId !== messageSender) {
      showError('您只能编辑自己的消息');
      globalMenu.classList.remove('show');
      return;
    }
    
    editMessageId = parseInt(globalMenu.dataset.currentMessageId);
    editMessageText = globalMenu.dataset.currentMessageText;
    editMessageImage = globalMenu.dataset.currentMessageImage || '';
    editMessageSender = messageSender;
    
    messageInput.textContent = editMessageText;
    messageInput.focus();
    
    const channelChatboxImagePreview = document.getElementById('channel-chatbox-image-preview');
    if (editMessageImage && channelChatboxImagePreview) {
      uploadedMessageImage = editMessageImage;
      channelChatboxImagePreview.src = editMessageImage;
      channelChatboxImagePreview.style.display = 'inline-block';
    }
    
    globalMenu.classList.remove('show');
  });

  reactionButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const messageId = parseInt(globalMenu.dataset.currentMessageId);
    
    const menuRect = globalMenu.getBoundingClientRect();
    
    globalMenu.classList.remove('show');
    
    emojiPicker.style.top = `${menuRect.top}px`;
    emojiPicker.style.left = `${menuRect.left - 110}px`;
    emojiPicker.style.right = 'auto';
    
    emojiPicker.dataset.currentMessageId = messageId;
    
    emojiPicker.classList.add('show');
  });

  pinButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    const messageId = parseInt(globalMenu.dataset.currentMessageId);
    const channelId = getCurrentChannelId();
    const isPinning = pinButton.textContent === 'Pin';
    
    globalMenu.classList.remove('show');
    
    const apiCall = isPinning 
      ? messageAPI.pinMessage(getCurrentChannelId(), messageId) 
      : messageAPI.unpinMessage(getCurrentChannelId(), messageId);

    apiCall
      .then(response => {
        if(!response.ok) {
          return response.json().then(err => {
            throw new Error(err.error);
          });
        }
        return response.json();
      })
      .then(data => {
        getMessages(getCurrentChannelId());
      })
      .catch(error => {
        showError('错误: ' + error.message);
      });
  });

  deleteButton.addEventListener('click', (e) => {
    e.preventDefault();
    
    const currentUser = getUser();
    const messageSender = parseInt(globalMenu.dataset.currentMessageSender);
    
    if (!currentUser || currentUser.userId !== messageSender) {
      showError('您只能删除自己的消息');
      globalMenu.classList.remove('show');
      return;
    }
    
    const messageId = parseInt(globalMenu.dataset.currentMessageId);
    
    globalMenu.classList.remove('show');
    
    deleteMessage(messageId);
  });
}


// ==================== Application Entry Point ====================
document.addEventListener('DOMContentLoaded', () => {
  setupAuthListeners();
  setupRegisterListeners();
  setupDashboardListeners();
  setupInviteUsersListeners();
  setupUserProfileListeners();
  setupChannelChatboxListeners();
  setupPinnedMessagesBanner();
  setupErrorModalListeners();
  setupImageModalListeners();
  setupChannelMenuListeners();
  setupGlobalMessageMenuListeners();
  setupEmojiPickerListeners();

  initializeApp();
  
  initializeRouter();
  
  initNetworkListeners();
})
