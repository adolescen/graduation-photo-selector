const API_BASE = '';

let currentUser = null;
let currentCategory = 'all';
let currentPage = 1;
let hasMorePhotos = true;
let isLoadingPhotos = false;
let selectedPhotos = new Set();
let pendingPhotoIds = []; // 弹窗中临时选择
let photoCache = {};
let isDeadlinePassed = false;

// 缓存辅助函数
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24小时

function getCategoryCacheKey(category, page) {
    return `photo_cache_${category}_${page}`;
}

function saveCategoryCache(category, page, data) {
    const key = getCategoryCacheKey(category, page);
    const cache = {
        photos: data.photos,
        total: data.total,
        totalPages: data.totalPages,
        timestamp: Date.now()
    };
    try {
        sessionStorage.setItem(key, JSON.stringify(cache));
    } catch (e) {
        // 缓存空间满，忽略
    }
}

function loadCategoryCache(category, page) {
    const key = getCategoryCacheKey(category, page);
    const data = sessionStorage.getItem(key);
    if (!data) return null;
    try {
        const cache = JSON.parse(data);
        if (Date.now() - cache.timestamp > CACHE_MAX_AGE) {
            sessionStorage.removeItem(key);
            return null;
        }
        // 恢复缓存到 photoCache
        cache.photos.forEach(p => {
            photoCache[p.id] = p;
        });
        return cache;
    } catch (e) {
        return null;
    }
}

function clearAllPhotoCache() {
    Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('photo_cache_')) {
            sessionStorage.removeItem(key);
        }
    });
}

// 安全辅助函数：HTML 转义
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// 获取认证请求头
function getAuthHeaders() {
    const token = sessionStorage.getItem('sessionToken');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Session-Token': token } : {})
    };
}

// 加载分类并渲染按钮
function loadCategories() {
    const token = sessionStorage.getItem('sessionToken');
    if (!token) return;
    
    fetch(`${API_BASE}/api/categories`, {
        headers: { 'X-Session-Token': token }
    })
        .then(r => r.json())
        .then(data => {
            if (data.success && data.categories) {
                renderCategoryButtons(data.categories);
            }
        })
        .catch(() => {});
}

function renderCategoryButtons(categories) {
    const filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;
    
    const allBtn = filterBar.querySelector('[data-category="all"]');
    filterBar.innerHTML = '';
    if (allBtn) filterBar.appendChild(allBtn);
    
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.category = cat;
        btn.textContent = cat;
        btn.onclick = () => filterCategory(cat);
        filterBar.appendChild(btn);
    });
}

// ====== 页面切换 ======
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ====== 密码验证 ======
function verifyPassword() {
    const password = document.getElementById('class-password').value.trim();
    const errorEl = document.getElementById('auth-error');
    
    if (!password) {
        errorEl.textContent = '请输入密码';
        return;
    }
    
    fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            sessionStorage.setItem('classPassword', password);
            showPage('name-page');
            document.getElementById('user-name').focus();
        } else {
            errorEl.textContent = '密码错误，请向班长确认班级密码';
        }
    })
    .catch(() => {
        errorEl.textContent = '网络错误，请稍后重试';
    });
}

function backToAuth() {
    showPage('auth-page');
}

// 回车提交
document.addEventListener('DOMContentLoaded', () => {
    const passwordInput = document.getElementById('class-password');
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verifyPassword();
        });
    }
    
    const nameInput = document.getElementById('user-name');
    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitName();
        });
    }
    
    // 检查本地存储
    checkSession();
    loadSettings();
    
    // 设置无限滚动
    setupInfiniteScroll();
});

// ====== 无限滚动（scroll 事件，更可靠） ======
function setupInfiniteScroll() {
    window.addEventListener('scroll', () => {
        if (!hasMorePhotos || isLoadingPhotos) return;
        
        const scrollBottom = window.scrollY + window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;
        
        // 距离底部 300px 时触发加载
        if (scrollBottom >= docHeight - 300) {
            loadMorePhotos();
        }
    });
}

// ====== 姓名提交 ======
function submitName() {
    const name = document.getElementById('user-name').value.trim();
    const classPassword = sessionStorage.getItem('classPassword');
    const errorEl = document.getElementById('name-error');
    
    if (!name) {
        errorEl.textContent = '请输入姓名';
        return;
    }
    
    if (!classPassword) {
        errorEl.textContent = '会话已过期，请重新输入班级密码';
        showPage('auth-page');
        return;
    }
    
    fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, classPassword })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            currentUser = { id: data.userId, name: data.name };
            sessionStorage.setItem('userName', data.name);
            sessionStorage.setItem('sessionToken', data.token);
            
            document.getElementById('display-name').textContent = data.name;
            showPage('selector-page');
            loadUserSelection();
            loadPhotos();
            loadCategories();
        } else {
            errorEl.textContent = data.message || '操作失败';
        }
    })
    .catch(() => {
        errorEl.textContent = '网络错误，请稍后重试';
    });
}

