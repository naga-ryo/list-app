// ==========================================
// 1. Config & State Initialization
// ==========================================
const SUPABASE_URL = 'https://yjtpmjhrjqbimcjztait.supabase.co';
let dbClient = null;

// アプリケーション全体で利用するカテゴリの定義
const CATEGORIES = [
  { id: 'veg', name: '野菜系', icon: '🥦', colorClass: 'c-veg', hex: '#2ecc71', textColor: '#ffffff' },
  { id: 'fruit', name: '果物系', icon: '🍊', colorClass: 'c-fruit', hex: '#e67e22', textColor: '#ffffff' },
  { id: 'meat', name: '肉類', icon: '🥩', colorClass: 'c-meat', hex: '#e74c3c', textColor: '#ffffff' },
  { id: 'fish', name: '魚介', icon: '🐟', colorClass: 'c-fish', hex: '#3498db', textColor: '#ffffff' },
  { id: 'soy', name: '大豆製品', icon: '🫘', colorClass: 'c-soy', hex: '#a0522d', textColor: '#ffffff' },
  { id: 'egg_dairy', name: '卵・乳製品', icon: '🥚', colorClass: 'c-egg', hex: '#f1c40f', textColor: '#ffffff' },
  { id: 'grains', name: '穀類', icon: '🌾', colorClass: 'c-staple', hex: '#f39c12', textColor: '#ffffff' },
  { id: 'seasoning', name: '調味料', icon: '🧂', colorClass: 'c-seasoning', hex: '#9b59b6', textColor: '#ffffff' },
  { id: 'frozen', name: '冷凍食品', icon: '🧊', colorClass: 'c-frozen', hex: '#34495e', textColor: '#ffffff' },
  { id: 'processed', name: '加工食品', icon: '🥫', colorClass: 'c-processed', hex: '#1abc9c', textColor: '#ffffff' },
  { id: 'other', name: 'その他', icon: '🏷️', colorClass: 'c-other', hex: '#95a5a6', textColor: '#ffffff' }
];

// アプリケーションのグローバルな状態管理
let state = {
  supabaseKey: localStorage.getItem('app_supabase_key') || '', // セッション維持用Supabaseキー
  password: localStorage.getItem('app_password') || '',        // セッション維持用パスワード
  userName: '',                                         // 認証されたユーザー名
  items: [],                                            // 未購入のアイテム一覧
  historyItems: [],                                     // 購入済みのアイテム一覧
  currentCategory: null,                                // 現在選択中のカテゴリ('all', 'history', または各カテゴリ名)
  isEditMode: false,                                    // 複数選択用の編集モードフラグ
  selectedIds: new Set(),                               // 編集モードで選択されたアイテムIDの集合
  newQuantity: 1,                                       // 新規追加時の数量
  readItemIds: new Set(JSON.parse(localStorage.getItem('app_read_items')) || []), // 既読アイテムIDのキャッシュ
  isTransitioning: false,                               // データ取得・画面遷移中の状態フラグ
  isSwiping: false                                      // スワイプジェスチャー中の状態フラグ                                      
};

let syncInterval = null;

// ==========================================
// 2. Utils & Components
// ==========================================

/**
 * HTMLエンティティのエスケープ処理（XSS対策）
 * @param {string} str - ユーザー入力文字列
 * @returns {string} - サニタイズされた文字列
 */
const escapeHTML = (str) => {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, match => {
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return escapeMap[match];
  });
};

/**
 * 画面上部に短時間表示されるトースト通知
 * @param {string} msg - 表示するメッセージ
 * @param {string} [type='success'] - 'success' または 'error'
 */
let toastTimeout = null;
const showToast = (msg, type = 'success') => {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  if (toastTimeout) clearTimeout(toastTimeout); // 前のタイマーをキャンセル
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2500);
};

/**
 * カスタムアラートモーダル（ブラウザ標準alertの代替）
 * @param {string} message - 表示するエラーメッセージ
 * @returns {Promise<void>} - OKボタン押下時に解決されるPromise
 */
