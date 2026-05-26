// ==========================================
// 1. 設定・初期化
// ==========================================
const SUPABASE_URL = 'https://yjtpmjhrjqbimcjztait.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mclvJ1Tcf_e7lS3ufORyug_j7JZWn0G';

const { createClient } = window.supabase;
const dbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  { id: 'daily', name: '日用品', icon: '🧼', colorClass: 'c-daily', hex: '#1abc9c', textColor: '#ffffff' },
  { id: 'other', name: 'その他', icon: '🏷️', colorClass: 'c-other', hex: '#95a5a6', textColor: '#ffffff' }
];

let state = {
  password: localStorage.getItem('app_password') || '',
  userName: '',
  items: [],
  historyItems: [], 
  currentCategory: null, 
  isEditMode: false,
  selectedIds: new Set(),
  newQuantity: 1,
  readItemIds: new Set(JSON.parse(localStorage.getItem('app_read_items')) || []),
  isTransitioning: false,
  isSwiping: false // 💡 追加: スワイプ中の自動再描画を防ぐためのフラグ
};

let syncInterval = null;

// ==========================================
// 2. 共通関数・通知
// ==========================================
const showToast = (msg, type = 'success') => {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 2500);
};

window.showAlert = (message) => {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; padding: 20px;`;
    
    const box = document.createElement('div');
    box.style.cssText = `background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px); transition: transform 0.2s; box-shadow: 0 10px 25px rgba(0,0,0,0.2);`;
    
    box.innerHTML = `
      <h3 style="color: var(--danger); font-size: 1.1rem; margin-bottom: 16px;">⚠️ エラー</h3>
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

    requestAnimationFrame(() => { overlay.style.opacity = '1'; box.style.transform = 'translateY(0)'; });
  });
};

