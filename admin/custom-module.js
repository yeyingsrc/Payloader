document.addEventListener('DOMContentLoaded', () => {
  const workspace = document.querySelector('.workspace');
  let panel = null;
  let editingId = null;

  function getCsrf() {
    return sessionStorage.getItem('payloader-admin-csrf') || '';
  }

  function buildPanel() {
    const d = document.createElement('div');
    d.className = 'workspace custom-payload-workspace';
    d.style.cssText = 'display:flex;height:100%;overflow:hidden;';
    d.innerHTML = `
      <style>
        #cp-form { width:380px;flex-shrink:0;border-right:1px solid var(--border);padding:32px 28px;overflow-y:auto;display:flex;flex-direction:column;gap:16px; }
        #cp-form h3 { font-size:18px;font-weight:700;margin:0 0 2px;color:var(--text); }
        #cp-form p { font-size:13px;opacity:.6;margin:0;color:var(--text); }
        .cp-label { font-size:13px;font-weight:600;color:var(--text);margin-bottom:5px;display:block;opacity:.8; }
        .cp-input { width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box; }
        .cp-input:focus-visible { outline:2px solid var(--accent);outline-offset:2px;border-color:var(--accent); }
        #cp-content { min-height:240px;resize:vertical;font-family:monospace;line-height:1.6;font-size:13px; }
        #cp-btns { display:flex;gap:10px;margin-top:4px; }
        #cp-save { flex:1;min-height:44px;padding:11px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:15px; }
        #cp-cancel { display:none;min-height:44px;padding:11px 18px;background:transparent;border:1px solid var(--border);color:var(--text);border-radius:6px;cursor:pointer;font-size:14px; }
        #cp-msg { display:none;padding:10px 14px;border-radius:6px;font-size:14px;margin-top:4px; }
        #cp-list-panel { flex:1;padding:32px 36px;overflow-y:auto; }
        #cp-list-panel h3 { font-size:18px;font-weight:700;margin:0 0 20px;color:var(--text); }
        .cp-card { display:flex;align-items:flex-start;gap:16px;padding:18px;border:1px solid var(--border);border-radius:8px;margin-bottom:14px; }
        .cp-card-info { flex:1;min-width:0; }
        .cp-card-name { font-size:16px;font-weight:600;color:var(--text);margin-bottom:5px; }
        .cp-card-preview { font-size:13px;opacity:.5;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:monospace; }
        .cp-card-actions { display:flex;gap:8px;flex-shrink:0;margin-top:2px; }
        .cp-btn-edit { min-height:44px;padding:7px 16px;border:1px solid var(--border);color:var(--text);border-radius:5px;cursor:pointer;font-size:13px;font-weight:600;background:transparent; }
        .cp-btn-del { min-height:44px;padding:7px 16px;border:1px solid rgba(240,93,114,.5);color:#f05d72;border-radius:5px;cursor:pointer;font-size:13px;font-weight:600;background:transparent; }
        .cp-empty { padding:60px 0;text-align:center;opacity:.5;color:var(--text);font-size:15px; }
        @media (max-width:860px) {
          .custom-payload-workspace { flex-direction:column;overflow-y:auto !important; }
          #cp-form { width:100%;flex:0 0 auto;border-right:0;border-bottom:1px solid var(--border);padding:20px 16px;overflow:visible; }
          #cp-list-panel { flex:0 0 auto;width:100%;padding:20px 16px;overflow:visible; }
          .cp-card { flex-direction:column; }
          .cp-card-actions { width:100%; }
          .cp-card-actions button { flex:1; }
        }
      </style>

      <div id="cp-form">
        <div>
          <h3 id="cp-title-h">新增自定义文本</h3>
          <p>保存后在前台「自定义文本」栏目显示</p>
        </div>
        <div>
          <label class="cp-label" for="cp-name">标题</label>
          <input id="cp-name" class="cp-input" type="text" placeholder="例：SQL注入速查表" />
        </div>
        <div style="flex:1;display:flex;flex-direction:column;">
          <label class="cp-label" for="cp-content">内容（纯文本 / Markdown）</label>
          <textarea id="cp-content" class="cp-input" placeholder="粘贴你的内容..."></textarea>
        </div>
        <div id="cp-btns">
          <button id="cp-save" type="button">保存</button>
          <button id="cp-cancel" type="button">取消编辑</button>
        </div>
        <div id="cp-msg" role="status" aria-live="polite"></div>
      </div>

      <div id="cp-list-panel">
        <h3>已添加 <span id="cp-count" style="font-weight:400;font-size:14px;color:var(--text-secondary);">加载中...</span></h3>
        <div id="cp-list"></div>
      </div>
    `;
    return d;
  }

  function showMsg(text, ok) {
    const el = document.getElementById('cp-msg');
    el.style.cssText = `display:block;padding:10px 14px;border-radius:6px;font-size:14px;
      background:${ok?'rgba(0,180,80,.1)':'rgba(220,50,50,.1)'};
      color:${ok?'#00aa55':'#cc3333'};
      border:1px solid ${ok?'rgba(0,180,80,.3)':'rgba(220,50,50,.3)'};`;
    el.textContent = text;
    setTimeout(() => { el.style.display='none'; }, 4000);
  }

  async function doSave() {
    const name = document.getElementById('cp-name').value.trim();
    const content = document.getElementById('cp-content').value.trim();
    if (!name || !content) { showMsg('请填写标题和内容', false); return; }
    const csrf = getCsrf();
    if (!csrf) { showMsg('会话已过期，请重新登录', false); return; }
    const btn = document.getElementById('cp-save');
    btn.disabled = true; btn.textContent = '保存中...';
    try {
      const id = editingId || ('custom-' + name.toLowerCase().replace(/[^\w一-鿿]+/g,'-').replace(/^-|-$/g,'').slice(0,40));
      const res = await fetch('/api/admin/import?mode=merge', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-payloader-csrf':csrf},
        body: JSON.stringify({format:'payloader.import.v1',payloads:[{
          id, name:{zh:name,en:name}, description:{zh:'自定义: '+name,en:'Custom: '+name},
          category:{zh:'自定义',en:'Custom'}, tags:['custom'], prerequisites:[],
          execution:[{title:{zh:name,en:name},command:content,description:{zh:'自定义内容',en:'Custom content'},platform:'all'}],
          wafBypass:[],
        }]}),
        credentials:'include',
      });
      if (!res.ok) throw new Error('HTTP '+res.status);
      showMsg(editingId ? '✓ 修改成功' : '✓ 保存成功！刷新前台即可看到', true);
      cancelEdit(); loadList();
    } catch(e) { showMsg('失败：'+e.message, false); }
    finally { btn.disabled=false; btn.textContent='保存'; }
  }

  function cancelEdit() {
    editingId = null;
    document.getElementById('cp-name').value = '';
    document.getElementById('cp-content').value = '';
    document.getElementById('cp-title-h').textContent = '新增自定义文本';
    document.getElementById('cp-cancel').style.display = 'none';
  }

  function startEdit(id, name, content) {
    editingId = id;
    document.getElementById('cp-name').value = name;
    document.getElementById('cp-content').value = content;
    document.getElementById('cp-title-h').textContent = '编辑：' + name;
    document.getElementById('cp-cancel').style.display = 'inline-block';
    document.getElementById('cp-name').focus();
  }

  async function loadList() {
    try {
      const r = await fetch('/api/public-data');
      const d = await r.json();
      const customs = (d.payloads||[]).filter(p=>(p.category?.zh||p.category)==='自定义');
      const countEl = document.getElementById('cp-count');
      const listEl = document.getElementById('cp-list');
      if (!countEl || !listEl) return;
      countEl.textContent = customs.length ? `共 ${customs.length} 条` : '';
      if (!customs.length) {
        const empty = document.createElement('div');
        empty.className = 'cp-empty';
        empty.textContent = '还没有自定义文本，从左侧表单添加';
        listEl.replaceChildren(empty);
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const payload of customs) {
        const name = String(payload.name?.zh || payload.name || '未命名');
        const content = String(payload.execution?.[0]?.command || '');
        const preview = content.slice(0, 100).replace(/\n/g, ' ');
        const card = document.createElement('div');
        const info = document.createElement('div');
        const title = document.createElement('div');
        const previewElement = document.createElement('div');
        const actions = document.createElement('div');
        const edit = document.createElement('button');
        const remove = document.createElement('button');

        card.className = 'cp-card';
        info.className = 'cp-card-info';
        title.className = 'cp-card-name';
        previewElement.className = 'cp-card-preview';
        actions.className = 'cp-card-actions';
        edit.className = 'cp-btn-edit';
        remove.className = 'cp-btn-del';
        edit.type = 'button';
        remove.type = 'button';
        title.textContent = name;
        previewElement.textContent = `${preview}${content.length > 100 ? '…' : ''}`;
        edit.textContent = '编辑';
        remove.textContent = '删除';
        edit.dataset.edit = String(payload.id || '');
        edit.dataset.name = name;
        edit.dataset.content = content;
        remove.dataset.del = String(payload.id || '');

        info.append(title, previewElement);
        actions.append(edit, remove);
        card.append(info, actions);
        fragment.append(card);
      }
      listEl.replaceChildren(fragment);
    } catch (error) {
      showMsg(`加载失败：${error instanceof Error ? error.message : String(error)}`, false);
    }
  }

  async function doDel(id) {
    const csrf = getCsrf();
    if (!csrf) { showMsg('会话已过期，请重新登录', false); return; }
    if (!confirm('确认删除？')) return;
    try {
      const response = await fetch('/api/admin/payloads/'+encodeURIComponent(id),{method:'DELETE',headers:{'x-payloader-csrf':csrf},credentials:'include'});
      if (!response.ok) { showMsg(`删除失败：HTTP ${response.status}`, false); return; }
      showMsg('已删除', true);
      if (editingId===id) cancelEdit();
      loadList();
    } catch (error) {
      showMsg(`删除失败：${error instanceof Error ? error.message : String(error)}`, false);
    }
  }

  function showCustom() {
    if (!panel) {
      panel = buildPanel();
      panel.querySelector('#cp-save').addEventListener('click', doSave);
      panel.querySelector('#cp-cancel').addEventListener('click', cancelEdit);
      panel.addEventListener('click', e => {
        const action = e.target instanceof Element ? e.target.closest('button[data-del], button[data-edit]') : null;
        if (!(action instanceof HTMLButtonElement)) return;
        if (action.dataset.del) doDel(action.dataset.del);
        if (action.dataset.edit) startEdit(action.dataset.edit, action.dataset.name || '', action.dataset.content || '');
      });
    }
    workspace.style.display = 'none';
    if (!panel.parentNode) workspace.parentNode.insertBefore(panel, workspace.nextSibling);
    panel.style.display = 'flex';
    panel.style.height = `calc(100vh - ${document.querySelector('.topbar')?.offsetHeight || 74}px)`;
    panel.style.overflow = 'hidden';
    document.getElementById('module-title').textContent = '自定义 Payload';
    const HIDE_IDS = ['save-current','cancel-current','save-state','new-item','move-up','move-down','delete-item','open-import','reset-module','reset-all'];
    HIDE_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    document.querySelectorAll('.top-actions, .maintenance-group').forEach(el => el.style.display = 'none');
    loadList();
  }

  function hideCustom() {
    if (panel) panel.style.display = 'none';
    workspace.style.display = '';
    const HIDE_IDS = ['save-current','cancel-current','save-state','new-item','move-up','move-down','delete-item','open-import','reset-module','reset-all'];
    HIDE_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
    document.querySelectorAll('.top-actions, .maintenance-group').forEach(el => el.style.display = '');
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.module-btn');
    if (!btn) return;
    if (btn.dataset.module === 'custom') {
      e.stopImmediatePropagation();
      // manually sync active class since admin.js won't run
      document.querySelectorAll('.module-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showCustom();
    } else {
      hideCustom();
    }
  }, true);
});