function checkSession() {
    const savedName = sessionStorage.getItem('userName');
    const savedToken = sessionStorage.getItem('sessionToken');
    const classPassword = sessionStorage.getItem('classPassword');
    
    if (savedToken && savedName && classPassword) {
        fetch(`${API_BASE}/api/users/selection`, {
            headers: { 'X-Session-Token': savedToken }
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                currentUser = { name: savedName, id: data.userId };
                showPage('selector-page');
                document.getElementById('display-name').textContent = savedName;
                loadUserSelection();
                loadPhotos();
                loadSettings();
                loadCategories();
            } else {
                sessionStorage.clear();
            }
        })
        .catch(() => {
            sessionStorage.clear();
        });
    }
}

function loadSettings() {
    fetch(`${API_BASE}/api/settings`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                isDeadlinePassed = data.isDeadlinePassed;
                if (data.deadline) {
                    const deadline = new Date(data.deadline);
                    document.getElementById('deadline-display').textContent = 
                        `截止时间: ${deadline.toLocaleString('zh-CN')}`;
                }
                if (isDeadlinePassed) {
                    document.getElementById('submit-btn').textContent = '已截止';
                    document.getElementById('submit-btn').disabled = true;
                }
            }
        })
        .catch(() => {});
}

function loadUserSelection() {
    const token = sessionStorage.getItem('sessionToken');
    if (!token) return;
    
    fetch(`${API_BASE}/api/users/selection`, {
        headers: { 'X-Session-Token': token }
    })
        .then(r => r.json())
        .then(data => {
            if (data.success && data.photoIds) {
                selectedPhotos = new Set(data.photoIds);
                currentUser = { id: data.userId, name: data.name };
                updateSelectionUI();
            }
        })
        .catch(() => {});
}

// ====== 照片加载（无限滚动） ======
function loadPhotos() {
    currentPage = 1;
    hasMorePhotos = true;
    isLoadingPhotos = false;
    
    const grid = document.getElementById('photo-grid');
    grid.innerHTML = '';
    
    // 重置 load-more 状态
    const loadMoreEl = document.getElementById('load-more');
    if (loadMoreEl) {
        loadMoreEl.classList.remove('no-more');
        loadMoreEl.classList.add('active');
    }
    
    fetchPhotoPage(1, true);
}

function loadMorePhotos() {
    if (!hasMorePhotos || isLoadingPhotos) return;
    currentPage++;
    fetchPhotoPage(currentPage, false);
}

function fetchPhotoPage(page, isFirstLoad) {
    const token = sessionStorage.getItem('sessionToken');
    if (!token) return;
    
    // 先尝试加载缓存（显示旧数据）
    const cache = loadCategoryCache(currentCategory, page);
    if (cache) {
        if (isFirstLoad) {
            renderPhotos(cache.photos, false);
        } else {
            renderPhotos(cache.photos, true);
        }
        hasMorePhotos = page < cache.totalPages;
        updateLoadMoreState();
    }
    
    isLoadingPhotos = true;
    const loading = document.getElementById('loading');
    const loadMoreEl = document.getElementById('load-more');
    
    if (isFirstLoad && loading && !cache) loading.classList.add('active');
    if (!isFirstLoad && loadMoreEl) loadMoreEl.classList.add('active');
    
    fetch(`${API_BASE}/api/photos?category=${currentCategory}&page=${page}&limit=50`, {
        headers: { 'X-Session-Token': token }
    })
        .then(r => r.json())
        .then(data => {
            isLoadingPhotos = false;
            if (loading) loading.classList.remove('active');
            if (loadMoreEl) loadMoreEl.classList.remove('active');
            
            if (data.success) {
                // 保存缓存
                saveCategoryCache(currentCategory, page, data);
                // 如果有缓存，只在数据变化时更新（避免闪烁）
                if (!cache) {
                    renderPhotos(data.photos, !isFirstLoad);
                }
                hasMorePhotos = page < data.totalPages;
                updateLoadMoreState();
            }
        })
        .catch(() => {
            isLoadingPhotos = false;
            if (loading) loading.classList.remove('active');
            if (loadMoreEl) loadMoreEl.classList.remove('active');
        });
}

function updateLoadMoreState() {
    const loadMoreEl = document.getElementById('load-more');
    if (!loadMoreEl) return;
    
    if (!hasMorePhotos) {
        loadMoreEl.classList.add('no-more');
    } else {
        loadMoreEl.classList.remove('no-more');
    }
}

