async function save() {
  const name = document.getElementById('name').value.trim();
  const content = document.getElementById('content').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!name || !content || !password) { showMsg('请填写所有字段', false); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = '保存中...';
  try {
    const lr = await fetch('/api/admin/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({username:'admin', password}), credentials:'include',
    });
    const ld = await lr.json();
    if (!lr.ok || !ld.csrfToken) { showMsg('密码错误', false); return; }

    const id = 'custom-' + name.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g,'').slice(0,40);
    const body = {
      format: 'payloader.import.v1',
      payloads: [{
        id, name:{zh:name,en:name},
        description:{zh:'自定义: '+name,en:'Custom: '+name},
        category:{zh:'自定义',en:'Custom'},
        tags:['custom'], prerequisites:[],
        execution:[{title:{zh:name,en:name},command:content,description:{zh:'自定义内容',en:'Custom content'},platform:'all'}],
        wafBypass:[],
      }]
    };
    const ir = await fetch('/api/admin/import?mode=merge', {
      method:'POST', headers:{'Content-Type':'application/json','x-payloader-csrf':ld.csrfToken},
      body:JSON.stringify(body), credentials:'include',
    });
    if (!ir.ok) throw new Error('HTTP '+ir.status);
    showMsg('✓ 保存成功！刷新前台页面即可在「自定义」tab 看到', true);
    document.getElementById('name').value = '';
    document.getElementById('content').value = '';
    loadList();
  } catch(e) {
    showMsg('失败：'+e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = '保存';
  }
}

function showMsg(text, ok) {
  const el = document.getElementById('msg');
  el.className = 'msg '+(ok?'msg-ok':'msg-err');
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display='none'; }, 4000);
}

async function loadList() {
  const r = await fetch('/api/public-data');
  const d = await r.json();
  const customs = (d.payloads||[]).filter(p => (p.category?.zh||p.category)==='自定义');
  const el = document.getElementById('list');
  if (!customs.length) { el.innerHTML=''; return; }
  el.innerHTML = '<h2>已有自定义 Payload（'+customs.length+' 条）</h2>' +
    customs.map(p =>
      '<div class="item-row"><span class="item-name">'+(p.name?.zh||p.name)+'</span>' +
      '<button class="btn-del" data-id="'+p.id+'">删除</button></div>'
    ).join('');
}

async function del(id) {
  const password = document.getElementById('password').value.trim();
  if (!password) { showMsg('请先填写密码再删除', false); return; }
  if (!confirm('确认删除？')) return;
  const lr = await fetch('/api/admin/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'admin',password}), credentials:'include',
  });
  const ld = await lr.json();
  if (!ld.csrfToken) { showMsg('密码错误', false); return; }
  await fetch('/api/admin/payloads/'+encodeURIComponent(id), {
    method:'DELETE', headers:{'x-payloader-csrf':ld.csrfToken}, credentials:'include',
  });
  showMsg('已删除', true);
  loadList();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-btn').addEventListener('click', save);
  document.getElementById('back-btn').addEventListener('click', () => { location.href='/admin'; });
  document.getElementById('list').addEventListener('click', e => {
    if (e.target.matches('.btn-del')) del(e.target.dataset.id);
  });
  loadList();
});
