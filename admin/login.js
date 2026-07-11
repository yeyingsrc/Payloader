const form = document.getElementById('login-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const statusNode = document.getElementById('login-status');
const submitButton = document.getElementById('login-submit');

const setStatus = (message, tone = '') => {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
};

const setBusy = busy => {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? '正在验证...' : '进入后台';
};

form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = {
    username: username.value.trim(),
    password: password.value,
  };

  if (!payload.username || !payload.password) {
    setStatus('请输入管理员账号和密码', 'error');
    return;
  }

  setBusy(true);
  setStatus('正在建立安全会话...', 'info');
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `登录失败：HTTP ${response.status}`);
    }
    sessionStorage.setItem('payloader-admin-csrf', body.csrfToken || '');
    setStatus('登录成功，正在进入后台...', 'success');
    window.location.replace('/admin');
  } catch (error) {
    password.value = '';
    password.focus();
    setStatus(error instanceof Error ? error.message : '登录失败，请稍后重试', 'error');
  } finally {
    setBusy(false);
  }
});