function renderPhotos(photos, append = false) {
    const grid = document.getElementById('photo-grid');
    if (!append) grid.innerHTML = '';
    
    photos.forEach(photo => {
        photoCache[photo.id] = photo;
        
        const isSelected = selectedPhotos.has(photo.id);
        const orderIndex = Array.from(selectedPhotos).indexOf(photo.id) + 1;
        
        const item = document.createElement('div');
        item.className = `photo-item ${isSelected ? 'selected' : ''}`;
        item.dataset.id = photo.id;
        
        // 点击照片主体 = 选中/取消
        item.onclick = (e) => {
            if (e.target.closest('.photo-preview-btn')) {
                e.stopPropagation();
                previewPhoto(photo.fullUrl);
            } else {
                togglePhoto(photo.id);
            }
        };
        
        const badge = isSelected ? `<div class="order-badge">${orderIndex}</div>` : '';
        item.innerHTML = `
            <img src="${photo.thumbnailUrl}" alt="${photo.displayName}" loading="lazy">
            ${badge}
            <div class="photo-preview-btn" title="查看大图">👁</div>
        `;
        
        grid.appendChild(item);
    });
}

// ====== 选择逻辑（不限制数量） ======
function togglePhoto(photoId) {
    if (isDeadlinePassed) {
        alert('已超过截止时间，无法修改选择');
        return;
    }
    
    if (selectedPhotos.has(photoId)) {
        selectedPhotos.delete(photoId);
    } else {
        selectedPhotos.add(photoId);
    }
    
    updateSelectionUI();
    
    // 选中状态更新
    document.querySelectorAll('.photo-item').forEach(item => {
        const id = parseInt(item.dataset.id);
        const isSelected = selectedPhotos.has(id);
        const orderIndex = Array.from(selectedPhotos).indexOf(id) + 1;
        
        item.classList.toggle('selected', isSelected);
        
        // 更新或移除 order-badge
        let badge = item.querySelector('.order-badge');
        if (isSelected) {
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'order-badge';
                item.appendChild(badge);
            }
            badge.textContent = orderIndex;
        } else if (badge) {
            badge.remove();
        }
    });
}

function updateSelectionUI() {
    const count = selectedPhotos.size;
    document.getElementById('selected-count').textContent = count;
    document.getElementById('panel-count').textContent = count;
    
    const progressFill = document.getElementById('progress-fill');
    progressFill.style.width = `${Math.min((count / 8) * 100, 100)}%`;
    progressFill.classList.toggle('complete', count >= 8);
    
    const statusText = document.getElementById('status-text');
    if (count >= 8) {
        statusText.textContent = '已选够8张，可以提交！';
        statusText.style.color = '#27ae60';
    } else if (count === 0) {
        statusText.textContent = '还需选择8张';
        statusText.style.color = '#888';
    } else {
        statusText.textContent = `还需选择 ${8 - count} 张`;
        statusText.style.color = '#888';
    }
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = count < 8 || isDeadlinePassed;
    if (isDeadlinePassed) {
        submitBtn.textContent = '已截止';
    }
    
    updateSelectedPanel();
}

function updateSelectedPanel() {
    const container = document.getElementById('selected-thumbnails');
    container.innerHTML = '';
    
    Array.from(selectedPhotos).forEach(photoId => {
        const photo = photoCache[photoId];
        if (!photo) return;
        
        const thumb = document.createElement('div');
        thumb.className = 'selected-thumb';
        thumb.innerHTML = `
            <img src="${photo.thumbnailUrl}" alt="${photo.displayName}">
            <div class="remove-btn" onclick="event.stopPropagation(); togglePhoto(${photoId})">✕</div>
        `;
        thumb.onclick = () => previewPhoto(photo.fullUrl);
        container.appendChild(thumb);
    });
}

function toggleSelectedPanel() {
    document.getElementById('selected-panel').classList.toggle('collapsed');
    const toggle = document.getElementById('panel-toggle');
    toggle.textContent = toggle.textContent === '▼' ? '▲' : '▼';
}

// ====== 分类筛选 ======
function filterCategory(category) {
    currentCategory = category;
    currentPage = 1;
    hasMorePhotos = true;
    
    // 重置 load-more 状态
    const loadMoreEl = document.getElementById('load-more');
    if (loadMoreEl) {
        loadMoreEl.classList.remove('no-more');
        loadMoreEl.classList.add('active');
    }
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === category);
    });
    
    loadPhotos();
}