const rpc = async (fnName, params = {}) => {
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

const formatDate = (isoString) => {
  if (!isoString) return 'なし';
  const targetDate = new Date(isoString);
  const now = new Date();
  const targetZero = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((todayZero - targetZero) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return '今日';
  else if (diffDays === 1) return '昨日';
  else if (diffDays > 1 && diffDays < 7) return `${diffDays}日前`;
  else return `${targetDate.getMonth() + 1}/${targetDate.getDate()}`;
};

const saveReadItems = () => {
  localStorage.setItem('app_read_items', JSON.stringify(Array.from(state.readItemIds)));
};

// ==========================================
// 3. データ取得と画面描画
// ==========================================
const fetchItems = async (isSilent = false) => {
  if (!state.userName) return;
  try {
    const itemsData = await rpc('get_items');
    state.items = itemsData || [];
    
    if (state.currentCategory === 'history') {
      const historyData = await rpc('get_purchased_items');
      state.historyItems = historyData || [];
    }

    if (state.currentCategory && state.currentCategory !== 'history') {
      const currentItems = state.items.filter(i => i.category === state.currentCategory);
      currentItems.forEach(item => state.readItemIds.add(item.id));
      saveReadItems();
    }

    // 💡 修正: ダイアログが開いているか判定する超安全な記述
    const hasOpenDialog = document.querySelector('div[style*="z-index: 10000"]') !== null;
    state.isTransitioning = false;

    // ダイアログが開いていない時だけ画面を再描画する
    if (!state.isEditMode && !state.isSwiping && !hasOpenDialog) {
      render();
    }
  } catch (e) {
    console.error(e);
    
    const hasOpenDialog = document.querySelector('div[style*="z-index: 10000"]') !== null;
    state.isTransitioning = false;
    
    if (!state.isEditMode && !state.isSwiping && !hasOpenDialog) {
      render();
    }
  }
};

const startSync = () => {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => fetchItems(true), 15000); 
};

const render = () => {
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  if (!state.userName) {
    document.getElementById('login-view').classList.remove('hidden');
    return;
  }
  if (!state.currentCategory) renderCategoryList();
  else renderItemList();
};

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
    !state.readItemIds.has(item.id) && item.created_by !== state.userName
  );
  const allUnreadBadge = hasAnyUnread ? `<span class="unread-badge">New!</span>` : '';

  const allDiv = document.createElement('div');
  allDiv.className = 'list-item';
  allDiv.style.border = '2px solid var(--text-main)';
  
  allDiv.onclick = () => {
    state.items.forEach(item => state.readItemIds.add(item.id));
    saveReadItems();
    state.currentCategory = 'all'; 
    state.isEditMode = false;
    state.selectedIds.clear();
    
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
      !state.readItemIds.has(item.id) && item.created_by !== state.userName
    );

    const unreadBadge = hasUnread ? `<span class="unread-badge">New!</span>` : '';
    
    const div = document.createElement('div');
    div.className = 'list-item';
    div.onclick = () => {
      catItems.forEach(item => state.readItemIds.add(item.id));
      saveReadItems();
      state.currentCategory = cat.name;
      state.isEditMode = false;
      state.selectedIds.clear();

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
  
  const currentItemIds = new Set(state.items.map(i => i.id));
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

const renderItemList = () => {
  const isHistory = state.currentCategory === 'history';
  const isAll = state.currentCategory === 'all';
  
  const catObj = CATEGORIES.find(c => c.name === state.currentCategory);
  const rootStyle = document.documentElement.style;
  const addBtn = document.getElementById('add-btn');

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
  
  if (isHistory) document.getElementById('detail-title').textContent = '購入履歴';
  else if (isAll) document.getElementById('detail-title').textContent = 'すべての品物';
  else document.getElementById('detail-title').textContent = state.currentCategory;
  
  const editBtn = document.getElementById('edit-mode-btn');
  const addForm = document.getElementById('add-form');
  const editActions = document.getElementById('edit-actions');

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

  if (state.isTransitioning) {
    container.innerHTML = `
      <div class="skeleton-item"><div class="skeleton-content"><div class="skeleton-text"></div><div class="skeleton-text short"></div></div></div>
      <div class="skeleton-item"><div class="skeleton-content"><div class="skeleton-text"></div><div class="skeleton-text short"></div></div></div>
      <div class="skeleton-item"><div class="skeleton-content"><div class="skeleton-text"></div><div class="skeleton-text short"></div></div></div>
    `;
    return; 
  }

  container.innerHTML = '';
  
  let targetItems;
  if (isHistory) {
    targetItems = [...state.historyItems].sort((a, b) => {
      const dateA = new Date(a.purchased_at || 0).setHours(0, 0, 0, 0);
      const dateB = new Date(b.purchased_at || 0).setHours(0, 0, 0, 0);
      if (dateB !== dateA) return dateB - dateA;
      
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
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub); font-size:0.95rem;">${msg}</div>`;
    return;
  }

  let lastCategory = null;
  let lastDate = null;

  targetItems.forEach(item => {
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
    
    let checkboxHtml = '';
    if (state.isEditMode) {
      const isChecked = state.selectedIds.has(item.id) ? 'checked' : '';
      checkboxHtml = `<input type="checkbox" value="${item.id}" ${isChecked} onchange="toggleSelect('${item.id}', this.checked)">`;
    }

    const catObj = CATEGORIES.find(c => c.name === item.category);
    const badgeColor = catObj ? catObj.hex : '#95a5a6';
    const categoryBadge = (isAll || isHistory) ? `<span style="font-size: 0.7rem; background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 20px; margin-left: 8px; font-weight: bold; vertical-align: middle;">${item.category}</span>` : '';
    
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

    let historyInfoHtml = '';
    
    if (isHistory) {
      const buyer = item.purchased_by || '不明'; 
      const priceText = (item.price != null && item.price !== '') ? `${item.price}円` : '---円';

      // 💡 修正：「もう一度買う」ボタンのテキストをなくし、1行にまとめて縦伸びを解消しました
      historyInfoHtml = `
        <div style="font-size: 0.8rem; color: var(--text-sub); margin-top: 4px; display: flex; align-items: center; gap: 8px;">
          <span>購入: ${buyer} / 金額: ${priceText}</span>
          <button class="repeat-btn" onclick="repeatItem('${item.id}', event)" title="もう一度買う">🔄</button>
        </div>
      `;
    } else {
      const createdTimeStr = formatDate(item.created_at);
      historyInfoHtml = `
        <p style="font-size: 0.8rem; color: var(--text-sub); margin-top: 4px;">追加: ${item.created_by} (${createdTimeStr})</p>
      `;
    }

    const innerContent = `
      ${checkboxHtml}
      <div class="detail-info" onclick="${state.isEditMode ? `document.querySelector('input[value=\"${item.id}\"]').click()` : ''}">
        <h4>${item.item_name} ${categoryBadge}</h4>
        <div style="margin-top: 6px;">${memoBadge}</div>
        ${historyInfoHtml}
      </div>
      <div class="detail-qty">×${item.quantity}</div>
    `;

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

window.showConfirm = (message, options = {}) => {
  return new Promise((resolve) => {
    const isDanger = typeof options === 'boolean' ? options : (options.isDanger || false);
    const withPrice = typeof options === 'boolean' ? false : (options.withPrice || false);

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.5); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s ease;
    `;

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

    let inputField = null;
    if (withPrice) {
      inputField = document.createElement('input');
      inputField.type = 'tel';
      inputField.placeholder = '金額を入力...（任意）';
      inputField.style.cssText = `width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid var(--border); border-radius: 8px; font-size: 1.1rem; text-align: center; outline: none; background: #f8fafc;`;
      box.appendChild(inputField);
    }

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
        if (val !== '' && !/^[0-9]+$/.test(val)) {
          await window.showAlert('数字以外のものが入力されています。<br>半角数字のみで入力してください。');
          return; 
        }
        closeAndResolve({ confirmed: true, price: val !== '' ? parseInt(val, 10) : null });
      } else {
        closeAndResolve(true);
      }
    };
    
    cancelBtn.onclick = () => closeAndResolve(withPrice ? { confirmed: false } : false);
  });
};

window.showMultiPurchasePrompt = (items) => {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; padding: 20px;`;
    
    const mainBox = document.createElement('div');
    mainBox.style.cssText = `background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px); transition: transform 0.2s; box-shadow: 0 10px 25px rgba(0,0,0,0.2);`;
    mainBox.innerHTML = `<p style="margin-bottom: 24px; font-weight: bold; font-size: 0.95rem;">選択した品物を購入済みにしますか？</p>`;

    const mainBtnContainer = document.createElement('div');
    mainBtnContainer.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル'; cancelBtn.className = 'secondary-btn'; cancelBtn.style.flex = '1';

    const priceBtn = document.createElement('button');
    priceBtn.textContent = '各金額を入力 (任意)'; priceBtn.className = 'secondary-btn'; priceBtn.style.width = '100%'; priceBtn.style.order = '-1'; priceBtn.style.marginBottom = '4px';

    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK'; okBtn.className = 'primary-btn'; okBtn.style.flex = '1';

    mainBtnContainer.append(priceBtn, cancelBtn, okBtn);
    mainBox.appendChild(mainBtnContainer);

    const priceBox = document.createElement('div');
    priceBox.style.cssText = `display: none; background: var(--surface); padding: 24px; border-radius: 16px; width: 100%; max-width: 320px; text-align: center; transform: translateY(20px); transition: transform 0.2s; box-shadow: 0 10px 25px rgba(0,0,0,0.2);`;
    
    let listHtml = items.map(item => `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; text-align: left;">
        <span style="font-size: 0.9rem; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; font-weight:bold;">${item.item_name}</span>
        <input type="tel" id="price-input-${item.id}" placeholder="---" style="width: 80px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; text-align: right; outline: none;">
        <span style="font-size:0.9rem; margin-left:4px; font-weight:bold;">円</span>
      </div>
    `).join('');

    priceBox.innerHTML = `<h3 style="margin-bottom: 16px;">💰 各金額を入力</h3><div style="max-height: 40vh; overflow-y: auto; margin-bottom: 16px; padding-right: 4px;">${listHtml}</div>`;

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
      items.forEach(item => {
        const val = document.getElementById(`price-input-${item.id}`).value.trim();
        if (val !== '') priceMap[item.id] = parseInt(val, 10);
      });
      close(priceMap);
    };
  });
};

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

    const combinedMemo = hasMemo
      ? `${item.memo}\n\n[📝追記: ${state.userName}]\n${newText}`
      : `[📝追記: ${state.userName}]\n${newText}`;

    try {
      await rpc('update_item_memo', { p_item_id: item.id, p_memo: combinedMemo });
      showToast('メモを追記しました！');
      closeModal();
      fetchItems(true); 
    } catch (e) {
      console.error(e);
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  };
};

// ==========================================
// スワイプ機能のロジック
// ==========================================
const setupSwipe = (container, item) => {
  const content = container.querySelector('.swipe-content');
  const label = container.querySelector('.swipe-bg-label');
  
  let startX = 0, currentX = 0, isSwiping = false;

  content.addEventListener('touchstart', e => {
    // 💡 修正：指の初期位置を確実に取得する
    startX = e.touches[0].clientX; 
    
    if (startX < 20 || startX > window.innerWidth - 20) return;

    isSwiping = true;
    state.isSwiping = true;
    currentX = 0;
    content.style.transition = 'none';
    container.style.transition = 'none';
  }, { passive: true });

  content.addEventListener('touchmove', e => {
    if (!isSwiping) return;

    const deltaX = e.touches[0].clientX - startX;
    currentX = deltaX;

    if (Math.abs(deltaX) > 10 && e.cancelable) {
      e.preventDefault();
    }

    if (currentX > 0) { 
      container.style.backgroundColor = '#2ecc71'; 
      label.textContent = "✅ 購入";
      label.style.justifyContent = "flex-start";
      label.style.opacity = Math.min(currentX / 80, 1);
    } else { 
      container.style.backgroundColor = '#e74c3c'; 
      label.textContent = "🗑️ 削除";
      label.style.justifyContent = "flex-end";
      label.style.opacity = Math.min(Math.abs(currentX) / 80, 1);
    }
    content.style.transform = `translateX(${currentX}px)`;
  }, { passive: false });

  const handleEnd = () => {
    if (!isSwiping) return;
    isSwiping = false;
    state.isSwiping = false;

    if (currentX > 80) {
      content.style.transition = 'transform 0.2s ease';
      content.style.transform = `translateX(100%)`; 
      
      content.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'transform') return;
        content.removeEventListener('transitionend', handler); 
        
        setTimeout(async () => {
          const res = await window.showConfirm('購入済みにしますか？', { withPrice: true });
          if (res && res.confirmed) {
            container.style.display = 'none';
            try {
              if (res.price !== null) {
                await rpc('update_item_price', { p_item_id: item.id, p_price: res.price });
              }
              await rpc('mark_as_purchased', { p_item_ids: [item.id] });
              fetchItems(true);
            } catch (err) {
              console.error(err);
              await window.showAlert('処理中にエラーが発生しました。');
            }
          } else {
            resetSwipe();
          }
        }, 10);
      });

    } else if (currentX < -80) {
      content.style.transition = 'transform 0.2s ease';
      content.style.transform = `translateX(-100%)`; 
      
      content.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'transform') return;
        content.removeEventListener('transitionend', handler);
        
        setTimeout(async () => {
          if (await window.showConfirm('完全に削除しますか？', { isDanger: true })) {
            container.style.display = 'none';
            try {
              await rpc('delete_item_permanently', { p_item_ids: [item.id] });
              fetchItems(true);
            } catch (err) {
              console.error(err);
              await window.showAlert('削除処理に失敗しました。');
            }
          } else {
            resetSwipe();
          }
        }, 10);
      });

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
// 4. イベントハンドラ・各種アクション
// ==========================================

window.repeatItem = async (id, event) => {
  if (event) event.stopPropagation();
  const item = state.historyItems.find(i => i.id === id);
  if (!item) return;
  if (!(await window.showConfirm(`「${item.item_name}」をリストに再度追加しますか？`))) return;

  try {
    await rpc('add_item', { p_item_name: item.item_name, p_memo: item.memo, p_category: item.category, p_quantity: 1 });
    
    dbClient.functions.invoke('line-notify', {
      body: { 
        user: state.userName, 
        category: item.category, 
        itemName: item.item_name, 
        quantity: 1 
      }
    }).catch(e => console.error('LINE通知の呼び出しに失敗:', e));

    showToast('リストに追加しました🔄');
    fetchItems(true);
  } catch (e) {
    console.error(e);
    await window.showAlert('リストへの追加に失敗しました。');
  }
};

document.getElementById('login-btn').onclick = async () => {
  const pass = document.getElementById('password-input').value.trim();
  if (!pass) return;
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  
  try {
    const { data, error } = await dbClient.rpc('authenticate_user', { p_pass: pass });
    if (error || !data) throw new Error('Invalid');
    
    state.password = pass;
    state.userName = data;
    localStorage.setItem('app_password', pass);
    
    showToast('ログインしました');
    await fetchItems();
    startSync();
  } catch (e) {
    console.error(e);
    await window.showAlert('パスワードが違います。');
  } finally {
    btn.disabled = false;
  }
};

const logout = () => {
  localStorage.removeItem('app_password');
  state.password = '';
  state.userName = '';
  if (syncInterval) clearInterval(syncInterval);
  render();
};

document.getElementById('back-btn').onclick = () => {
  state.currentCategory = null;
  state.isEditMode = false;
  state.selectedIds.clear();
  render();
  fetchItems(true);
};

document.getElementById('go-history-btn').onclick = () => {
  state.currentCategory = 'history';
  state.isEditMode = false;
  state.selectedIds.clear();
  
  state.isTransitioning = true;
  render();
  fetchItems(true);
};

document.getElementById('qty-minus').onclick = () => {
  if (state.newQuantity > 1) { 
    state.newQuantity--; 
    document.getElementById('qty-display').textContent = state.newQuantity; 
  }
};

document.getElementById('qty-plus').onclick = () => {
  if (state.newQuantity < 10) { 
    state.newQuantity++; 
    document.getElementById('qty-display').textContent = state.newQuantity; 
  }
};

document.getElementById('add-btn').onclick = async () => {
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
    dbClient.functions.invoke('line-notify', {
      body: { 
        user: state.userName, 
        category: state.currentCategory, 
        itemName: name, 
        quantity: state.newQuantity 
      }
    }).catch(e => console.error('LINE通知の呼び出しに失敗:', e));

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
    console.error(e);
    await window.showAlert('追加に失敗しました。');
  } finally {
    btn.disabled = false;
    btn.textContent = '追加';
  }
};

document.getElementById('edit-mode-btn').onclick = () => {
  state.isEditMode = !state.isEditMode;
  state.selectedIds.clear();
  document.getElementById('select-all-chk').checked = false;
  render();
};

window.toggleSelect = (id, isChecked) => {
  if (isChecked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  updateSelectCount();
};

document.getElementById('select-all-chk').onchange = (e) => {
  const targetItems = state.currentCategory === 'all' 
    ? state.items 
    : state.items.filter(i => i.category === state.currentCategory);
  
  if (e.target.checked) targetItems.forEach(i => state.selectedIds.add(i.id));
  else state.selectedIds.clear();
  renderItemList();
};

const updateSelectCount = () => {
  document.getElementById('selected-count').textContent = `${state.selectedIds.size}件`;
};

document.getElementById('purchase-selected-btn').onclick = async () => {
  if (state.selectedIds.size === 0) return;
  
  const selectedItems = state.items.filter(i => state.selectedIds.has(i.id));

  const priceMap = await window.showMultiPurchasePrompt(selectedItems);
  if (priceMap === null) return; 

  const ids = Array.from(state.selectedIds);

  try {
    const updatePromises = Object.entries(priceMap)
      .filter(([id]) => state.selectedIds.has(id))
      .map(([id, price]) => 
        rpc('update_item_price', { p_item_id: id, p_price: price })
      );

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
    
    await rpc('mark_as_purchased', { p_item_ids: ids });
    
    state.isEditMode = false;
    state.selectedIds.clear();
    showToast('購入済みにしました✨');
    
    state.isTransitioning = true;
    render();
    fetchItems(true); 
  } catch (e) {
    console.error('購入エラー:', e);
    await window.showAlert('通信エラーが発生しました。');
  }
};

document.getElementById('delete-selected-btn').onclick = async () => {
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
    console.error(e);
    await window.showAlert('削除処理に失敗しました。');
  }
};

// ==========================================
// 5. 自動ログイン初期処理
// ==========================================
if (state.password) {
  dbClient.rpc('authenticate_user', { p_pass: state.password })
    .then(({ data, error }) => {
      if (error || !data) throw new Error('Invalid');
      state.userName = data;
      fetchItems();
      startSync();
    })
    .catch((e) => {
      if (e.message !== 'Invalid') {
        showToast('オフライン、または通信が不安定です', 'error');
        return;
      }
      logout();
    });
} else {
  render();
}