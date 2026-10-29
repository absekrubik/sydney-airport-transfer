import { api, ApiError } from '../../../public/assets/js/api.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const button = document.getElementById('login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  const email = form.elements.email?.value.trim() ?? document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) { errorBox.textContent = 'Enter your email and password.'; errorBox.hidden = false; return; }
  button.disabled = true;
  try {
    await api('POST', '/api/admin/auth/login', { email, password });
    window.location.href = 'dashboard.html';
  } catch (err) {
    errorBox.textContent = err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.';
    errorBox.hidden = false;
    document.getElementById('password').value = '';
  } finally { button.disabled = false; }
});
