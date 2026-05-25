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
  readItemIds: new Set(JSON.parse(localStorage.getItem('app_read_items')) || [])
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
  
  const hours = targetDate.getHours().toString().padStart(2, '0');
  const minutes = targetDate.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (diffDays === 0) return timeStr;
  else if (diffDays === 1) return `昨日 ${timeStr}`;
  else if (diffDays > 1 && diffDays < 7) return `${diffDays}日前 ${timeStr}`;
  else return `${targetDate.getMonth() + 1}/${targetDate.getDate()} ${timeStr}`;
};

const saveReadItems = () => {
  localStorage.setItem('app_read_items', JSON.stringify(Array.from(state.readItemIds)));
};

// ==========================================
// 3. データ取得と画面描画
// ==========================================
const fetchItems = async (isBackground = false) => {
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

    if (!state.isEditMode) render();
  } catch (e) {
    console.error(e);
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
  // 💡 画面表示前にヘッダー色をリセット
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
  allDiv.style.border = '2px solid var(--accent)';
  allDiv.onclick = () => {
    state.items.forEach(item => state.readItemIds.add(item.id));
    saveReadItems();
    state.currentCategory = 'all'; 
    state.isEditMode = false;
    state.selectedIds.clear();
    fetchItems();
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
      fetchItems();
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

  container.innerHTML = '';
  
  let targetItems;
  if (isHistory) {
    targetItems = state.historyItems;
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
        divider.innerHTML = `📅 ${dateStr}`;
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
    // スワイプ可能にする条件：履歴画面ではなく、編集モードでもない時
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
    const memoHtml = item.memo ? `<div class="memo-text">📝 ${item.memo}</div>` : '';

    const createdTimeStr = formatDate(item.created_at);
    let historyInfoHtml = '';
    
    if (isHistory) {
      const purchasedTimeStr = formatDate(item.purchased_at);
      const buyer = item.purchased_by || '不明'; 
      historyInfoHtml = `
        <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 6px; line-height: 1.5;">
          <div style="color: var(--accent); font-weight: bold;">購入: ${buyer} (${purchasedTimeStr})</div>
          <div>追加: ${item.created_by} (${createdTimeStr})</div>
        </div>
        <button class="repeat-btn" onclick="repeatItem('${item.id}', event)">🔄 もう一度買う</button>
      `;
    } else {
      historyInfoHtml = `
        <p style="font-size: 0.8rem; color: var(--text-sub); margin-top: 4px;">追加: ${item.created_by} (${createdTimeStr})</p>
      `;
    }

    // 中身のコンテンツを作成
    const innerContent = `
      ${checkboxHtml}
      <div class="detail-info" onclick="${state.isEditMode ? `document.querySelector('input[value=\"${item.id}\"]').click()` : ''}">
        <h4>${item.item_name} ${categoryBadge}</h4>
        ${memoHtml}
        ${historyInfoHtml}
      </div>
      <div class="detail-qty">×${item.quantity}</div>
    `;

    if (isSwipeable) {
      // スワイプ構造の中に中身を流し込む
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
// スワイプ機能のロジック
// ==========================================
const setupSwipe = (container, item) => {
  const content = container.querySelector('.swipe-content');
  const label = container.querySelector('.swipe-bg-label');
  
  let startX = 0, currentX = 0, isSwiping = false;

  content.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    if (startX < 20 || startX > window.innerWidth - 20) return;

    isSwiping = true;
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

    if (currentX > 80) {
      content.style.transition = 'transform 0.2s ease';
      content.style.transform = `translateX(100%)`; 

      setTimeout(async () => {
        if (confirm('購入済みにしますか？')) {
          container.style.display = 'none';
          await rpc('mark_as_purchased', { p_item_ids: [item.id] });
          fetchItems();
        } else {
          resetSwipe();
        }
      }, 200);

    } else if (currentX < -80) {

      content.style.transition = 'transform 0.2s ease';
      content.style.transform = `translateX(-100%)`; 
      
      setTimeout(async () => {
        if (confirm('完全に削除しますか？')) {
          container.style.display = 'none';
          await rpc('delete_item_permanently', { p_item_ids: [item.id] });
          fetchItems();
        } else {
          resetSwipe();
        }
      }, 200);

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

// 履歴からの再追加
window.repeatItem = async (id, event) => {
  if (event) event.stopPropagation();
  const item = state.historyItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`「${item.item_name}」をリストに再度追加しますか？`)) return;

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
    fetchItems();
  } catch (e) {}
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
    alert('パスワードが違います。');
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
  fetchItems();
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
  
  if (!name) return;

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
    await fetchItems();
  } catch(e) {
    console.error(e);
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
  
  if (!confirm('選択した品物を購入済みにしますか？')) return;

  const ids = Array.from(state.selectedIds);

  try {
    await rpc('mark_as_purchased', { p_item_ids: ids });
    state.isEditMode = false;
    state.selectedIds.clear();
    showToast('購入済みにしました✨');
    await fetchItems();
  } catch (e) {
  }
};

document.getElementById('delete-selected-btn').onclick = async () => {
  if (state.selectedIds.size === 0) return;
  const ids = Array.from(state.selectedIds);
  
  if (!confirm('選択した品物を完全に削除します。よろしいですか？\n（履歴には残りません）')) return;

  try {
    await rpc('delete_item_permanently', { p_item_ids: ids });
    state.isEditMode = false;
    state.selectedIds.clear();
    showToast('完全に削除しました🗑️');
    await fetchItems();
  } catch (e) {
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
    .catch(() => {
      logout();
    });
} else {
  render();
}