window.showAlert = (message) => {
  return new Promise(resolve => {
    // 背景オーバーレイの作成
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; padding: 20px;`;
    
    // ダイアログ本体の作成
    const box = document.createElement('div');
    box.style.cssText = `background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px); transition: transform 0.2s; box-shadow: 0 10px 25px rgba(0,0,0,0.2);`;
    
    box.innerHTML = `
      <h3 style="color: var(--danger); font-size: 1.1rem; margin-bottom: 16px;">⚠️ 警告</h3>
      <p style="margin-bottom: 24px; font-size: 0.95rem; color: var(--text-main); line-height: 1.5;">${message}</p>
    `;

    const btn = document.createElement('button');
    btn.textContent = 'OK';
    btn.className = 'primary-btn';
    btn.style.width = '100%';
    btn.onclick = () => {
      overlay.style.opacity = '0';
      setTimeout(() => { document.body.removeChild(overlay); resolve(); }, 200);
    };

    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // アニメーション発火
    requestAnimationFrame(() => { 
      overlay.style.opacity = '1'; 
      box.style.transform = 'translateY(0)'; 
    });
  });
};

/**
 * 認証情報（パスワード）を自動付与してRPCを呼び出す共通ラッパー
 * @param {string} fnName - SupabaseのRPC関数名
 * @param {Object} [params={}] - 渡すパラメータ
 */

// オフライン閲覧モードかどうかを判定・警告する安全装置 
const checkOffline = async () => {
  if (state.userName === 'オフライン(閲覧のみ)') {
    await window.showAlert('現在オフラインのため、この操作はできません。<br>電波の良い場所でアプリを再起動してください。');
    return true;
  }
  return false;
};

const rpc = async (fnName, params = {}) => {
  if (!dbClient) throw new Error('Database client is not initialized.');
  
  params.p_pass = state.password;
  const { data, error } = await dbClient.rpc(fnName, params);
  
  if (error) {
    if (error.message.includes('Unauthorized')) {
      logout();
      showToast('認証セッションが切れました', 'error');
      throw new Error('Unauthorized');
    }
    showToast('処理に失敗しました', 'error');
    throw error;
  }
  return data;
};

/**
 * 日付文字列を「今日」「昨日」「○日前」などの相対表現にフォーマットする
 * @param {string} isoString - ISO形式の日付文字列
 * @returns {string} - フォーマットされた文字列
 */
const formatDate = (isoString) => {
  if (!isoString) return 'なし';
  const targetDate = new Date(isoString);
  const now = new Date();
  
  const targetZero = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((todayZero - targetZero) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return '今日';
  if (diffDays === 1) return '昨日';
  if (diffDays > 1 && diffDays < 7) return `${diffDays}日前`;
  return `${targetDate.getMonth() + 1}/${targetDate.getDate()}`;
};

/** 既読状態のローカル保存 */
const saveReadItems = () => {
  localStorage.setItem('app_read_items', JSON.stringify(Array.from(state.readItemIds)));
};

// ==========================================
// 3. Data Fetching & Rendering
// ==========================================

/**
 * データベースから最新のアイテム情報を取得し状態を更新する
 * @param {boolean} [isSilent=false] - 背景での定期更新かどうかのフラグ
 */
const fetchItems = async (isSilent = false) => {
  if (state.userName === 'オフライン(閲覧のみ)' || !state.userName || !dbClient) {
    // オフライン時に画面遷移した際、スケルトン表示を解除してキャッシュを描画
    if (state.isTransitioning) {
      state.isTransitioning = false;
      render();
    }
    return;
  }
  
  try {
    const itemsData = await rpc('get_items');
    state.items = itemsData || [];
    localStorage.setItem('app_cached_items', JSON.stringify(state.items)); // 取得成功時にバックアップを保存
    
    // 履歴画面を開いている場合は履歴データも取得
    if (state.currentCategory === 'history') {
      const historyData = await rpc('get_purchased_items');
      state.historyItems = historyData || [];
      localStorage.setItem('app_cached_history', JSON.stringify(state.historyItems.slice(0, 100)));  // 履歴もバックアップ
    }

    // 現在表示中のカテゴリ内のアイテムを既読状態に更新
    if (state.currentCategory && state.currentCategory !== 'history') {
      const currentItems = state.items.filter(i => i.category === state.currentCategory);
      currentItems.forEach(item => state.readItemIds.add(String(item.id)));
      saveReadItems();
    }

    const hasOpenDialog = document.querySelector('div[style*="z-index: 10000"]') !== null;
    state.isTransitioning = false;

    // ユーザー操作と競合しない場合のみDOMを再描画
    if (!state.isEditMode && !state.isSwiping && !hasOpenDialog) {
      render();
    }
  } catch (e) {
    console.error('Fetch error:', e);
    
    try {
      const cachedItems = localStorage.getItem('app_cached_items');
      if (cachedItems) state.items = JSON.parse(cachedItems);
      
      const cachedHistory = localStorage.getItem('app_cached_history');
      if (cachedHistory) state.historyItems = JSON.parse(cachedHistory);
    } catch (parseError) {
      console.error('Cache parse error:', parseError);
      state.items = [];
      state.historyItems = [];
    }

    const hasOpenDialog = document.querySelector('div[style*="z-index: 10000"]') !== null;
    state.isTransitioning = false;
    
    if (!state.isEditMode && !state.isSwiping && !hasOpenDialog) {
      render();
    }
  }
};

/** 定期同期の開始処理 */
const startSync = () => {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => fetchItems(true), 15000); 
};

/**
 * 画面のルーティング制御（表示するビューの切り替え）
 */
const render = () => {
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  
  if (!state.userName) {
    document.getElementById('login-view').classList.remove('hidden');
    return;
  }
  
  if (!state.currentCategory) {
    renderCategoryList();
  } else {
    renderItemList();
  }
};

/**
 * トップ画面（カテゴリ一覧）の描画
 */
const renderCategoryList = () => {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--dynamic-header-bg', 'var(--surface)');
  rootStyle.setProperty('--dynamic-header-text', 'var(--text-main)');

  document.getElementById('main-view').classList.remove('hidden');
  document.getElementById('user-badge').textContent = `ログイン中: ${state.userName}`;
  
  const container = document.getElementById('category-list');
  const scrollTop = container.scrollTop;
  container.innerHTML = '';

  const totalItemsCount = state.items.length;
  const hasAnyUnread = state.items.some(item => 
    !state.readItemIds.has(String(item.id)) && item.created_by !== state.userName
  );
  const allUnreadBadge = hasAnyUnread ? `<span class="unread-badge">New!</span>` : '';

  // --------------------------------------------------
  // 「すべての品物」セルの生成
  // --------------------------------------------------
  const allDiv = document.createElement('div');
  allDiv.className = 'list-item';
  allDiv.style.border = '2px solid var(--text-main)';
  
  allDiv.onclick = () => {
    state.items.forEach(item => state.readItemIds.add(String(item.id)));
    saveReadItems();
    state.currentCategory = 'all'; 
    state.isEditMode = false;
    state.selectedIds.clear();

    history.pushState({ page: 'detail' }, '', '');
    
    state.isTransitioning = true;
    render(); 
    fetchItems(true);
  };
  
  allDiv.innerHTML = `
    <div class="info">
      <h3><span>📋</span> すべての品物 ${allUnreadBadge}</h3>
      <p>全カテゴリの合算</p>
    </div>
    <div class="count" style="background-color: var(--text-main); opacity: ${totalItemsCount > 0 ? 1 : 0.4}">
      ${totalItemsCount}
    </div>
  `;
  container.appendChild(allDiv);

  // --------------------------------------------------
  // 各カテゴリセルの生成
  // --------------------------------------------------
  // アイテム数が多い順にカテゴリをソート
  const sortedCategories = CATEGORIES.map(cat => {
    const catItems = state.items.filter(i => i.category === cat.name);
    return { ...cat, catItems, count: catItems.length };
  }).sort((a, b) => b.count - a.count);

  sortedCategories.forEach(cat => {
    const catItems = cat.catItems;
    const hasItems = cat.count > 0;
    const lastItem = hasItems ? catItems[catItems.length - 1] : null;
    const timeDisplay = lastItem ? formatDate(lastItem.created_at) : 'なし';
    
    const hasUnread = catItems.some(item => 
      !state.readItemIds.has(String(item.id)) && item.created_by !== state.userName
    );

    const unreadBadge = hasUnread ? `<span class="unread-badge">New!</span>` : '';
    
    const div = document.createElement('div');
    div.className = 'list-item';
    div.onclick = () => {
      catItems.forEach(item => state.readItemIds.add(String(item.id)));
      saveReadItems();
      state.currentCategory = cat.name;
      state.isEditMode = false;
      state.selectedIds.clear();

      history.pushState({ page: 'detail' }, '', '');

      state.isTransitioning = true;
      render(); 
      fetchItems(true);
    };
    
    div.innerHTML = `
      <div class="info">
        <h3><span>${cat.icon}</span> ${cat.name} ${unreadBadge}</h3>
        <p>最終追加: ${timeDisplay}</p>
      </div>
      <div class="count" style="background-color: ${cat.hex}; opacity: ${hasItems ? 1 : 0.4}">
        ${cat.count}
      </div>
    `;
    container.appendChild(div);
  });
  
  // --------------------------------------------------
  // ローカルストレージの不要な既読IDをクリーンアップ
  // --------------------------------------------------
  const currentItemIds = new Set(state.items.map(i => String(i.id)));
  let isCleaned = false;
  state.readItemIds.forEach(id => {
    if (!currentItemIds.has(id)) {
      state.readItemIds.delete(id);
      isCleaned = true;
    }
  });
  if (isCleaned) saveReadItems();

  container.scrollTop = scrollTop;
};

/**
 * 詳細画面（個別の品物リスト）の描画
 */
const renderItemList = () => {
  const isHistory = state.currentCategory === 'history';
  const isAll = state.currentCategory === 'all';
  
  const catObj = CATEGORIES.find(c => c.name === state.currentCategory);
  const rootStyle = document.documentElement.style;
  const addBtn = document.getElementById('add-btn');

  // カテゴリに応じたヘッダーカラーの動的適用
  if (!isHistory && !isAll && catObj) {
    rootStyle.setProperty('--dynamic-header-bg', catObj.hex);
    rootStyle.setProperty('--dynamic-header-text', catObj.textColor);
    addBtn.style.backgroundColor = catObj.hex;
    addBtn.style.color = catObj.textColor;
  } else {
    rootStyle.setProperty('--dynamic-header-bg', 'var(--surface)');
    rootStyle.setProperty('--dynamic-header-text', 'var(--text-main)');
    addBtn.style.backgroundColor = 'var(--accent)';
    addBtn.style.color = '#ffffff';
  }

  document.getElementById('detail-view').classList.remove('hidden');
  const container = document.getElementById('item-list');
  const scrollTop = container.scrollTop;
  
  // ヘッダータイトルの設定
  if (isHistory) document.getElementById('detail-title').textContent = '購入履歴';
  else if (isAll) document.getElementById('detail-title').textContent = 'すべての品物';
  else document.getElementById('detail-title').textContent = state.currentCategory;
  
  const editBtn = document.getElementById('edit-mode-btn');
  const addForm = document.getElementById('add-form');
  const editActions = document.getElementById('edit-actions');

  // 表示モードに応じたUI制御（履歴画面では編集・追加を非表示）
  if (isHistory) {
    editBtn.classList.add('hidden');
    addForm.classList.add('hidden');
    state.isEditMode = false;
  } else if (isAll) {
    editBtn.classList.remove('hidden');
    addForm.classList.add('hidden');
  } else {
    editBtn.classList.remove('hidden');
    addForm.classList.toggle('hidden', state.isEditMode);
  }

  editActions.classList.toggle('hidden', !state.isEditMode);
  editBtn.textContent = state.isEditMode ? '完了' : '編集';

  // --------------------------------------------------
  // 読み込み中（通信中）のスケルトンUI表示
  // --------------------------------------------------
  if (state.isTransitioning) {
    container.innerHTML = `
      <div class="skeleton-item"><div class="skeleton-content"><div class="skeleton-text"></div><div class="skeleton-text short"></div></div></div>
      <div class="skeleton-item"><div class="skeleton-content"><div class="skeleton-text"></div><div class="skeleton-text short"></div></div></div>
      <div class="skeleton-item"><div class="skeleton-content"><div class="skeleton-text"></div><div class="skeleton-text short"></div></div></div>
    `;
    return; 
  }

  container.innerHTML = '';
  
  // 履歴画面用の「予定なく追加」ボタン
  if (isHistory) {
    const historyAddBtn = document.createElement('button');
    historyAddBtn.className = 'history-add-btn';
    historyAddBtn.innerHTML = '➕ 予定なく買ったものを追加';
    historyAddBtn.onclick = () => window.showDirectAddPrompt();
    container.appendChild(historyAddBtn);
  }
  // --------------------------------------------------
  // 表示対象データの抽出とソート処理
  // --------------------------------------------------
  let targetItems;
  if (isHistory) {
    targetItems = [...state.historyItems].sort((a, b) => {
      const dateA = new Date(a.purchased_at || 0).setHours(0, 0, 0, 0);
      const dateB = new Date(b.purchased_at || 0).setHours(0, 0, 0, 0);
      if (dateB !== dateA) return dateB - dateA;
      // 同日の場合はカテゴリ順でソート
      const indexA = CATEGORIES.findIndex(c => c.name === a.category);
      const indexB = CATEGORIES.findIndex(c => c.name === b.category);
      return indexA - indexB;
    });
  } else if (isAll) {
    targetItems = [...state.items].sort((a, b) => {
      const indexA = CATEGORIES.findIndex(c => c.name === a.category);
      const indexB = CATEGORIES.findIndex(c => c.name === b.category);
      return indexA - indexB;
    });
  } else {
    targetItems = state.items.filter(i => i.category === state.currentCategory);
  }

  if (targetItems.length === 0) {
    const msg = isHistory ? '購入済みの品物はありません' : '品物はありません';
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'text-align:center; padding:40px; color:var(--text-sub); font-size:0.95rem;';
    emptyMsg.textContent = msg;
    container.appendChild(emptyMsg);
    return;
  }

  let lastCategory = null;
  let lastDate = null;

  // --------------------------------------------------
  // リストアイテムのDOM構築
  // --------------------------------------------------
  targetItems.forEach(item => {
    // 履歴画面の日付区切り線の挿入
    if (isHistory && item.purchased_at) {
      const d = new Date(item.purchased_at);
      const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        const divider = document.createElement('div');
        divider.style = 'padding: 16px 8px 8px; font-weight: bold; border-bottom: 2px dashed var(--border); margin-bottom: 10px; color: var(--text-main); font-size: 0.9rem;';
        divider.innerHTML = `🗓️ ${dateStr}`;
        container.appendChild(divider);
      }
    }

    // 「すべての品物」画面のカテゴリ区切り線の挿入
    if (isAll && item.category !== lastCategory) {
      lastCategory = item.category;
      const cObj = CATEGORIES.find(c => c.name === item.category);
      const divider = document.createElement('div');
      divider.style = 'padding: 14px 4px 6px 4px; font-size: 0.85rem; font-weight: bold; color: var(--text-main); display: flex; align-items: center; gap: 6px;';
      divider.innerHTML = `<span>${cObj ? cObj.icon : '🏷️'}</span> ${item.category}`;
      container.appendChild(divider);
    }

    const div = document.createElement('div');
    const isSwipeable = !isHistory && !state.isEditMode;
    div.className = isSwipeable ? 'swipe-container' : 'detail-row';
    
    // チェックボックスの生成（編集モード時）
    let checkboxHtml = '';
    if (state.isEditMode) {
      const isChecked = state.selectedIds.has(String(item.id)) ? 'checked' : '';
      checkboxHtml = `<input type="checkbox" value="${item.id}" ${isChecked} onchange="toggleSelect('${item.id}', this.checked)">`;
    }

    const catObj = CATEGORIES.find(c => c.name === item.category);
    const badgeColor = catObj ? catObj.hex : '#95a5a6';
    const categoryBadge = (isAll || isHistory) ? `<span style="font-size: 0.7rem; background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 20px; margin-left: 8px; font-weight: bold; vertical-align: middle;">${item.category}</span>` : '';
    
    // メモバッジの生成
    const hasMemo = item.memo && item.memo.trim().length > 0;
    let memoBadge = '';
    
    if (isHistory) {
      memoBadge = hasMemo
        ? `<span class="memo-badge" onclick="event.stopPropagation(); window.openMemoModal('${item.id}')">💬 メモを確認</span>`
        : `<span class="memo-badge" style="background: var(--border); color: var(--text-sub); border: none; cursor: default;" onclick="event.stopPropagation();">📝 メモなし</span>`;
    } else {
      memoBadge = hasMemo
        ? `<span class="memo-badge" onclick="event.stopPropagation(); window.openMemoModal('${item.id}')">💬 メモを確認</span>`
        : `<span class="memo-badge empty" onclick="event.stopPropagation(); window.openMemoModal('${item.id}', true)">➕ メモを追加</span>`;
    }

    // アイテム情報部分の生成
    let historyInfoHtml = '';
    if (isHistory) {
      const buyer = escapeHTML(item.purchased_by) || '不明'; 
      let priceHtml = '';
      
      // 金額未入力時のアクションリンク生成
      if (item.price != null && item.price !== '') {
        priceHtml = `${item.price}円`;
      } else {
        priceHtml = `<span class="add-price-link" onclick="window.addPriceToHistory('${item.id}', event)">クリックして記入</span>`;
      }

      historyInfoHtml = `
        <div style="font-size: 0.8rem; color: var(--text-sub); margin-top: 4px; display: flex; align-items: center; gap: 8px;">
          <span>購入: ${buyer} / 金額: ${priceHtml}</span>
          <button class="repeat-btn" onclick="repeatItem('${item.id}', event)" title="もう一度買う">🔄</button>
        </div>
      `;
    } else {
      const createdTimeStr = formatDate(item.created_at);
      historyInfoHtml = `
        <p style="font-size: 0.8rem; color: var(--text-sub); margin-top: 4px;">追加: ${escapeHTML(item.created_by)} (${createdTimeStr})</p>
      `;
    }

    const innerContent = `
      ${checkboxHtml}
      <div class="detail-info" onclick="${state.isEditMode ? `document.querySelector('input[value=\"${item.id}\"]').click()` : ''}">
        <h4>${escapeHTML(item.item_name)} ${categoryBadge}</h4>
        <div style="margin-top: 6px;">${memoBadge}</div>
        ${historyInfoHtml}
      </div>
      <div class="detail-qty">×${item.quantity}</div>
    `;

    // スワイプ機能のバインド
    if (isSwipeable) {
      div.innerHTML = `<div class="swipe-bg-label"></div><div class="swipe-content detail-row">${innerContent}</div>`;
      setupSwipe(div, item);
    } else {
      div.innerHTML = innerContent;
    }

    container.appendChild(div);
  });

  container.scrollTop = scrollTop;
  updateSelectCount();
};

// ==========================================
// 4. Modals & Prompts
// ==========================================

/**
 * 汎用の確認モーダル（金額入力オプション付き）
 * @param {string} message - 表示するメッセージ
 * @param {Object} options - モーダルのオプション { isDanger: boolean, withPrice: boolean }
 * @returns {Promise<boolean|Object>} 
 */
window.showConfirm = (message, options = {}) => {
  return new Promise((resolve) => {
    const isDanger = typeof options === 'boolean' ? options : (options.isDanger || false);
    const withPrice = typeof options === 'boolean' ? false : (options.withPrice || false);

    // 背景オーバーレイ生成
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.5); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s ease;
    `;

    // モーダルコンテナ生成
    const box = document.createElement('div');
    box.style.cssText = `
      background: var(--surface, #ffffff); padding: 24px; border-radius: 12px;
      width: 80%; max-width: 320px; text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transform: scale(0.9); transition: transform 0.2s ease;
    `;

    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = `margin-bottom: 24px; font-weight: bold; color: var(--text-main, #333); line-height: 1.5; white-space: pre-wrap;`;
    msgDiv.textContent = message;
    box.appendChild(msgDiv);

    // 金額入力フィールド（オプション時のみ追加）
    let inputField = null;
    if (withPrice) {
      inputField = document.createElement('input');
      inputField.type = 'tel';
      inputField.placeholder = '金額を入力...（任意）';
      inputField.style.cssText = `width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 1.1rem; text-align: center; outline: none; background: #f8fafc;`;
      box.appendChild(inputField);

      // 税抜計算用チェックボックス
      const taxLabel = document.createElement('label');
      taxLabel.style.cssText = `display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.9rem; color: var(--text-main); margin-bottom: 20px; cursor: pointer;`;
      taxLabel.innerHTML = `<input type="checkbox" id="confirm-tax-chk" style="transform: scale(1.2); accent-color: var(--accent);"> 税抜 (8%加算)`;
      box.appendChild(taxLabel);
    }
    // アクションボタン生成
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `display: flex; gap: 12px; justify-content: center;`;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = `
      padding: 12px 0; border: none; border-radius: 8px; width: 50%;
      background: var(--border, #e0e0e0); color: var(--text-main, #333); font-weight: bold; cursor: pointer;
    `;

    const okColor = isDanger ? 'var(--danger, #e74c3c)' : 'var(--accent, #2ecc71)';
    const okBtn = document.createElement('button');
    okBtn.textContent = isDanger ? '削除' : 'OK';
    okBtn.style.cssText = `
      padding: 12px 0; border: none; border-radius: 8px; width: 50%;
      background: ${okColor}; color: #fff; font-weight: bold; cursor: pointer;
    `;

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(okBtn);
    box.appendChild(btnContainer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      box.style.transform = 'scale(1)';
      if (inputField) inputField.focus();
    });

    const closeAndResolve = (result) => {
      overlay.style.opacity = '0';
      box.style.transform = 'scale(0.9)';
      setTimeout(() => document.body.removeChild(overlay), 200);
      resolve(result);
    };

    okBtn.onclick = async () => {
      if (withPrice) {
        const val = inputField.value.trim();
        // 入力値が数値かどうかのバリデーション
        if (val !== '' && !/^[0-9]+$/.test(val)) {
          await window.showAlert('数字以外のものが入力されています。<br>半角数字のみで入力してください。');
          return; 
        }
        
        let priceVal = val !== '' ? parseInt(val, 10) : null;
        if (priceVal !== null && document.getElementById('confirm-tax-chk')?.checked) {
          priceVal = Math.floor(priceVal * 1.08);
        }
        closeAndResolve({ confirmed: true, price: priceVal });
      } else {
        closeAndResolve(true);
      }
    };
    
    cancelBtn.onclick = () => closeAndResolve(withPrice ? { confirmed: false } : false);
  });
};

