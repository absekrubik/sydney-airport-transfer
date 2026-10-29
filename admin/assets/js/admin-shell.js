// Behaviour shared by every admin page: sidebar, profile menu and the sign-in check.
// The server enforces access on every /api/admin route; the redirect below is only a convenience.
import { api, setCsrf, ApiError } from '../../../public/assets/js/api.js';

export function initAdminShell() {
  const sidebar = document.querySelector('.sidebar');
  const scrim = document.querySelector('.scrim');
  const menuBtn = document.querySelector('[data-menu-btn]');
  const profileBtn = document.querySelector('[data-profile-btn]');
  const profileMenu = document.querySelector('.profile-menu');

  const setSidebar = (open) => {
    sidebar.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    menuBtn?.setAttribute('aria-expanded', String(open));
  };
  menuBtn?.addEventListener('click', () => setSidebar(!sidebar.classList.contains('is-open')));
  scrim?.addEventListener('click', () => setSidebar(false));
  profileBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = profileMenu.classList.toggle('is-open');
    profileBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => profileMenu?.classList.remove('is-open'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setSidebar(false); profileMenu?.classList.remove('is-open'); } });

  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    try { await api('POST', '/api/admin/auth/logout'); } catch { /* already signed out */ }
    window.location.href = 'login.html';
  });
}

/** Check the session. Returns the signed-in user, or sends the browser to the sign-in page. */
export async function requireAdmin() {
  try {
    const { user, csrfToken } = await api('GET', '/api/admin/auth/me');
    setCsrf(csrfToken);
    const who = document.getElementById('whoami');
    if (who) who.textContent = `${user.fullName || user.email} (${user.role})`;
    return user;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { window.location.href = 'login.html'; return null; }
    throw e;
  }
}
