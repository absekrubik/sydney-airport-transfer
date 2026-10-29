import { initAdminShell, requireAdmin } from './admin-shell.js';
window.addEventListener('DOMContentLoaded', async () => { initAdminShell(); await requireAdmin(); });