/**
 * 複数アイテム同時購入用の個別金額入力モーダル
 * @param {Array} items - 選択されたアイテム配列
 * @returns {Promise<Object|null>} - { itemId: price } のマッピングオブジェクト
 */
window.showMultiPurchasePrompt = (items) => {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; padding: 20px;`;
    
    // 最初の確認画面
    const mainBox = document.createElement('div');
    mainBox.style.cssText = `background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px); transition: transform 0.2s; box-shadow: 0 10px 25px rgba(0,0,0,0.2);`;
    mainBox.innerHTML = `<p style="margin-bottom: 24px; font-weight: bold; font-size: 0.95rem;">選択した品物を購入済みにしますか？</p>`;

    const mainBtnContainer = document.createElement('div');
    mainBtnContainer.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル'; 
    cancelBtn.className = 'secondary-btn'; 
    cancelBtn.style.flex = '1';

    const priceBtn = document.createElement('button');
    priceBtn.textContent = '各金額を入力 (任意)'; 
    priceBtn.className = 'secondary-btn'; 
    priceBtn.style.width = '100%'; 
    priceBtn.style.order = '-1'; 
    priceBtn.style.marginBottom = '4px';

    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK'; 
    okBtn.className = 'primary-btn'; 
    okBtn.style.flex = '1';

    mainBtnContainer.append(priceBtn, cancelBtn, okBtn);
    mainBox.appendChild(mainBtnContainer);

    // 個別金額入力用の画面
    const priceBox = document.createElement('div');
    priceBox.style.cssText = `display: none; background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px); transition: transform 0.2s; box-shadow: 0 10px 25px rgba(0,0,0,0.2);`;
    
    const taxLabelHtml = `<label style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 0.9rem; color: var(--text-main); margin-bottom: 16px; cursor: pointer;">
      <input type="checkbox" id="multi-tax-chk" style="transform: scale(1.2); accent-color: var(--accent);"> すべて税抜 (8%加算)
    </label>`;

    const listHtml = items.map(item => `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; text-align: left;">
        <span style="font-size: 0.9rem; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; font-weight:bold;">${escapeHTML(item.item_name)}</span>
        <input type="tel" id="price-input-${item.id}" placeholder="---" style="width: 80px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; text-align: right; outline: none; font-size: 16px;">
        <span style="font-size:0.9rem; margin-left:4px; font-weight:bold;">円</span>
      </div>
    `).join('');

    priceBox.innerHTML = `<h3 style="margin-bottom: 16px;">💰 各金額を入力</h3>${taxLabelHtml}<div style="max-height: 40vh; overflow-y: auto; margin-bottom: 16px; padding-right: 4px;">${listHtml}</div>`;

    const backBtn = document.createElement('button');
    backBtn.textContent = '確認画面に戻る';
    backBtn.className = 'primary-btn';
    backBtn.style.width = '100%';
    priceBox.appendChild(backBtn);

    overlay.append(mainBox, priceBox);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      mainBox.style.transform = 'translateY(0)';
      priceBox.style.transform = 'translateY(0)';
    });

    const close = (result) => {
      overlay.style.opacity = '0';
      setTimeout(() => document.body.removeChild(overlay), 200);
      resolve(result);
    };

    cancelBtn.onclick = () => close(null);

    priceBtn.onclick = () => {
      mainBox.style.display = 'none';
      priceBox.style.display = 'block';
    };

    backBtn.onclick = async () => {
      // 画面切り替え前のバリデーション
      for (const item of items) {
        const val = document.getElementById(`price-input-${item.id}`).value.trim();
        if (val !== '' && !/^[0-9]+$/.test(val)) {
          await window.showAlert('数字以外のものが入力されています。<br>半角数字のみで入力してください。');
          return;
        }
      }
      priceBox.style.display = 'none';
      mainBox.style.display = 'block';
    };

    okBtn.onclick = () => {
      const priceMap = {};
      const isTaxExclude = document.getElementById('multi-tax-chk')?.checked;

      items.forEach(item => {
        const val = document.getElementById(`price-input-${item.id}`).value.trim();
        if (val !== '') {
          let pVal = parseInt(val, 10);
          if (isTaxExclude) pVal = Math.floor(pVal * 1.08);
          priceMap[item.id] = pVal;
        }
      });
      close(priceMap);
    };
  });
};

/**
 * 思いつきで購入したものを履歴に直接追加する専用モーダル
 * @returns {Promise<boolean|null>} 
 */
window.showDirectAddPrompt = async () => {
  if (await checkOffline()) return null; // ガード

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s ease; padding: 20px;`;
    
    const box = document.createElement('div');
    box.style.cssText = `background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); transform: translateY(20px); transition: transform 0.2s ease;`;

    const catOptions = CATEGORIES.map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');

    box.innerHTML = `
      <h3 style="margin-bottom: 16px; text-align: center;">🛒 買ったものを直接追加</h3>
      <input type="text" id="direct-name" placeholder="品名 (必須)" style="width:100%; padding:12px; margin-bottom:12px; border-radius:8px; border:1px solid var(--border); outline:none; font-size: 1rem;">
      <select id="direct-category" style="width:100%; padding:12px; margin-bottom:12px; border-radius:8px; border:1px solid var(--border); outline:none; background:#f8fafc; font-size: 1rem; color: var(--text-main);">
        ${catOptions}
      </select>
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <input type="tel" id="direct-price" placeholder="金額 (任意)" style="flex:1; padding:12px; border-radius:8px; border:1px solid var(--border); outline:none; text-align:right; font-size: 1rem;">
        <span style="display:flex; align-items:center; font-weight:bold;">円</span>
      </div>
      <label style="display:flex; justify-content:flex-end; align-items:center; gap:8px; font-size:0.9rem; margin-bottom:16px; cursor:pointer;">
        <input type="checkbox" id="direct-tax-chk" style="transform: scale(1.2); accent-color: var(--accent);"> 税抜 (8%加算)
      </label>
      <input type="text" id="direct-memo" placeholder="メモ (任意)" style="width:100%; padding:12px; margin-bottom:24px; border-radius:8px; border:1px solid var(--border); outline:none; font-size: 1rem;">
      <div style="display:flex; gap:12px;">
        <button id="direct-cancel" class="secondary-btn" style="flex:1; padding:12px 0;">キャンセル</button>
        <button id="direct-ok" class="primary-btn" style="flex:1; padding:12px 0;">追加</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      box.style.transform = 'translateY(0)';
      document.getElementById('direct-name').focus();
    });

    const closeAndResolve = (res) => {
      overlay.style.opacity = '0';
      box.style.transform = 'translateY(20px)';
      setTimeout(() => {
        document.body.removeChild(overlay);
        resolve(res);
      }, 200);
    };

    document.getElementById('direct-cancel').onclick = () => closeAndResolve(null);

    document.getElementById('direct-ok').onclick = async () => {
      const name = document.getElementById('direct-name').value.trim();
      if (!name) {
        await window.showAlert('品名を入力してください。');
        return;
      }
      const cat = document.getElementById('direct-category').value;
      const memo = document.getElementById('direct-memo').value.trim() || null;
      const priceStr = document.getElementById('direct-price').value.trim();
      let price = null;
      
      if (priceStr) {
        if (!/^[0-9]+$/.test(priceStr)) {
          await window.showAlert('金額は半角数字のみで入力してください。');
          return;
        }
        price = parseInt(priceStr, 10);
        if (document.getElementById('direct-tax-chk').checked) {
          price = Math.floor(price * 1.08);
        }
      }

      const okBtn = document.getElementById('direct-ok');
      okBtn.disabled = true;
      okBtn.textContent = '追加中...';

      try {
        // 未購入アイテムとして一度追加
        await rpc('add_item', { p_item_name: name, p_category: cat, p_quantity: 1, p_memo: memo, p_price: price });
        
        // 最新のアイテムを取得してIDを特定し、購入済みステータスに変更
        const unpurchased = await rpc('get_items');
        const addedItem = unpurchased.reverse().find(i => i.item_name === name && i.category === cat);

        if (addedItem) {
          await rpc('mark_as_purchased', { p_item_ids: [addedItem.id] });
        }

        showToast('履歴に追加しました！');
        fetchItems(true);
        closeAndResolve(true);
      } catch (e) {
        console.error('Direct add failed:', e);
        await window.showAlert('追加に失敗しました。');
        okBtn.disabled = false;
        okBtn.textContent = '追加';
      }
    };
  });
};

/**
 * メモの表示・追記用モーダル
 * @param {string} itemId - 対象アイテムのID
 * @param {boolean} directEdit - 開いた直後に編集画面に遷移するかどうか
 */
window.openMemoModal = (itemId, directEdit = false) => {
  const isHistory = state.currentCategory === 'history';
  const item = (isHistory ? state.historyItems : state.items).find(i => i.id === itemId);
  if (!item) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.5); z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s ease; padding: 20px;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background: var(--surface, #ffffff); padding: 20px; border-radius: 16px;
    width: 100%; max-width: 360px; display: flex; flex-direction: column;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    transform: translateY(20px); transition: transform 0.2s ease;
  `;

  const hasMemo = item.memo && item.memo.trim().length > 0;

  // メモ閲覧用コンテナ
  const viewContainer = document.createElement('div');
  viewContainer.style.cssText = `display: ${directEdit ? 'none' : 'flex'}; flex-direction: column; gap: 16px;`;

  const viewTitle = document.createElement('h3');
  viewTitle.textContent = `📝 ${item.item_name} のメモ`; 
  viewTitle.style.margin = '0';
  viewTitle.style.fontSize = '1.1rem';

  const currentMemoBox = document.createElement('div');
  currentMemoBox.style.cssText = `
    background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid var(--border);
    white-space: pre-wrap; font-size: 0.9rem; max-height: 250px; overflow-y: auto; color: var(--text-main); line-height: 1.5;
  `;
  currentMemoBox.textContent = hasMemo ? item.memo : 'メモはまだありません。';
  if (!hasMemo) currentMemoBox.style.color = 'var(--text-sub)';

  const viewBtnContainer = document.createElement('div');
  viewBtnContainer.style.cssText = `display: flex; gap: 12px;`;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる';
  closeBtn.className = 'secondary-btn';
  closeBtn.style.flex = '1';

  viewBtnContainer.appendChild(closeBtn);

  let editBtn = null;
  if (!isHistory) {
    editBtn = document.createElement('button');
    editBtn.textContent = '追記する';
    editBtn.className = 'primary-btn';
    editBtn.style.flex = '1';
    viewBtnContainer.appendChild(editBtn);
  }

  viewContainer.appendChild(viewTitle);
  viewContainer.appendChild(currentMemoBox);
  viewContainer.appendChild(viewBtnContainer);

  // メモ編集用コンテナ
  const editContainer = document.createElement('div');
  editContainer.style.cssText = `display: ${directEdit ? 'flex' : 'none'}; flex-direction: column; gap: 16px;`;

  const editTitle = document.createElement('h3');
  editTitle.textContent = `📝 追記を入力`;
  editTitle.style.margin = '0';
  editTitle.style.fontSize = '1.1rem';

  const inputArea = document.createElement('textarea');
  inputArea.placeholder = '新しい追記を入力...';
  inputArea.style.cssText = `
    width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border);
    font-size: 1rem; resize: none; height: 120px; outline: none;
  `;
  inputArea.onfocus = () => inputArea.style.borderColor = 'var(--accent)';
  inputArea.onblur = () => inputArea.style.borderColor = 'var(--border)';

  const editBtnContainer = document.createElement('div');
  editBtnContainer.style.cssText = `display: flex; gap: 12px;`;

  const backBtn = document.createElement('button');
  backBtn.textContent = '戻る';
  backBtn.className = 'secondary-btn';
  backBtn.style.flex = '1';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.className = 'primary-btn';
  saveBtn.style.flex = '1';

  editBtnContainer.appendChild(backBtn);
  editBtnContainer.appendChild(saveBtn);

  editContainer.appendChild(editTitle);
  editContainer.appendChild(inputArea);
  editContainer.appendChild(editBtnContainer);

  box.appendChild(viewContainer);
  box.appendChild(editContainer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    box.style.transform = 'translateY(0)';
    if (directEdit) inputArea.focus();
  });

  const closeModal = () => {
    overlay.style.opacity = '0';
    box.style.transform = 'translateY(20px)';
    setTimeout(() => document.body.removeChild(overlay), 200);
  };

  closeBtn.onclick = closeModal;

  if (editBtn) {
    editBtn.onclick = () => {
      viewContainer.style.display = 'none';
      editContainer.style.display = 'flex';
      inputArea.focus();
    };
  }

  backBtn.onclick = () => {
    if (directEdit && !hasMemo) {
      closeModal();
    } else {
      editContainer.style.display = 'none';
      viewContainer.style.display = 'flex';
    }
  };

  saveBtn.onclick = async () => {
    if (await checkOffline()) return; // ガード

    const newText = inputArea.value.trim();
    if (!newText) {
      if (directEdit && !hasMemo) closeModal();
      else {
        editContainer.style.display = 'none';
        viewContainer.style.display = 'flex';
      }
      return;
    }

    if (!(await window.showConfirm('メモを追記して保存しますか？'))) return;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    // 既存のメモデータと新しい追記文を結合
    const combinedMemo = hasMemo
      ? `${item.memo}\n\n[📝追記: ${state.userName}]\n${newText}`
      : `[📝追記: ${state.userName}]\n${newText}`;

    try {
      await rpc('update_item_memo', { p_item_id: item.id, p_memo: combinedMemo });
      showToast('メモを追記しました！');
      closeModal();
      fetchItems(true); 
    } catch (e) {
      console.error('Memo update failed:', e);
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  };
};

