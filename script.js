// ==========================================
// 1. 設定・初期化
// ==========================================

const SUPABASE_URL = 'https://yjtpmjhrjqbimcjztait.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mclvJ1Tcf_e7lS3ufORyug_j7JZWn0G';

const { createClient } = window.supabase;
const dbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 新しいカテゴリ構成に差し替え
const CATEGORIES = [
  { id: 'veg', name: '野菜系', icon: '🥦', colorClass: 'c-veg', hex: '#2ecc71' },
  { id: 'fruit', name: '果物系', icon: '🍊', colorClass: 'c-fruit', hex: '#e67e22' },
  { id: 'meat', name: '肉類', icon: '🥩', colorClass: 'c-meat', hex: '#e74c3c' },
  { id: 'fish', name: '魚介', icon: '🐟', colorClass: 'c-fish', hex: '#3498db' },
  { id: 'soy', name: '大豆製品', icon: '🫘', colorClass: 'c-soy', hex: '#a0522d' },
  { id: 'egg_dairy', name: '卵・乳製品', icon: '🥚', colorClass: 'c-egg', hex: '#f1c40f' },
  { id: 'grains', name: '穀類', icon: '🌾', colorClass: 'c-staple', hex: '#f39c12' },
  { id: 'seasoning', name: '調味料', icon: '🧂', colorClass: 'c-seasoning', hex: '#9b59b6' },
  { id: 'frozen', name: '冷凍食品', icon: '🧊', colorClass: 'c-frozen', hex: '#34495e' },
  { id: 'daily', name: '日用品', icon: '🧼', colorClass: 'c-daily', hex: '#1abc9c' },
  { id: 'other', name: 'その他', icon: '🏷️', colorClass: 'c-other', hex: '#95a5a6' }
];

