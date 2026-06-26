// ====== 通用图片查看器 ======
// 支持：放大、缩小、平移、鼠标滚轮缩放、双击重置、ESC关闭
// 被 index.html、dashboard.html、admin.html 共用

function PhotoViewer() {
    this.modal = null;
    this.img = null;
    this.container = null;
    this.toolbar = null;
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.lastTouchDist = 0;
    this.minScale = 0.5;
    this.maxScale = 5;
    this._init();
}

PhotoViewer.prototype._init = function() {
    // 如果已存在，移除旧实例
    const existing = document.getElementById('photo-viewer-overlay');
    if (existing) existing.remove();

    // 创建 DOM
    this.modal = document.createElement('div');
    this.modal.id = 'photo-viewer-overlay';
    this.modal.className = 'viewer-overlay';
    this.modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:1000;display:none;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;';

    // 工具栏
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'viewer-toolbar';
    this.toolbar.style.cssText = 'position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;z-index:10;background:linear-gradient(rgba(0,0,0,0.4),transparent);';
    this.toolbar.innerHTML = `
        <div class="viewer-info" style="color:#fff;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50vw;"></div>
        <div class="viewer-actions" style="display:flex;gap:8px;align-items:center;">
            <button class="viewer-btn" onclick="photoViewer.zoomIn()" title="放大">➕</button>
            <span class="viewer-zoom" style="color:#fff;font-size:13px;min-width:50px;text-align:center;">100%</span>
            <button class="viewer-btn" onclick="photoViewer.zoomOut()" title="缩小">➖</button>
            <button class="viewer-btn" onclick="photoViewer.reset()" title="重置">↺</button>
            <button class="viewer-btn" onclick="photoViewer.close()" title="关闭 (ESC)">✕</button>
        </div>
    `;

    // 图片容器（用于平移）
    this.container = document.createElement('div');
    this.container.className = 'viewer-container';
    this.container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;';

    this.img = document.createElement('img');
    this.img.className = 'viewer-img';
    this.img.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;transition:transform 0.1s ease-out;will-change:transform;pointer-events:none;';

    this.container.appendChild(this.img);
    this.modal.appendChild(this.toolbar);
    this.modal.appendChild(this.container);
    document.body.appendChild(this.modal);

    // 绑定事件
    this._bindEvents();
};

PhotoViewer.prototype._bindEvents = function() {
    const self = this;

    // 鼠标滚轮缩放
    this.container.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        self._setScale(self.scale * delta);
    }, { passive: false });

    // 鼠标拖拽平移
    this.container.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        self.isDragging = true;
        self.startX = e.clientX - self.translateX;
        self.startY = e.clientY - self.translateY;
        self.container.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!self.isDragging) return;
        self.translateX = e.clientX - self.startX;
        self.translateY = e.clientY - self.startY;
        self._updateTransform();
    });

    document.addEventListener('mouseup', function() {
        self.isDragging = false;
        if (self.container) self.container.style.cursor = 'grab';
    });

    // 双击重置
    this.container.addEventListener('dblclick', function(e) {
        e.preventDefault();
        self.reset();
    });

    // 触摸手势（双指缩放）
    this.container.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            self.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
        } else if (e.touches.length === 1) {
            self.isDragging = true;
            self.startX = e.touches[0].clientX - self.translateX;
            self.startY = e.touches[0].clientY - self.translateY;
        }
    }, { passive: false });

    this.container.addEventListener('touchmove', function(e) {
        e.preventDefault();
        if (e.touches.length === 2 && self.lastTouchDist > 0) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ratio = dist / self.lastTouchDist;
            self.lastTouchDist = dist;
            self._setScale(self.scale * ratio);
        } else if (e.touches.length === 1 && self.isDragging) {
            self.translateX = e.touches[0].clientX - self.startX;
            self.translateY = e.touches[0].clientY - self.startY;
            self._updateTransform();
        }
    }, { passive: false });

    this.container.addEventListener('touchend', function() {
        self.isDragging = false;
        self.lastTouchDist = 0;
    });

    // ESC 关闭
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && self.modal.style.display === 'flex') {
            self.close();
        }
    });

    // 点击背景关闭（不点击在图片上时）
    this.modal.addEventListener('click', function(e) {
        if (e.target === self.modal || e.target === self.container) {
            self.close();
        }
    });
};

PhotoViewer.prototype.open = function(url, title) {
    this.img.src = url;
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // 禁止背景滚动
    this.reset();

    // 显示标题
    const infoEl = this.toolbar.querySelector('.viewer-info');
    if (infoEl) infoEl.textContent = title || '';
};

PhotoViewer.prototype.close = function() {
    this.modal.style.display = 'none';
    document.body.style.overflow = '';
    this.img.src = '';
};

PhotoViewer.prototype.zoomIn = function() {
    this._setScale(this.scale * 1.25);
};

PhotoViewer.prototype.zoomOut = function() {
    this._setScale(this.scale * 0.8);
};

PhotoViewer.prototype.reset = function() {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this._updateTransform();
    this._updateZoomLabel();
};

PhotoViewer.prototype._setScale = function(s) {
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, s));
    this._updateTransform();
    this._updateZoomLabel();
};

PhotoViewer.prototype._updateTransform = function() {
    this.img.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
};

PhotoViewer.prototype._updateZoomLabel = function() {
    const label = this.toolbar.querySelector('.viewer-zoom');
    if (label) label.textContent = Math.round(this.scale * 100) + '%';
};

// 全局单例
let photoViewer = null;

function openPhotoViewer(url, title) {
    if (!photoViewer) photoViewer = new PhotoViewer();
    photoViewer.open(url, title);
}

function closePhotoViewer() {
    if (photoViewer) photoViewer.close();
}