// ==========================================
// 5. Swipe Interactions
// ==========================================

/**
 * リストアイテムに対する横スワイプでの購入・削除ジェスチャーをバインド
 * @param {HTMLElement} container - スワイプを検知するDOMコンテナ
 * @param {Object} item - 対象アイテムのデータオブジェクト
 */
const setupSwipe = (container, item) => {
  const content = container.querySelector('.swipe-content');
  const label = container.querySelector('.swipe-bg-label');
  
  let startX = 0, startY = 0, currentX = 0, isSwiping = false;

  // スワイプ開始位置の記録
  content.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX; 
    startY = e.touches[0].clientY;
    
    // エッジスワイプ（iOSの戻る動作など）との競合を防止
    if (startX < 20 || startX > window.innerWidth - 20) return;

    isSwiping = true;
    state.isSwiping = true;
    currentX = 0;
    content.style.transition = 'none';
    container.style.transition = 'none';
  }, { passive: true });

  // スワイプ中の視覚的フィードバック（背景色とラベルの透過度）
  content.addEventListener('touchmove', e => {
    if (!isSwiping) return;

    const deltaX = e.touches[0].clientX - startX;
    const deltaY = e.touches[0].clientY - startY;

    // 縦スクロールの意図が強い場合はスワイプ判定を即座にキャンセル
    if (currentX === 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
      isSwiping = false;
      state.isSwiping = false;
      return;
    }

    currentX = deltaX;

    if (Math.abs(deltaX) > 10 && e.cancelable) {
      e.preventDefault();
    }

    if (currentX > 0) { 
      // 右スワイプ（購入）
      container.style.backgroundColor = '#2ecc71'; 
      label.textContent = "✅ 購入";
      label.style.justifyContent = "flex-start";
      label.style.opacity = Math.min(currentX / 80, 1);
    } else { 
      // 左スワイプ（削除）
      container.style.backgroundColor = '#e74c3c'; 
      label.textContent = "🗑️ 削除";
      label.style.justifyContent = "flex-end";
      label.style.opacity = Math.min(Math.abs(currentX) / 80, 1);
    }
    content.style.transform = `translateX(${currentX}px)`;
  }, { passive: false });

  // スワイプ終了時の判定
  const handleEnd = () => {
    if (!isSwiping) return;
    isSwiping = false;
    state.isSwiping = false;

    // 右スワイプ（購入アクションの閾値超過）
    if (currentX > 80) {
      content.style.transition = 'transform 0.2s ease';
      content.style.transform = `translateX(100%)`; 
      
      content.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'transform') return;
        content.removeEventListener('transitionend', handler); 
        
        setTimeout(async () => {
          if (await checkOffline()) { resetSwipe(); return; } // ガード

          const res = await window.showConfirm('購入済みにしますか？', { withPrice: true });
          if (res && res.confirmed) {
            container.style.display = 'none';
            try {
              if (res.price !== null) {
                await rpc('update_item_price', { p_item_id: item.id, p_price: res.price });
              }
              await rpc('mark_as_purchased', { p_item_ids: [item.id] });
              fetchItems(true);
              showToast('購入済みにしました✨');
            } catch (err) {
              console.error('Purchase failed via swipe:', err);
              await window.showAlert('処理中にエラーが発生しました。');
            }
          } else {
            resetSwipe();
          }
        }, 10);
      });

    // 左スワイプ（削除アクションの閾値超過）
    } else if (currentX < -80) {
      content.style.transition = 'transform 0.2s ease';
      content.style.transform = `translateX(-100%)`; 
      
      content.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'transform') return;
        content.removeEventListener('transitionend', handler);
        
        setTimeout(async () => {
          if (await checkOffline()) { resetSwipe(); return; } // ガード

          if (await window.showConfirm('完全に削除しますか？', { isDanger: true })) {
            container.style.display = 'none';
            try {
              await rpc('delete_item_permanently', { p_item_ids: [item.id] });
              fetchItems(true);
              showToast('完全に削除しました🗑️');
            } catch (err) {
              console.error('Delete failed via swipe:', err);
              await window.showAlert('削除処理に失敗しました。');
            }
          } else {
            resetSwipe();
          }
        }, 10);
      });

    // 閾値に満たない場合は元の位置へ戻す
    } else {
      resetSwipe(); 
    }

    function resetSwipe() {
      content.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
      content.style.transform = `translateX(0)`;
      label.style.opacity = 0;
      setTimeout(() => { container.style.backgroundColor = "var(--surface)"; }, 300);
    }
  };

  content.addEventListener('touchend', handleEnd);
  content.addEventListener('touchcancel', handleEnd);
};

