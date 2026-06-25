const API_BASE = '';

let currentUser = null;
let currentCategory = 'all';
let currentPage = 1;
let selectedPhotos = new Set();
let photoCache = {};
let isDeadlinePassed = false;

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
});

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
        // 验证 session 是否有效
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
                // session 已过期，清除
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

// ====== 照片加载 ======
function loadPhotos() {
    const token = sessionStorage.getItem('sessionToken');
    if (!token) return;
    
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    
    fetch(`${API_BASE}/api/photos?category=${currentCategory}&page=${currentPage}&limit=30`, {
        headers: { 'X-Session-Token': token }
    })
        .then(r => r.json())
        .then(data => {
            loading.classList.remove('active');
            if (data.success) {
                renderPhotos(data.photos);
                renderPagination(data.page, data.totalPages, data.total);
            }
        })
        .catch(() => {
            loading.classList.remove('active');
        });
}

function renderPhotos(photos) {
    const grid = document.getElementById('photo-grid');
    grid.innerHTML = '';
    
    photos.forEach(photo => {
        photoCache[photo.id] = photo;
        
        const isSelected = selectedPhotos.has(photo.id);
        const orderIndex = Array.from(selectedPhotos).indexOf(photo.id) + 1;
        
        const item = document.createElement('div');
        item.className = `photo-item ${isSelected ? 'selected' : ''}`;
        item.dataset.id = photo.id;
        item.onclick = (e) => {
            if (e.target.closest('.photo-overlay')) {
                previewPhoto(photo.fullUrl);
            } else {
                togglePhoto(photo.id);
            }
        };
        
        const badge = isSelected ? `<div class="order-badge">${orderIndex}</div>` : '';
        item.innerHTML = `
            <img src="${photo.thumbnailUrl}" alt="${photo.displayName}" loading="lazy">
            ${badge}
            <div class="photo-overlay"><span class="view-icon">🔍</span></div>
        `;
        
        grid.appendChild(item);
    });
}

function renderPagination(page, totalPages, total) {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '上一页';
    prevBtn.disabled = page <= 1;
    prevBtn.onclick = () => { currentPage--; loadPhotos(); };
    pagination.appendChild(prevBtn);
    
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `${page} / ${totalPages} 页 (共${total}张)`;
    pagination.appendChild(info);
    
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下一页';
    nextBtn.disabled = page >= totalPages;
    nextBtn.onclick = () => { currentPage++; loadPhotos(); };
    pagination.appendChild(nextBtn);
}

// ====== 选择逻辑 ======
function togglePhoto(photoId) {
    if (isDeadlinePassed) {
        alert('已超过截止时间，无法修改选择');
        return;
    }
    
    if (selectedPhotos.has(photoId)) {
        selectedPhotos.delete(photoId);
    } else {
        if (selectedPhotos.size >= 8) {
            alert('已选满8张，如需更换请先取消已选的照片');
            return;
        }
        selectedPhotos.add(photoId);
    }
    
    updateSelectionUI();
    
    const items = document.querySelectorAll('.photo-item');
    items.forEach(item => {
        const id = parseInt(item.dataset.id);
        const isSelected = selectedPhotos.has(id);
        const orderIndex = Array.from(selectedPhotos).indexOf(id) + 1;
        
        item.classList.toggle('selected', isSelected);
        
        const badge = item.querySelector('.order-badge');
        if (isSelected) {
            if (!badge) {
                const newBadge = document.createElement('div');
                newBadge.className = 'order-badge';
                newBadge.textContent = orderIndex;
                item.insertBefore(newBadge, item.querySelector('.photo-overlay'));
            } else {
                badge.textContent = orderIndex;
            }
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
    progressFill.style.width = `${(count / 8) * 100}%`;
    progressFill.classList.toggle('complete', count === 8);
    
    const statusText = document.getElementById('status-text');
    if (count === 8) {
        statusText.textContent = '选够了，可以提交！';
        statusText.style.color = '#27ae60';
    } else if (count === 0) {
        statusText.textContent = '还需选择8张';
        statusText.style.color = '#888';
    } else {
        statusText.textContent = `还需选择 ${8 - count} 张`;
        statusText.style.color = '#888';
    }
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = count !== 8 || isDeadlinePassed;
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
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === category);
    });
    
    loadPhotos();
}

// ====== 提交 ======
function submitSelection() {
    if (selectedPhotos.size !== 8) {
        alert('必须选择恰好8张照片');
        return;
    }
    
    const photoIds = Array.from(selectedPhotos);
    const confirmPhotos = document.getElementById('confirm-photos');
    confirmPhotos.innerHTML = '';
    
    photoIds.forEach(id => {
        const photo = photoCache[id];
        if (photo) {
            const img = document.createElement('img');
            img.src = photo.thumbnailUrl;
            img.alt = photo.displayName;
            confirmPhotos.appendChild(img);
        }
    });
    
    document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
}

function confirmSubmit() {
    const token = sessionStorage.getItem('sessionToken');
    if (!token) {
        alert('会话已过期，请重新登录');
        return;
    }
    
    const photoIds = Array.from(selectedPhotos);
    
    fetch(`${API_BASE}/api/selections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
        body: JSON.stringify({ photoIds })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
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
function previewPhoto(url) {
    document.getElementById('preview-img').src = url;
    document.getElementById('preview-modal').classList.remove('hidden');
}

function closePreview() {
    document.getElementById('preview-modal').classList.add('hidden');
}

// 点击预览背景关闭
 document.getElementById('preview-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePreview();
});

// ====== 导航 ======
function goToDashboard() {
    window.location.href = 'dashboard.html';
}