// ====== 提交（弹窗中可取消多余照片） ======
function submitSelection() {
    if (selectedPhotos.size < 8) {
        alert('需要至少选择8张照片才能提交');
        return;
    }
    
    // 初始化弹窗中的临时选择
    pendingPhotoIds = Array.from(selectedPhotos);
    renderConfirmPhotos();
    document.getElementById('confirm-modal').classList.remove('hidden');
}

function renderConfirmPhotos() {
    const confirmPhotos = document.getElementById('confirm-photos');
    const confirmTitle = document.getElementById('confirm-title');
    const confirmDesc = document.getElementById('confirm-desc');
    const confirmCount = document.getElementById('confirm-count');
    const submitBtn = document.getElementById('confirm-submit-btn');
    
    confirmPhotos.innerHTML = '';
    const count = pendingPhotoIds.length;
    
    // 更新标题
    if (count > 8) {
        confirmTitle.textContent = '请保留恰好8张照片';
        confirmDesc.innerHTML = `您已选择 <strong>${count}</strong> 张，点击照片可取消多余的选择。`;
    } else if (count === 8) {
        confirmTitle.textContent = '确认提交';
        confirmDesc.textContent = '以下8张照片将被提交：';
    } else {
        confirmTitle.textContent = '照片不足';
        confirmDesc.textContent = `当前仅 ${count} 张，需要恰好8张。`;
    }
    
    // 渲染每张照片（可点击取消，也可查看大图）
    pendingPhotoIds.forEach(id => {
        const photo = photoCache[id];
        if (!photo) return;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'confirm-photo-item';
        wrapper.dataset.id = id;
        
        const img = document.createElement('img');
        img.src = photo.thumbnailUrl;
        img.alt = photo.displayName || '';
        
        // 查看大图按钮
        const viewBtn = document.createElement('div');
        viewBtn.className = 'view-btn';
        viewBtn.textContent = '👁';
        viewBtn.title = '查看大图';
        viewBtn.onclick = (e) => {
            e.stopPropagation();
            openPhotoViewer(photo.fullUrl, photo.displayName || '');
        };
        
        // 取消标记
        const removeMark = document.createElement('div');
        removeMark.className = 'remove-mark';
        removeMark.textContent = '✕';
        
        wrapper.appendChild(img);
        wrapper.appendChild(viewBtn);
        wrapper.appendChild(removeMark);
        
        // 点击照片本身 = 取消
        wrapper.onclick = (e) => {
            if (e.target === viewBtn) return;
            const idx = pendingPhotoIds.indexOf(id);
            if (idx > -1) {
                pendingPhotoIds.splice(idx, 1);
                wrapper.remove();
                updateConfirmState();
            }
        };
        
        confirmPhotos.appendChild(wrapper);
    });
    
    updateConfirmState();
}

function updateConfirmState() {
    const count = pendingPhotoIds.length;
    const confirmCount = document.getElementById('confirm-count');
    const submitBtn = document.getElementById('confirm-submit-btn');
    
    confirmCount.textContent = `当前 ${count} / 8 张`;
    confirmCount.style.color = count === 8 ? '#27ae60' : '#e74c3c';
    
    if (count === 8) {
        submitBtn.textContent = '确认提交';
        submitBtn.disabled = false;
    } else {
        submitBtn.textContent = count > 8 ? `请取消 ${count - 8} 张` : `还需 ${8 - count} 张`;
        submitBtn.disabled = true;
    }
}

function closeModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
}

function confirmSubmit() {
    if (pendingPhotoIds.length !== 8) {
        alert('必须恰好选择8张照片');
        return;
    }
    
    const token = sessionStorage.getItem('sessionToken');
    if (!token) {
        alert('会话已过期，请重新登录');
        return;
    }
    
    fetch(`${API_BASE}/api/selections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
        body: JSON.stringify({ photoIds: pendingPhotoIds })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            // 同步主选择状态
            selectedPhotos = new Set(pendingPhotoIds);
            updateSelectionUI();
            alert('提交成功！你可以在"我的选择"中查看');
            closeModal();
        } else {
            alert(data.message || '提交失败');
        }
    })
    .catch(() => {
        alert('网络错误，请稍后重试');
    });
}

// ====== 预览 ======
function previewPhoto(url, title) {
    openPhotoViewer(url, title);
}

function closePreview() {
    closePhotoViewer();
}

// ====== 导航 ======
function goToDashboard() {
    window.location.href = 'dashboard.html';
}

// ====== 退出登录 ======
function logout() {
    if (!confirm('确定要退出当前身份吗？')) return;
    sessionStorage.clear();
    currentUser = null;
    selectedPhotos.clear();
    photoCache = {};
    currentCategory = 'all';
    currentPage = 1;
    hasMorePhotos = true;
    showPage('auth-page');
    document.getElementById('class-password').value = '';
    document.getElementById('auth-error').textContent = '';
}