// ==========================================
// 6. Event Handlers
// ==========================================

// 履歴アイテムの金額未入力時、後から金額を追加するイベント
window.addPriceToHistory = async (id, event) => {
  if (event) event.stopPropagation();
  if (await checkOffline()) return; // ガード

  const res = await window.showConfirm('購入金額を入力してください', { withPrice: true });
  if (res && res.confirmed && res.price !== null) {
    try {
      await rpc('update_item_price', { p_item_id: id, p_price: res.price });
      showToast('金額を追加しました✨');
      fetchItems(true);
    } catch (e) {
      console.error('Add price failed:', e);
      await window.showAlert('金額の追加に失敗しました。');
    }
  }
};

// 履歴画面からの「もう一度買う」イベント
window.repeatItem = async (id, event) => {
  if (event) event.stopPropagation();
  if (await checkOffline()) return; // ガード

  const item = state.historyItems.find(i => i.id === id);
  if (!item) return;
  
  if (!(await window.showConfirm(`「${item.item_name}」をリストに再度追加しますか？`))) return;

  try {
    await rpc('add_item', { 
      p_item_name: item.item_name, 
      p_memo: item.memo, 
      p_category: item.category, 
      p_quantity: 1 
    });
    
    showToast('リストに追加しました🔄');
    fetchItems(true);
  } catch (e) {
    console.error('Repeat item failed:', e);
    await window.showAlert('リストへの追加に失敗しました。');
  }
};

