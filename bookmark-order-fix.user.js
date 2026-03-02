// ==UserScript==
// @name         채널톡 즐겨찾기 시간순 정렬 v12
// @namespace    http://tampermonkey.net/
// @version      12.0
// @description  오버레이 방식 - 완전 자체 렌더링
// @author       Helper
// @match        https://desk.channel.io/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SORT_FIELD: 'frontUpdatedAt',
        DESC: true,
        ROW_HEIGHT: 72,
        DEBUG: false,
    };

    const log = (...args) => CONFIG.DEBUG && console.log('[BS12]', ...args);

    // ============================================================
    // 데이터 저장소
    // ============================================================
    const chatMap = new Map();     // chatId → { name, frontUpdatedAt, state, ... }
    const messageMap = new Map();  // chatId → { text, createdAt }
    const userMap = new Map();     // userId → { name, avatarUrl }
    const managerMap = new Map();  // managerId → { name, avatarUrl }
    const bookmarkSet = new Set(); // chatId set (북마크된 채팅)
    let channelId = '';
    let overlayEl = null;
    let isBookmarkPage = false;

    // ============================================================
    // XHR 인터셉트: 북마크 API 감지
    // ============================================================
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    let isBookmarkApiFlag = false;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._bsUrl = url || '';
        // channelId 추출
        const m = url.match(/channels\/(\d+)/);
        if (m) channelId = m[1];
        return nativeOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(body) {
        // 내부 요청 바이패스
        if (this._bsInternal) {
            return nativeSend.apply(this, arguments);
        }
        if (this._bsUrl.includes('/user-chats/bookmark')) {
            this.addEventListener('load', () => {
                isBookmarkApiFlag = true;
                setTimeout(() => { isBookmarkApiFlag = false; }, 300);
            });
        }
        return nativeSend.apply(this, arguments);
    };

    // ============================================================
    // JSON.parse: 데이터 캡처
    // ============================================================
    const _origParse = JSON.parse;

    JSON.parse = function(text, reviver) {
        const result = _origParse.call(this, text, reviver);
        if (!result || typeof result !== 'object') return result;

        // 북마크 API 응답 캡처
        if (isBookmarkApiFlag &&
            Array.isArray(result.userChats) && result.userChats.length > 0 &&
            Array.isArray(result.bookmarks) && result.bookmarks.length > 0) {

            isBookmarkApiFlag = false;

            // bookmarkSet 갱신
            bookmarkSet.clear();
            result.bookmarks.forEach(bm => {
                if (bm.chatId) bookmarkSet.add(bm.chatId);
            });

            // userChats 캡처
            result.userChats.forEach(chat => {
                chatMap.set(chat.id, {
                    id: chat.id,
                    name: chat.name || '',
                    frontUpdatedAt: chat.frontUpdatedAt || 0,
                    state: chat.state || '',
                    assigneeId: chat.assigneeId || '',
                    userId: chat.userId || '',
                });
            });

            // messages 캡처 (최신 메시지)
            if (Array.isArray(result.messages)) {
                result.messages.forEach(msg => {
                    const chatId = msg.chatId;
                    if (!chatId) return;
                    const existing = messageMap.get(chatId);
                    const createdAt = msg.createdAt || 0;
                    if (!existing || createdAt > existing.createdAt) {
                        messageMap.set(chatId, {
                            text: msg.plainText || msg.message || '',
                            createdAt,
                            personType: msg.personType || '',
                        });
                    }
                });
            }

            // users 캡처
            if (Array.isArray(result.users)) {
                result.users.forEach(u => {
                    userMap.set(u.id, {
                        name: u.name || u.profile?.name || '',
                        avatarUrl: u.avatarUrl || u.profile?.avatarUrl || '',
                    });
                });
            }

            // managers 캡처
            if (Array.isArray(result.managers)) {
                result.managers.forEach(m => {
                    managerMap.set(m.id, {
                        name: m.name || '',
                        avatarUrl: m.avatarUrl || '',
                    });
                });
            }

            log('📦 캡처 완료:', bookmarkSet.size, '건');
            isBookmarkPage = true;
            scheduleOverlay();

            // 전체 페이지 로드 트리거 (초기 25건 이후 나머지)
            setTimeout(refreshBookmarkData, 1000);
        }

        // 개별 채팅 업데이트도 캡처 (실시간 반영)
        if (Array.isArray(result.userChats)) {
            result.userChats.forEach(chat => {
                if (chat.id && bookmarkSet.has(chat.id)) {
                    const existing = chatMap.get(chat.id);
                    if (existing) {
                        existing.frontUpdatedAt = chat.frontUpdatedAt || existing.frontUpdatedAt;
                        existing.state = chat.state || existing.state;
                        existing.name = chat.name || existing.name;
                        if (chat.assigneeId) existing.assigneeId = chat.assigneeId;
                    }
                }
            });
            // managers 캡처
            if (Array.isArray(result.managers)) {
                result.managers.forEach(m => {
                    managerMap.set(m.id, { name: m.name || '', avatarUrl: m.avatarUrl || '' });
                });
            }
            // 메시지도 업데이트
            if (Array.isArray(result.messages)) {
                result.messages.forEach(msg => {
                    if (msg.chatId && bookmarkSet.has(msg.chatId)) {
                        const existing = messageMap.get(msg.chatId);
                        const createdAt = msg.createdAt || 0;
                        if (!existing || createdAt > existing.createdAt) {
                            messageMap.set(msg.chatId, {
                                text: msg.plainText || msg.message || '',
                                createdAt,
                                personType: msg.personType || '',
                            });
                        }
                    }
                });
            }

            // 오버레이 갱신
            if (isBookmarkPage && overlayEl) {
                updateOverlayData();
            }
        }

        return result;
    };
    JSON.parse.toString = () => 'function parse() { [native code] }';

    // ============================================================
    // 오버레이 생성
    // ============================================================
    function scheduleOverlay() {
        setTimeout(createOverlay, 500);
        setTimeout(createOverlay, 1000);
        setTimeout(createOverlay, 2000);
    }

    function createOverlay() {
        // 스크롤 컨테이너 찾기
        const scrollContainer = findScrollContainer();
        if (!scrollContainer) {
            log('⚠️ 스크롤 컨테이너 못 찾음');
            return;
        }
        if (overlayEl && overlayEl.parentElement === scrollContainer) {
            updateOverlayData();
            return;
        }

        log('🔧 오버레이 생성');

        // 원본 가상 스크롤 내용 숨기기
        const innerDiv = scrollContainer.firstElementChild;
        if (innerDiv) {
            innerDiv.style.display = 'none';
            innerDiv.dataset.bsHidden = '1';
        }

        // 오버레이 생성
        overlayEl = document.createElement('div');
        overlayEl.id = 'bs-overlay';
        overlayEl.style.cssText = 'width:100%;';
        scrollContainer.appendChild(overlayEl);

        updateOverlayData();

        // 원본 숨김 유지 (MutationObserver)
        const obs = new MutationObserver(() => {
            if (innerDiv && innerDiv.style.display !== 'none') {
                innerDiv.style.display = 'none';
            }
            // 네비게이션 변경 감지
            checkBookmarkPage();
        });
        obs.observe(scrollContainer, { childList: true, subtree: true });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    function updateOverlayData() {
        if (!overlayEl) return;

        const sorted = getSortedChats();
        const currentActive = getCurrentChatId();

        overlayEl.innerHTML = '';
        sorted.forEach((chat, i) => {
            const row = createRow(chat, i, chat.id === currentActive);
            overlayEl.appendChild(row);
        });
    }

    function getSortedChats() {
        const chats = [];
        bookmarkSet.forEach(chatId => {
            const data = chatMap.get(chatId);
            if (data) chats.push(data);
        });

        chats.sort((a, b) => {
            const aVal = a[CONFIG.SORT_FIELD] || 0;
            const bVal = b[CONFIG.SORT_FIELD] || 0;
            return CONFIG.DESC ? (bVal - aVal) : (aVal - bVal);
        });

        return chats;
    }

    // ============================================================
    // 행 렌더링
    // ============================================================
    function createRow(chat, index, isActive) {
        const msg = messageMap.get(chat.id);
        const timeStr = formatTime(chat.frontUpdatedAt);
        const msgText = msg ? truncate(msg.text, 40) : '';
        const assigneeName = chat.assigneeId ? (managerMap.get(chat.assigneeId)?.name || '') : '';

        const row = document.createElement('div');
        row.className = 'bs-row';
        row.dataset.chatId = chat.id;
        row.style.cssText = `
            display: flex;
            align-items: center;
            padding: 10px 12px;
            height: ${CONFIG.ROW_HEIGHT}px;
            box-sizing: border-box;
            cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            background: ${isActive ? 'rgba(255,255,255,0.06)' : 'transparent'};
            transition: background 0.15s;
        `;

        row.addEventListener('mouseenter', () => {
            if (!isActive) row.style.background = 'rgba(255,255,255,0.03)';
        });
        row.addEventListener('mouseleave', () => {
            if (!isActive) row.style.background = 'transparent';
        });

        // 상태 점: 고객=큰 빨간점, 봇/상담=작은 초록점
        const isCustomer = msg?.personType === 'user';
        const stateEl = document.createElement('div');
        stateEl.style.cssText = isCustomer
            ? 'width:12px;height:12px;border-radius:50%;background:#ef4444;flex-shrink:0;margin-right:12px;'
            : 'width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;margin-right:12px;';

        // 내용 영역
        const contentEl = document.createElement('div');
        contentEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

        // 1행: 이름 + 담당자 + 시간
        const headerEl = document.createElement('div');
        headerEl.style.cssText = 'display:flex;align-items:center;margin-bottom:4px;';

        const nameEl = document.createElement('span');
        nameEl.style.cssText = `
            font-size: 15px;
            font-weight: 600;
            color: rgba(255,255,255,0.85);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
        `;
        nameEl.textContent = chat.name;

        // 담당자 + 시간을 묶는 우측 영역
        const rightEl = document.createElement('div');
        rightEl.style.cssText = 'display:flex;align-items:center;flex-shrink:0;margin-left:6px;gap:12px;';

        if (assigneeName) {
            const assigneeEl = document.createElement('span');
            assigneeEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.65);white-space:nowrap;font-weight:700;';
            assigneeEl.textContent = assigneeName;
            rightEl.appendChild(assigneeEl);
        }

        const timeEl = document.createElement('span');
        timeEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.45);white-space:nowrap;';
        timeEl.textContent = timeStr;
        rightEl.appendChild(timeEl);

        headerEl.appendChild(nameEl);
        headerEl.appendChild(rightEl);

        // 2행: 메시지 미리보기
        const previewEl = document.createElement('div');
        previewEl.style.cssText = `
            font-size: 13.5px;
            color: rgba(255,255,255,0.95);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        previewEl.textContent = msgText;

        contentEl.appendChild(headerEl);
        contentEl.appendChild(previewEl);

        row.appendChild(stateEl);
        row.appendChild(contentEl);

        // 클릭 → 해시 라우팅
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.hash = `#/channels/${channelId}/user_chats/${chat.id}`;

            // 활성 상태 업데이트
            overlayEl.querySelectorAll('.bs-row').forEach(r => {
                r.style.background = 'transparent';
            });
            row.style.background = 'rgba(255,255,255,0.06)';
        });

        return row;
    }

    // ============================================================
    // 스크롤 컨테이너 찾기
    // ============================================================
    function findScrollContainer() {
        // 방법: 큰 높이의 absolute 자식을 가진 overflow:auto div
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            const cs = getComputedStyle(div);
            if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' &&
                cs.overflow !== 'auto' && cs.overflow !== 'scroll') continue;

            // 280px 폭의 스크롤 영역 (좌측 네비게이션)
            if (div.offsetWidth < 200 || div.offsetWidth > 400) continue;

            // 내부에 큰 높이의 자식이 있는지
            const inner = div.firstElementChild;
            if (!inner) continue;

            const innerStyle = inner.getAttribute('style') || '';
            const hm = innerStyle.match(/height:\s*(\d+)px/);
            if (!hm || parseInt(hm[1]) < 300) continue;

            // 북마크 데이터의 이름이 텍스트에 포함되어 있는지
            const names = [...chatMap.values()].map(c => c.name).filter(n => n);
            const text = div.textContent || '';
            const matchCount = names.filter(n => text.includes(n)).length;
            if (matchCount >= 2) {
                log('📍 스크롤 컨테이너 발견:', div.offsetWidth, 'x', div.offsetHeight, '매칭:', matchCount);
                return div;
            }
        }
        return null;
    }

    function getCurrentChatId() {
        const hash = window.location.hash;
        const m = hash.match(/user_chats\/([a-f0-9]+)/);
        return m ? m[1] : null;
    }

    function checkBookmarkPage() {
        // 북마크 페이지인지 확인 (간접적으로)
        // bookmark API가 호출된 후에만 오버레이 활성화
    }

    // ============================================================
    // 유틸
    // ============================================================
    function formatTime(ms) {
        if (!ms) return '';
        const now = Date.now();
        const diff = now - ms;
        const sec = Math.floor(diff / 1000);
        const min = Math.floor(sec / 60);
        const hour = Math.floor(min / 60);
        const day = Math.floor(hour / 24);

        if (sec < 60) return '방금';
        if (min < 60) return `${min}분 전`;
        if (hour < 24) return `${hour}시간 전`;
        if (day < 7) return `${day}일 전`;

        const d = new Date(ms);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    function truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    function getStateColor(state) {
        switch (state) {
            case 'opened': return '#3b82f6';
            case 'closed': return '#6b7280';
            case 'snoozed': return '#f59e0b';
            default: return '#6b7280';
        }
    }

    // ============================================================
    // 해시 변경 감지 → 활성 채팅 업데이트
    // ============================================================
    window.addEventListener('hashchange', () => {
        if (overlayEl) {
            const active = getCurrentChatId();
            overlayEl.querySelectorAll('.bs-row').forEach(row => {
                const isActive = row.dataset.chatId === active;
                row.style.background = isActive ? 'rgba(255,255,255,0.06)' : 'transparent';
            });
        }
    });

    // ============================================================
    // 백그라운드 자동 갱신: bookmark API 페이지네이션 전체 로드
    // ============================================================
    const rtDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');

    function fetchPage(cursor) {
        return new Promise((resolve, reject) => {
            const base = `https://desk-api.channel.io/desk/channels/${channelId}/user-chats/bookmark?limit=500`;
            const url = cursor ? `${base}&next=${encodeURIComponent(cursor)}` : base;
            const xhr = new XMLHttpRequest();
            xhr._bsInternal = true;
            nativeOpen.call(xhr, 'GET', url, true);
            xhr.withCredentials = true;
            xhr.onload = () => {
                try {
                    const text = rtDesc.get.call(xhr);
                    if (!text) { reject(new Error('빈 응답')); return; }
                    resolve(_origParse(text));
                } catch (e) {
                    log('❌ fetchPage 파싱 오류:', e, 'status:', xhr.status);
                    reject(e);
                }
            };
            xhr.onerror = () => {
                log('❌ fetchPage 네트워크 오류, status:', xhr.status);
                reject(new Error('XHR failed'));
            };
            nativeSend.call(xhr);
        });
    }

    let isRefreshing = false;

    async function refreshBookmarkData() {
        if (!channelId || !isBookmarkPage || isRefreshing) return;
        isRefreshing = true;
        log('🔄 갱신 시작...');

        try {
            const allChats = new Map();
            const allBookmarks = new Map();
            const allMessages = new Map();
            let allManagers = [];
            let nextCursor = null;
            let prevCursor = null;
            let page = 0;

            do {
                page++;
                const data = await fetchPage(nextCursor);
                if (!data?.userChats?.length) { log('⚠️ 페이지', page, '빈 응답'); break; }

                log(`  API 응답: chats=${data.userChats.length} bms=${data.bookmarks?.length || 0}`);

                let newCount = 0;
                data.userChats.forEach(c => { if (!allChats.has(c.id)) { allChats.set(c.id, c); newCount++; } });
                (data.bookmarks || []).forEach(bm => { if (bm.chatId && !allBookmarks.has(bm.chatId)) allBookmarks.set(bm.chatId, bm); });
                (data.messages || []).forEach(msg => {
                    const key = msg.chatId;
                    if (key) {
                        const existing = allMessages.get(key);
                        if (!existing || (msg.createdAt || 0) > existing.createdAt) allMessages.set(key, msg);
                    }
                });
                if (data.managers) allManagers = allManagers.concat(data.managers);

                log(`  페이지 ${page}: +${newCount}건 (총 ${allChats.size}건) next=${data.next ? data.next.substring(0, 30) + '...' : 'N'}`);

                prevCursor = nextCursor;
                nextCursor = data.next || null;

                if (nextCursor && nextCursor === prevCursor) { log('⚠️ 커서 반복 → 종료'); break; }
                if (newCount === 0 && page > 1) { log('⚠️ 새 항목 없음 → 종료, 커서:', nextCursor?.substring(0, 30)); break; }
            } while (nextCursor && page < 20);

            // 데이터 반영
            let changed = false;
            let changeLog = [];

            // bookmarkSet 갱신
            const newSet = new Set(allBookmarks.keys());
            if (newSet.size !== bookmarkSet.size || [...newSet].some(id => !bookmarkSet.has(id))) {
                bookmarkSet.clear();
                newSet.forEach(id => bookmarkSet.add(id));
                changed = true;
                changeLog.push(`북마크 수: ${newSet.size}`);
            }

            // userChats 갱신
            allChats.forEach((chat, id) => {
                const existing = chatMap.get(id);
                const newFront = chat.frontUpdatedAt || 0;
                if (!existing) {
                    chatMap.set(id, {
                        id: chat.id,
                        name: chat.name || '',
                        frontUpdatedAt: newFront,
                        state: chat.state || '',
                        assigneeId: chat.assigneeId || '',
                        userId: chat.userId || '',
                    });
                    changed = true;
                    changeLog.push(`새 채팅: ${chat.name}`);
                } else {
                    if (existing.frontUpdatedAt !== newFront) {
                        changeLog.push(`시간변경: ${chat.name} ${new Date(existing.frontUpdatedAt).toLocaleTimeString('ko-KR')} → ${new Date(newFront).toLocaleTimeString('ko-KR')}`);
                        existing.frontUpdatedAt = newFront;
                        changed = true;
                    }
                    if (chat.state && existing.state !== chat.state) { existing.state = chat.state; changed = true; changeLog.push(`상태변경: ${chat.name}`); }
                    if (chat.name && existing.name !== chat.name) { existing.name = chat.name; changed = true; }
                    if (chat.assigneeId && existing.assigneeId !== chat.assigneeId) { existing.assigneeId = chat.assigneeId; changed = true; changeLog.push(`담당변경: ${chat.name}`); }
                }
            });

            // messages 갱신
            allMessages.forEach((msg, chatId) => {
                const existing = messageMap.get(chatId);
                const createdAt = msg.createdAt || 0;
                if (!existing || createdAt > existing.createdAt) {
                    const chatName = chatMap.get(chatId)?.name || chatId;
                    changeLog.push(`메시지변경: ${chatName}`);
                    messageMap.set(chatId, {
                        text: msg.plainText || msg.message || '',
                        createdAt,
                        personType: msg.personType || '',
                    });
                    changed = true;
                }
            });

            // managers 갱신
            allManagers.forEach(m => {
                managerMap.set(m.id, { name: m.name || '', avatarUrl: m.avatarUrl || '' });
            });

            if (changed && overlayEl) {
                log(`🔄 자동 갱신 반영 (${allChats.size}건, ${page}페이지)`);
                changeLog.forEach(c => log(`  ✏️ ${c}`));
                updateOverlayData();
            } else if (!changed) {
                log('⏸️ 변경 없음');
            }
        } catch (e) {
            log('❌ 갱신 오류:', e);
        } finally {
            isRefreshing = false;
        }
    }

    // 3초마다 전체 갱신
    setInterval(refreshBookmarkData, 3000);

    log('✅ v12 로드 완료 (오버레이 방식)');
})();