let state = {
  password: localStorage.getItem('app_password') || '',
  userName: '',
  items: [],
  trashItems: [],
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
    showToast('同期に失敗しました', 'error');
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
    
    if (state.currentCategory === 'trash') {
      const trashData = await rpc('get_trash_items');
      state.trashItems = trashData || [];
    }

    if (state.currentCategory && state.currentCategory !== 'trash') {
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
  document.getElementById('main-view').classList.remove('hidden');
  document.getElementById('user-badge').textContent = `ログイン中: ${state.userName}`;
  
  const container = document.getElementById('category-list');
  const scrollTop = container.scrollTop;
  container.innerHTML = '';

  // 一番上に「すべての品物」カードを特別に作る
  const totalItemsCount = state.items.length;
  const hasAnyUnread = state.items.some(item => 
    !state.readItemIds.has(item.id) && item.created_by !== state.userName
  );
  const allUnreadBadge = hasAnyUnread ? `<span class="unread-badge">New!</span>` : '';

  const allDiv = document.createElement('div');
  allDiv.className = 'list-item';
  allDiv.style.border = '2px solid var(--accent)'; // 特別感を出すために緑色の枠線をつける
  allDiv.onclick = () => {
    state.items.forEach(item => state.readItemIds.add(item.id));
    saveReadItems();
    
    state.currentCategory = 'all'; // 特殊なカテゴリ名として 'all' をセット
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
  // 🔥 追加ここまで

  // 品物数が多い順にカテゴリを並べ替え
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
  document.getElementById('detail-view').classList.remove('hidden');
  const container = document.getElementById('item-list');
  const scrollTop = container.scrollTop;
  
  const isTrash = state.currentCategory === 'trash';
  const isAll = state.currentCategory === 'all';
  
  // タイトルの出し分け
  if (isTrash) document.getElementById('detail-title').textContent = '🗑️ ゴミ箱';
  else if (isAll) document.getElementById('detail-title').textContent = '📋 すべての品物';
  else document.getElementById('detail-title').textContent = state.currentCategory;
  
  const editBtn = document.getElementById('edit-mode-btn');
  const addForm = document.getElementById('add-form');
  const editActions = document.getElementById('edit-actions');
  const delBtn = document.getElementById('delete-selected-btn');

  if (isTrash || isAll) {
    editBtn.classList.remove('hidden');
    addForm.classList.add('hidden');
    delBtn.textContent = isTrash ? '完全に削除する' : 'ゴミ箱へ移動';
  } else {
    editBtn.classList.remove('hidden');
    addForm.classList.toggle('hidden', state.isEditMode);
    delBtn.textContent = 'ゴミ箱へ移動';
  }

  editActions.classList.toggle('hidden', !state.isEditMode);
  editBtn.textContent = state.isEditMode ? '完了' : '編集';

  container.innerHTML = '';
  
  // ターゲットアイテムの出し分け
  let targetItems;
  if (isTrash) {
    targetItems = state.trashItems;
  } else if (isAll) {
    // アプリの一番上で定義されている「CATEGORIES」の並び順の通りに美しくソートする
    targetItems = [...state.items].sort((a, b) => {
      const indexA = CATEGORIES.findIndex(c => c.name === a.category);
      const indexB = CATEGORIES.findIndex(c => c.name === b.category);
      return indexA - indexB;
    });
  } else {
    targetItems = state.items.filter(i => i.category === state.currentCategory);
  }

  if (targetItems.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);">品物はありません</div>`;
    return;
  }

  // カテゴリの区切りを分かりやすくするための目印用変数
  let lastCategory = null;

  targetItems.forEach(item => {
    // 「すべての品物」画面の時、カテゴリが変わる瞬間に小さな見出し（ヘッダー）を自動挿入する
    if (isAll && item.category !== lastCategory) {
      lastCategory = item.category;
      const catObj = CATEGORIES.find(c => c.name === item.category);
      
      const divider = document.createElement('div');
      divider.style = 'padding: 14px 4px 6px 4px; font-size: 0.85rem; font-weight: bold; color: var(--text-main); display: flex; align-items: center; gap: 6px;';
      divider.innerHTML = `<span>${catObj ? catObj.icon : '🏷️'}</span> ${item.category}`;
      container.appendChild(divider);
    }

    const div = document.createElement('div');
    div.className = 'detail-row';
    const timeStr = isTrash ? formatDate(item.deleted_at) : formatDate(item.created_at);
    
    let checkboxHtml = '';
    if (state.isEditMode) {
      const isChecked = state.selectedIds.has(item.id) ? 'checked' : '';
      checkboxHtml = `<input type="checkbox" value="${item.id}" ${isChecked} onchange="toggleSelect('${item.id}', this.checked)">`;
    }

    // カテゴリごとに設定されている固有の色（hex）を自動で引っ張ってきて、カラフルなバッジにする
    const catObj = CATEGORIES.find(c => c.name === item.category);
    const badgeColor = catObj ? catObj.hex : '#95a5a6';
    const categoryBadge = isAll ? `<span style="font-size: 0.7rem; background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 20px; margin-left: 8px; font-weight: bold; vertical-align: middle;">${item.category}</span>` : '';

    div.innerHTML = `
      ${checkboxHtml}
      <div class="detail-info" onclick="${state.isEditMode ? `document.querySelector('input[value=\"${item.id}\"]').click()` : ''}">
        <h4>${item.item_name} ${categoryBadge}</h4>
        <p>追加: ${item.created_by} (${timeStr})</p>
      </div>
      <div class="detail-qty">×${item.quantity}</div>
    `;
    container.appendChild(div);
  });

  container.scrollTop = scrollTop;
  updateSelectCount();
};

// ==========================================
// 4. イベントハンドラ・各種アクション
// ==========================================
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

document.getElementById('go-trash-btn').onclick = () => {
  state.currentCategory = 'trash';
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
  const input = document.getElementById('new-item-name');
  const name = input.value.trim();
  if (!name) return;

  const btn = document.getElementById('add-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    await rpc('add_item', {
      p_item_name: name,
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

    input.value = '';
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
  const isTrash = state.currentCategory === 'trash';
  const targetItems = isTrash ? state.trashItems : state.items.filter(i => i.category === state.currentCategory);
  
  if (e.target.checked) targetItems.forEach(i => state.selectedIds.add(i.id));
  else state.selectedIds.clear();
  renderItemList();
};

const updateSelectCount = () => {
  document.getElementById('selected-count').textContent = `${state.selectedIds.size}件選択中`;
};

document.getElementById('delete-selected-btn').onclick = async () => {
  if (state.selectedIds.size === 0) return;
  const ids = Array.from(state.selectedIds);
  const isTrash = state.currentCategory === 'trash';
  const fn = isTrash ? 'delete_item_permanently' : 'move_to_trash';
  const confirmMsg = isTrash ? '一括で完全に削除します。復元できませんがよろしいですか？' : '選択した品物をゴミ箱へ移動しますか？';

  if (!confirm(confirmMsg)) return;

  try {
    await rpc(fn, { p_item_ids: ids });
    state.isEditMode = false;
    state.selectedIds.clear();
    showToast(isTrash ? '完全に削除しました' : 'ゴミ箱に移動しました');
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