// ログインボタン処理
document.getElementById('login-btn').onclick = async () => {
  const key = document.getElementById('supabase-key-input').value.trim();
  const pass = document.getElementById('password-input').value.trim();
  
  if (!key || !pass) {
    await window.showAlert('接続番号とパスワードを両方入力してください。');
    return;
  }

  if (!window.supabase) {
    await window.showAlert('システムが読み込めていません。<br>通信環境の良い場所でアプリを再読み込みしてください。');
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
 
  try {
    dbClient = window.supabase.createClient(SUPABASE_URL, key);
    const { data, error } = await dbClient.rpc('authenticate_user', { p_pass: pass });
    
    if (error) throw new Error('NetworkError'); 
    if (!data) throw new Error('Invalid');
    
    state.supabaseKey = key;

    state.password = pass;
    state.userName = data;
    
    localStorage.setItem('app_supabase_key', key);
    localStorage.setItem('app_password', pass);
    
    showToast('ログインしました');
    await fetchItems();
    startSync();
  } catch (e) {
    console.error('Login failed:', e);
    if (e.message === 'Invalid') {
      await window.showAlert('接続番号またはパスワードが違います。');
    } else {
      await window.showAlert('通信エラーが発生しました。<br>電波の良い場所でお試しください。');
    }
    dbClient = null;
  } finally {
    btn.disabled = false;
  }
};

// ログアウト処理
const logout = () => {
  localStorage.removeItem('app_supabase_key');
  localStorage.removeItem('app_password');
  
  state.supabaseKey = '';
  state.password = '';
  state.userName = '';
  dbClient = null;
  
  if (syncInterval) clearInterval(syncInterval);
  render();
};

// 詳細画面からの戻る処理
document.getElementById('back-btn').onclick = () => {
  history.back();
};

// 履歴画面への遷移
document.getElementById('go-history-btn').onclick = () => {
  state.currentCategory = 'history';
  state.isEditMode = false;
  state.selectedIds.clear();

  history.pushState({ page: 'history' }, '', '');

  state.isTransitioning = true;
  render();
  fetchItems(true);
};

// 数量変更（マイナス）
document.getElementById('qty-minus').onclick = () => {
  if (state.newQuantity > 1) { 
    state.newQuantity--; 
    document.getElementById('qty-display').textContent = state.newQuantity; 
  }
};

// 数量変更（プラス）
document.getElementById('qty-plus').onclick = () => {
  if (state.newQuantity < 10) { 
    state.newQuantity++; 
    document.getElementById('qty-display').textContent = state.newQuantity; 
  }
};

// 新規アイテム追加処理
document.getElementById('add-btn').onclick = async () => {
  if (await checkOffline()) return; // ガード

  const nameInput = document.getElementById('new-item-name');
  const memoInput = document.getElementById('new-item-memo');
  const name = nameInput.value.trim();
  const memo = memoInput.value.trim() || null;
  
  if (!name) {
    await window.showAlert('品名を入力してください。');
    return;
  }

  const btn = document.getElementById('add-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    await rpc('add_item', {
      p_item_name: name,
      p_memo: memo,
      p_category: state.currentCategory,
      p_quantity: state.newQuantity
    });
    
    nameInput.blur();
    memoInput.blur();

    nameInput.value = '';
    memoInput.value = '';
    state.newQuantity = 1;
    document.getElementById('qty-display').textContent = '1';
    showToast('追加しました');
    
    state.isTransitioning = true;
    render();
    await fetchItems(true);
  } catch(e) {
    console.error('Add item failed:', e);
    await window.showAlert('追加に失敗しました。');
  } finally {
    btn.disabled = false;
    btn.textContent = '追加';
  }
};

