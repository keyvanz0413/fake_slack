import { API_BASE_URL, MIN_PASSWORD_LENGTH, MIN_NAME_LENGTH, TOKEN_KEY, USER_KEY } from './config.js';

// ==================== File Processing Utilities ====================

/**
 * Given a js file object representing a jpg or png image, such as one taken
 * from a html file input element, return a promise which resolves to the file
 * data as a data url.
 * More info:
 *   https://developer.mozilla.org/en-US/docs/Web/API/File
 *   https://developer.mozilla.org/en-US/docs/Web/API/FileReader
 *   https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
 * 
 * Example Usage:
 *   const file = document.querySelector('input[type="file"]').files[0];
 *   console.log(fileToDataUrl(file));
 * @param {File} file The file to be read.
 * @return {Promise<string>} Promise which resolves to the file as a data url.
 */
export function fileToDataUrl(file) {
    const validFileTypes = [ 'image/jpeg', 'image/png', 'image/jpg' ]
    const valid = validFileTypes.find(type => type === file.type);
    if (!valid) {
        throw Error('提供的文件不是 png、jpg 或 jpeg 图片。');
    }
    
    const reader = new FileReader();
    const dataUrlPromise = new Promise((resolve,reject) => {
        reader.onerror = reject;
        reader.onload = () => resolve(reader.result);
    });
    reader.readAsDataURL(file);
    return dataUrlPromise;
}

// ==================== Validator Utilities ====================

export const validator = {
  /**
   * Validate email format
   * @param {string} email - Email address
   * @returns {boolean} - Whether it is valid
   */
  isValidEmail: (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  /**
   * Validate password length
   * @param {string} password - Password
   * @returns {boolean} - Whether it is valid
   */
  isValidPassword: (password) => {
    return password.length >= MIN_PASSWORD_LENGTH;
  },

  /**
   * Validate username length
   * @param {string} name - Username
   * @returns {boolean} - Whether it is valid
   */
  isValidName: (name) => {
    return name.length >= MIN_NAME_LENGTH;
  },
};

// ==================== Form Processing Utilities ====================
export function clearForm(formId) {
    const form = document.getElementById(formId);
    if (form) {
        form.reset();
    }
}

// ==================== Local Storage Utilities ====================
/**
 * Get stored token
 * @returns {string|null} - Token or null
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Set token to local storage
 * @param {string} token - Token to store
 */
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Remove token from local storage
 */
export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Get stored user information
 * @returns {object|null} - User information object or null
 */
export function getUser() {
  const user = localStorage.getItem(USER_KEY);
  return user ? JSON.parse(user) : null;
}

/**
 * Set user information to local storage
 * @param {object} user - User information object
 */
export function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Remove user information from local storage
 */
export function removeUser() {
  localStorage.removeItem(USER_KEY);
}

// ==================== Time Formatting Utilities ====================

/**
 * Format full date and time
 * @param {string} isoString - ISO time format
 * @returns {string} Formatted Sydney time
 */
export function formatFullDateTime(isoString) {
  const date = new Date(isoString);
  
  const options = {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  
  return date.toLocaleString('zh-CN', options);
}

/**
 * Format timestamp (relative time)
 * @param {string} isoString - ISO time format
 * @returns {string} Formatted relative time
 */
export function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return '刚刚';
  } else if (diffMins < 60) {
    return `${diffMins}分钟前`;
  } else if (diffHours < 24) {
    return `${diffHours}小时前`;
  } else {
    return `${diffDays}天前`;
  }
}

// ==================== API Request Utilities ====================

/**
 * Generic API request function
 * @param {string} endpoint - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} - Fetch response
 */
export function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
}

// ==================== API Service Layer ====================

/**
 * Authentication related API
 */
