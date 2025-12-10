// ==UserScript==
// @name         ChannelTalk Bookmark Order Fix
// @namespace    http://channel.io/
// @version      1.4
// @description  채널톡 즐겨찾기 순서 바꾸는 스크립트 (3초 자동 새로고침)
// @author       윤도우리
// @match        https://desk.channel.io/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🚀 ChannelTalk Bookmark Order Fix v1.4');
    
    let sortedData = null;
    let reordering = false;
    let autoRefreshInterval = null;
    let isBookmarkPage = false; // API 호출로 확정된 북마크 페이지 여부
    
    function isBookmark() {
        // 1차: API로 확정된 경우
        if (isBookmarkPage) {
            // DOM에 UserChatListItem이 있는지만 확인
            const items = document.querySelectorAll('[class*="UserChatListItem"]');
            return items.length > 0;
        }
        
        // 2차: DOM 체크 ($bookmarkKey 확인)
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
    
    // 북마크 목록 강제 새로고침
    function refreshBookmarks() {
        if (!isBookmarkPage) return;
        
        console.log('🔄 자동 새로고침');
        
        const channelId = getChannelId();
        if (!channelId) return;
        
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `https://desk-api.channel.io/desk/channels/${channelId}/user-chats/bookmark?limit=500`);
        xhr.onload = function() {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.userChats) {
                    sortedData = [...data.userChats].sort((a, b) => 
                        (b.frontUpdatedAt || b.updatedAt) - (a.frontUpdatedAt || a.updatedAt)
                    );
                    console.log('  ✅ 업데이트:', sortedData.length, '개');
                    
                    setTimeout(() => doReorder(), 100);
                }
            } catch (e) {
                console.error('  ❌ 새로고침 실패:', e);
            }
        };
        xhr.send();
    }
    
    function getChannelId() {
        const match = window.location.pathname.match(/\/channels\/(\d+)/);
        return match ? match[1] : null;
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
            console.log('📡 API (북마크 확정)');
            isBookmarkPage = true; // 북마크 API 호출 = 북마크 페이지 확정
            
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
        } else if (this._url && this._url.includes('/user-chats/')) {
            // 다른 user-chats API 호출 = 북마크 아님
            if (isBookmarkPage) {
                console.log('📡 다른 API (북마크 페이지 종료)');
                isBookmarkPage = false;
            }
        }
        return xhrSend.apply(this, args);
    };
    
    function forceRenderAll() {
        if (!isBookmarkPage) return;
        
        const rows = document.querySelectorAll('[class*="RowWrapper"]');
        if (!rows.length) return;
        
        const container = rows[0].parentElement;
        if (!container) return;
        
        const rowHeight = rows[0].offsetHeight;
        const totalHeight = sortedData.length * rowHeight;
        
        container.style.height = totalHeight + 'px';
        container.style.minHeight = totalHeight + 'px';
        
        const parent0 = container.parentElement;
        if (parent0) {
            parent0.style.height = totalHeight + 'px';
            parent0.style.minHeight = totalHeight + 'px';
            
            const parent1 = parent0.parentElement;
            if (parent1) {
                parent1.style.height = totalHeight + 'px';
                parent1.style.minHeight = totalHeight + 'px';
                
                const parent2 = parent1.parentElement;
                if (parent2) {
                    parent2.style.overflow = 'auto';
                    parent2.style.overflowY = 'auto';
                    parent2.style.maxHeight = '100vh';
                }
            }
        }
        
        setTimeout(() => doReorder(), 1000);
        setTimeout(() => doReorder(), 2000);
        setTimeout(() => doReorder(), 3000);
    }
    
    function doReorder() {
        if (!sortedData || !isBookmarkPage || reordering) return;
        
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
        
        visibleSorted.forEach((chat, visualIndex) => {
            const row = rowMap.get(chat.id);
            if (row) {
                row.style.top = (visualIndex * rowHeight) + 'px';
            }
        });
        
        setTimeout(() => { reordering = false; }, 100);
    }
    
    let scrollTimeout;
    document.addEventListener('scroll', (e) => {
        if (!isBookmarkPage || !sortedData) return;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!reordering) doReorder();
        }, 300);
    }, true);
    
    // 북마크 페이지 감지 및 자동 새로고침 관리
    let wasBookmark = false;
    setInterval(() => {
        const nowBookmark = isBookmark();
        
        if (!wasBookmark && nowBookmark) {
            console.log('✅ 진입');
            // 자동 새로고침 시작
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            autoRefreshInterval = setInterval(() => {
                refreshBookmarks();
            }, 3000);
            console.log('⏰ 3초 자동 새로고침 시작');
        } else if (wasBookmark && !nowBookmark) {
            // 자동 새로고침 중지
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
                console.log('⏰ 자동 새로고침 중지');
            }
        }
        
        wasBookmark = nowBookmark;
    }, 300);
    
    console.log('✅ 준비');
})();