// 複数選択用の編集モードトグル
document.getElementById('edit-mode-btn').onclick = () => {
  state.isEditMode = !state.isEditMode;
  state.selectedIds.clear();
  document.getElementById('select-all-chk').checked = false;
  render();
};

// 個別チェックボックスのトグル
window.toggleSelect = (id, isChecked) => {
  const strId = String(id);
  if (isChecked) {
    state.selectedIds.add(strId);
  } else {
    state.selectedIds.delete(strId);
  }
  updateSelectCount();
};

// すべて選択チェックボックスのトグル
document.getElementById('select-all-chk').onchange = (e) => {
  const targetItems = state.currentCategory === 'all' 
    ? state.items 
    : state.items.filter(i => i.category === state.currentCategory);
  
  if (e.target.checked) {
    targetItems.forEach(i => state.selectedIds.add(String(i.id)));
  } else {
    state.selectedIds.clear();
  }
  renderItemList();
};

const updateSelectCount = () => {
  document.getElementById('selected-count').textContent = `${state.selectedIds.size}件`;
};

// 選択したアイテムの一括購入処理
document.getElementById('purchase-selected-btn').onclick = async () => {
  if (await checkOffline()) return; // ガード
  if (state.selectedIds.size === 0) return;
  
  const selectedItems = state.items.filter(i => state.selectedIds.has(String(i.id)));
  const priceMap = await window.showMultiPurchasePrompt(selectedItems);
  
  if (priceMap === null) return; 

  const ids = Array.from(state.selectedIds);

  try {
    const updatePromises = Object.entries(priceMap)
      .filter(([id]) => state.selectedIds.has(String(id)))
      .map(([id, price]) => 
        rpc('update_item_price', { p_item_id: id, p_price: price })
      );

    // 金額の並列更新
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
    
    // ステータスの更新
    await rpc('mark_as_purchased', { p_item_ids: ids });
    
    state.isEditMode = false;
    state.selectedIds.clear();
    showToast('購入済みにしました✨');
    
    state.isTransitioning = true;
    render();
    fetchItems(true); 
  } catch (e) {
    console.error('Batch purchase failed:', e);
    await window.showAlert('通信エラーが発生しました。');
  }
};

