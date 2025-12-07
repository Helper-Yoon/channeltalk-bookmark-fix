// ==UserScript==
// @name         ChannelTalk Bookmark Order Fix
// @namespace    http://channel.io/
// @version      1.0
// @author       윤도우리
// @match        https://desk.channel.io/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🚀 ChannelTalk Bookmark Order Fix v1.0');
    
    let sortedData = null;
    let reordering = false;
    
    function isBookmark() {
        const items = document.querySelectorAll('[class*="UserChatListItem"]');
        if (!items.length) return false;
        const key = Object.keys(items[0]).find(k => k.startsWith('__reactFiber'));
        if (!key) return false;
        let f = items[0][key];
        for (let i = 0; i < 10 && f; i++) {
            if (f?.memoizedProps?.data?.list?.get?.(0)?.toJS?.()?.$bookmarkKey) {
                return true;
            }
            f = f.return;
        }
        return false;
    }
    
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (url && url.includes('/user-chats/bookmark')) {
            url = url.replace(/limit=\d+/, 'limit=500');
        }
        this._url = url;
        return xhrOpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
        if (this._url && this._url.includes('/user-chats/bookmark')) {
            console.log('📡 API');
            this.addEventListener('load', function() {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data.userChats) {
                        sortedData = [...data.userChats].sort((a, b) => 
                            (b.frontUpdatedAt || b.updatedAt) - (a.frontUpdatedAt || a.updatedAt)
                        );
                        console.log('✅ 정렬:', sortedData.length, '개');
                        
                        setTimeout(() => forceRenderAll(), 500);
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        }
        return xhrSend.apply(this, args);
    };
    
    function forceRenderAll() {
        const rows = document.querySelectorAll('[class*="RowWrapper"]');
        if (!rows.length) return;
        
        const container = rows[0].parentElement;
        if (!container) return;
        
        const rowHeight = rows[0].offsetHeight;
        const totalHeight = sortedData.length * rowHeight;
        
        console.log('📏 필요 높이:', totalHeight, 'px');
        
        // Container 높이 설정
        container.style.height = totalHeight + 'px';
        container.style.minHeight = totalHeight + 'px';
        
        // 부모 0, 1: 높이 늘림 (React 렌더링 강제)
        const parent0 = container.parentElement;
        if (parent0) {
            parent0.style.height = totalHeight + 'px';
            parent0.style.minHeight = totalHeight + 'px';
            console.log('  ✅ 부모0:', totalHeight, 'px');
            
            const parent1 = parent0.parentElement;
            if (parent1) {
                parent1.style.height = totalHeight + 'px';
                parent1.style.minHeight = totalHeight + 'px';
                console.log('  ✅ 부모1:', totalHeight, 'px');
                
                // 부모 2: 높이 고정 안함, 스크롤만 활성화
                const parent2 = parent1.parentElement;
                if (parent2) {
                    parent2.style.overflow = 'auto';
                    parent2.style.overflowY = 'auto';
                    parent2.style.maxHeight = '100vh';
                    console.log('  📜 부모2: 스크롤 활성화');
                }
            }
        }
        
        setTimeout(() => {
            console.log('  ⏳ 1초...');
            doReorder();
        }, 1000);
        
        setTimeout(() => {
            console.log('  ⏳ 2초...');
            doReorder();
        }, 2000);
        
        setTimeout(() => {
            console.log('  ⏳ 3초...');
            doReorder();
        }, 3000);
    }
    
    function doReorder() {
        if (!sortedData || !isBookmark() || reordering) return;
        
        reordering = true;
        
        const rows = document.querySelectorAll('[class*="RowWrapper"]');
        if (!rows.length) {
            reordering = false;
            return;
        }
        
        const rowHeight = rows[0].offsetHeight;
        const rowMap = new Map();
        
        rows.forEach(row => {
            const item = row.querySelector('[class*="UserChatListItem"]');
            if (!item) return;
            const key = Object.keys(item).find(k => k.startsWith('__reactFiber'));
            if (!key) return;
            let f = item[key];
            for (let i = 0; i < 25 && f; i++) {
                if (f.memoizedProps?.userChat?.id) {
                    rowMap.set(f.memoizedProps.userChat.id, row);
                    break;
                }
                f = f.return;
            }
        });
        
        const visibleSorted = sortedData.filter(chat => rowMap.has(chat.id));
        console.log('  📊', rowMap.size, '개 정렬');
        
        visibleSorted.forEach((chat, visualIndex) => {
            const row = rowMap.get(chat.id);
            if (row) {
                row.style.top = (visualIndex * rowHeight) + 'px';
            }
        });
        
        console.log('  ✅ 완료');
        
        setTimeout(() => { reordering = false; }, 100);
    }
    
    let scrollTimeout;
    document.addEventListener('scroll', (e) => {
        if (!isBookmark() || !sortedData) return;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!reordering) doReorder();
        }, 300);
    }, true);
    
    let wasBookmark = false;
    setInterval(() => {
        const nowBookmark = isBookmark();
        if (!wasBookmark && nowBookmark) {
            console.log('✅ 진입');
        }
        wasBookmark = nowBookmark;
    }, 300);
    
    console.log('✅ 준비');
})();