export const authAPI = {
  /**
   * User login
   * @param {string} email - Email
   * @param {string} password - Password
   * @returns {Promise<Response>}
   */
  login: (email, password) => {
    return apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  /**
   * User registration
   * @param {string} name - Username
   * @param {string} email - Email
   * @param {string} password - Password
   * @returns {Promise<Response>}
   */
  register: (name, email, password) => {
    return apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  },

  /**
   * User logout
   * @returns {Promise<Response>}
   */
  logout: () => {
    return apiRequest('/auth/logout', {
      method: 'POST',
    });
  },
};


export const channelAPI = {
  /**
   * Get channel list
   * @returns {Promise<Response>}
   */
  getChannels: () => {
    return apiRequest('/channel', {
      method: 'GET',
    });
  },

  /**
   * Create channel
   * @param {string} name - Channel name
   * @param {boolean} isPrivate - Whether it is private
   * @param {string} description - Channel description
   * @returns {Promise<Response>}
   */
  createChannel: (name, isPrivate, description) => {
    return apiRequest('/channel', {
      method: 'POST',
      body: JSON.stringify({ name, private: isPrivate, description }),
    })
  },

  /**
   * Get channel information
   * @param {number} channelId - Channel ID
   * @returns {Promise<response>}
   */
  getChannelInfo: (channelId) => {
    return apiRequest(`/channel/${channelId}`, {
      method: 'GET',
    });
  },

  /**
   * Update channel information
   * @param {number} channelId - Channel ID
   * @param {string} name - Channel name
   * @param {string} description - Channel description
   * @returns {Promise<response>}
   */
  updateChannelInfo: (channelId, name, description) => {
    return apiRequest(`/channel/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description }),
    });
  },

  /**
   * Join channel
   * @param {number} channelId - Channel ID
   * @returns {Promise<response>}
   */
  joinChannel: (channelId) => {
    return apiRequest(`/channel/${channelId}/join`, {
      method: 'POST'
    });
  },

  /**
   * Leave channel
   * @param {number} channelId - Channel ID
   * @returns {Promise<response>}
   */
  leaveChannel: (channelId) => {
    return apiRequest(`/channel/${channelId}/leave`, {
      method: 'POST'
    });
  },

  /**
   * Invite user to join channel
   * @param {number} channelId - Channel ID
   * @param {number} userId - User ID
   * @returns {Promise<response>}
   */
  inviteToChannel: (channelId, userId) => {
    return apiRequest(`/channel/${channelId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  },
};

export const messageAPI = {
  /**
   * Get channel message list
   * @param {number} channelId - Channel ID
   * @param {number} start - Start index (default is 0)
   * @returns {Promise<response>}
   */
  getMessages: (channelId, start = 0) => {
    return apiRequest(`/message/${channelId}?start=${start}`, {
      method: 'GET',
    });
  },

  /**
   * Send message
   * @param {number} channelId - Channel ID
   * @param {string} message - Message content
   * @param {string} image - Message image (optional)
   * @returns {Promise<response>}
   */
  sendMessage: (channelId, message, image = null) => {
    const body = { message };
    if (image) {
      body.image = image;
    }
    return apiRequest(`/message/${channelId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  /**
   * Edit message
   * @param {number} channelId - Channel ID
   * @param {number} messageId - Message ID
   * @param {string} message - Message content
   * @param {string} image - Message image
   * @returns {Promise<response>}
   */
  editMessage: (channelId, messageId, message, image) => {
    const body = { message };
    if (image) {
      body.image = image;
    }
    return apiRequest(`/message/${channelId}/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  /**
   * Delete message
   * @param {number} channelId - Channel ID
   * @param {number} messageId - Message ID
   * @returns {Promise<response>}
   */
  deleteMessage: (channelId, messageId) => {
    return apiRequest(`/message/${channelId}/${messageId}`, {
      method: 'DELETE'
    });
  },

  /**
   * Pin message
   * @param {number} channelId - Channel ID
   * @param {number} messageId - Message ID
   * @returns {Promise<response>}
   */
  pinMessage: (channelId, messageId) => {
    return apiRequest(`/message/pin/${channelId}/${messageId}`, {
      method: 'POST',
    });
  },

  /**
   * Unpin message
   * @param {number} channelId - Channel ID
   * @param {number} messageId - Message ID
   * @returns {Promise<response>}
   */
  unpinMessage: (channelId, messageId) => {
    return apiRequest(`/message/unpin/${channelId}/${messageId}`, {
      method: 'POST',
    });
  },

  /**
   * React to message
   * @param {number} channelId - Channel ID
   * @param {number} messageId - Message ID
   * @param {string} react - Reaction type
   * @returns {Promise<response>}
   */
  reactMessage: (channelId, messageId, react) => {
    return apiRequest(`/message/react/${channelId}/${messageId}`, {
      method: 'POST',
      body: JSON.stringify({ react }),
    });
  },

  /**
   * Remove reaction from message
   * @param {number} channelId - Channel ID
   * @param {number} messageId - Message ID
   * @param {string} react - Reaction type
   * @returns {Promise<response>}
   */
  unreactMessage: (channelId, messageId, react) => {
    return apiRequest(`/message/unreact/${channelId}/${messageId}`, {
      method: 'POST',
      body: JSON.stringify({ react }),
    });
  },
}

export const userAPI = {
  /**
   * Get user list
   * @returns {Promise<Response>}
   */
  getUsers: () => {
    return apiRequest('/user', {
      method: 'GET',
    });
  },

  /**
   * Update user information
   * @param {string} email - Email
   * @param {string} password - Password
   * @param {string} name - Username
   * @param {string} bio - Bio
   * @param {string} image - Avatar
   * @returns {Promise<Response>}
   */
  updateUserInfo: (email, password, name, bio, image) => {
    const body = {};
    if (email) body.email = email;
    if (password) body.password = password;
    if (name) body.name = name;
    if (bio !== undefined && bio !== null) body.bio = bio;
    if (image) body.image = image;
    
    return apiRequest('/user', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  
  /**
   * Get user information
   * @param {number} userId - User ID
   * @returns {Promise<Response>}
   */
  getUserInfo: (userId) => {
    return apiRequest(`/user/${userId}`, {
      method: 'GET',
    });
  },
};

// ==================== UI Utility Functions ====================

/**
 * Show error modal
 * @param {string} message - Error message
 */
export function showError(message) {
  const errorModal = document.getElementById('error-modal');
  const errorBody = document.getElementById('error-body');
  if (errorBody) {
    errorBody.textContent = message;
  }
  if (errorModal) {
    errorModal.style.display = 'flex';
  }
}

/**
 * Hide error modal
 */
export function hideError() {
  const errorModal = document.getElementById('error-modal');
  if (errorModal) {
    errorModal.style.display = 'none';
  }
}


/**
 * Show create channel modal
 */
export function showCreateChannelModal(channelId) {
  const channelInfoModal = document.getElementById('create-channel-container');
  if (channelInfoModal) {
    channelInfoModal.classList.remove('hidden');
    channelInfoModal.style.display = 'flex';
  }
}

/**
 * Hide create channel modal
 */
export function hideCreateChannelModal() {
  const channelInfoModal = document.getElementById('create-channel-container');
  if (channelInfoModal) {
    channelInfoModal.classList.add('hidden');
    channelInfoModal.style.display = 'none';
  }
}

/**
 * Show channel details modal
 * @param {number} channelId - Channel ID
 */
export function showChannelDetailsModal(channelId) {
  const modal = document.getElementById('channel-details-container');
  if (modal) {
    modal.style.display = 'flex';
    modal.dataset.channelId = channelId;
  }
}

/**
 * Hide channel details modal
 */
export function hideChannelDetailsModal() {
  const modal = document.getElementById('channel-details-container');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Show channel chatbox
 */
export function showChannelChatbox() {
  const chatboxBlank = document.querySelector('.channel-chatbox-blank');
  const chatboxHeader = document.querySelector('.channel-chatbox-header');
  const chatboxBody = document.querySelector('.channel-chatbox-body');
  const chatboxInput = document.querySelector('.channel-chatbox-input');

  chatboxBlank.style.display = 'none';
  chatboxHeader.style.display = 'flex';
  chatboxBody.style.display = 'block';
  chatboxInput.style.display = 'block';
}

/**
 * Hide channel chatbox
 */
export function hideChannelChatbox() {
  const chatboxBlank = document.querySelector('.channel-chatbox-blank');
  const chatboxHeader = document.querySelector('.channel-chatbox-header');
  const chatboxBody = document.querySelector('.channel-chatbox-body');
  const chatboxInput = document.querySelector('.channel-chatbox-input');
  const banner = document.querySelector('.channel-chatbox-banner');

  chatboxBlank.style.display = 'flex';
  chatboxHeader.style.display = 'none';
  chatboxBody.style.display = 'none';
  chatboxInput.style.display = 'none';
  
  if (banner) {
    banner.style.display = 'none';
  }
  
  document.querySelectorAll('.channel-container').forEach(container => {
    container.classList.remove('active');
  });
}