// 選択したアイテムの一括削除処理
document.getElementById('delete-selected-btn').onclick = async () => {
  if (await checkOffline()) return; // ガード
  if (state.selectedIds.size === 0) return;
  
  const ids = Array.from(state.selectedIds);
  if (!(await window.showConfirm('選択した品物を完全に削除します。よろしいですか？\n（履歴には残りません）', { isDanger: true }))) return;

  try {
    await rpc('delete_item_permanently', { p_item_ids: ids });
    state.isEditMode = false;
    state.selectedIds.clear();
    showToast('完全に削除しました🗑️');
    fetchItems(true); 
  } catch (e) {
    console.error('Batch delete failed:', e);
    await window.showAlert('削除処理に失敗しました。');
  }
};

// ==========================================
// 7. Initialization & Auto Recovery
// ==========================================

// ログイン処理と定期同期の開始を関数化
const attemptLoginAndSync = () => {
  if (!state.supabaseKey || !state.password) {
    render();
    return;
  }
  
  if (!window.supabase) {
    if (state.userName !== 'オフライン(閲覧のみ)') {
      showToast('オフラインのため、保存されたリストを表示します', 'error');
    }
    state.userName = 'オフライン(閲覧のみ)';
    
    try {
      const cachedItems = localStorage.getItem('app_cached_items');
      if (cachedItems) state.items = JSON.parse(cachedItems);
      
      const cachedHistory = localStorage.getItem('app_cached_history');
      if (cachedHistory) state.historyItems = JSON.parse(cachedHistory);
    } catch (parseError) {
      console.error('Cache parse error:', parseError);
    }
    
    render();
    return;
  }

  dbClient = window.supabase.createClient(SUPABASE_URL, state.supabaseKey);
  
  dbClient.rpc('authenticate_user', { p_pass: state.password })
    .then(({ data, error }) => {
      
      if (error) throw new Error('NetworkError');
      if (!data) throw new Error('Invalid');
      
      state.userName = data;
      fetchItems();
      startSync();
    })

    .catch((e) => {
      if (e.message !== 'Invalid') {
        if (state.userName !== 'オフライン(閲覧のみ)') {
          showToast('オフラインのため、保存されたリストを表示します', 'error');
        }
        state.userName = 'オフライン(閲覧のみ)';
        
        try {
          const cachedItems = localStorage.getItem('app_cached_items');
          if (cachedItems) state.items = JSON.parse(cachedItems);
          
          const cachedHistory = localStorage.getItem('app_cached_history');
          if (cachedHistory) state.historyItems = JSON.parse(cachedHistory);
        } catch (parseError) {
          console.error('Cache parse error:', parseError);
        }
        
        render();
        return;
      }
      logout();
    });
};

// 初回起動時の実行
attemptLoginAndSync();

// 電波が戻った瞬間に自動でオンラインに復帰する
window.addEventListener('online', () => {
  if (state.userName === 'オフライン(閲覧のみ)') {
    showToast('通信が回復しました。自動で再接続します...', 'success');
    attemptLoginAndSync();
  }
});

// アプリ起動中に電波を失った場合、自動で閲覧モードに切り替える
window.addEventListener('offline', () => {
  if (state.userName && state.userName !== 'オフライン(閲覧のみ)') {
    showToast('通信が切断されました。閲覧モードに移行します', 'error');
    state.userName = 'オフライン(閲覧のみ)';
    render();
  }
});

// スマホ本体の戻るボタンに対応する処理
window.addEventListener('popstate', (event) => {
  // ダイアログが出ている時は、自動で「キャンセル/閉じる」をクリックさせる
  const overlays = document.querySelectorAll('div[style*="z-index: 10000"]');
  if (overlays.length > 0) {
    // 最前面のダイアログを取得
    const topOverlay = overlays[overlays.length - 1];
    
    // ダイアログ内のボタンを探してクリック
    const buttons = Array.from(topOverlay.querySelectorAll('button')).filter(b => b.offsetParent !== null);
    const closeBtn = buttons.find(b => 
      ['キャンセル', '閉じる', '確認画面に戻る', 'OK'].includes(b.textContent.trim())
    ) || buttons[0];
    
    if (closeBtn) closeBtn.click();

    // トップ画面(null)の時にエラーが出た場合も考慮し、正確な状態の履歴を復元する
    const pageState = state.currentCategory === 'history' ? 'history' : (state.currentCategory ? 'detail' : 'home');
    history.pushState({ page: pageState }, '', '');
    return;
  }

  if (state.currentCategory !== null) {
    // 詳細画面にいる時に本体の戻るボタンが押されたら一覧に戻る
    state.currentCategory = null;
    state.isEditMode = false;
    state.selectedIds.clear();
    state.newQuantity = 1;
    document.getElementById('qty-display').textContent = '1';
    render();
    fetchItems(true);
  }
});