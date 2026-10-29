import { setFieldError, focusFirstError, toast } from '../ui/ui.js';
import { api, ApiError } from '../api.js';
import { initCommon } from '../common.js';

const form = document.getElementById('contact-form');
const params = new URLSearchParams(window.location.search);
const isQuote = params.get('topic') === 'quote';
const tripDetails = isQuote ? { from: params.get('from') || '', to: params.get('to') || '', when: params.get('when') || '', party: params.get('party') || '' } : null;

function prefillFromQuoteRequest() {
  if (!isQuote) return;
  const parts = [`Quote request: ${tripDetails.from || '?'} to ${tripDetails.to || '?'}`];
  if (tripDetails.when) parts.push(`on ${tripDetails.when}`);
  if (tripDetails.party) parts.push(`for ${tripDetails.party}`);
  form.elements.message.value = `${parts.join(' ')}.`;
}

function validate() {
  let ok = true;
  ['name', 'email', 'message'].forEach((n) => setFieldError(form.elements[n], ''));
  if (!form.elements.name.value.trim()) { setFieldError(form.elements.name, 'Enter your name'); ok = false; }
  const email = form.elements.email.value.trim();
  if (!email) { setFieldError(form.elements.email, 'Enter your email'); ok = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError(form.elements.email, 'Check your email address'); ok = false; }
  if (!form.elements.message.value.trim()) { setFieldError(form.elements.message, 'Tell us how we can help'); ok = false; }
  return ok;
}

window.addEventListener('DOMContentLoaded', () => {
  prefillFromQuoteRequest();
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) { focusFirstError(form); return; }
    button.disabled = true;
    try {
      await api('POST', '/api/contact', {
        name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), phone: form.elements.phone.value.trim(),
        message: form.elements.message.value.trim(), topic: isQuote ? 'quote' : 'general', tripDetails, website: form.elements.website.value,
      });
      form.reset();
      toast('Thanks. We have your message and will reply by email or phone.', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.fields) Object.entries(err.fields).forEach(([k, m]) => form.elements[k] && setFieldError(form.elements[k], m));
      focusFirstError(form); toast(err.message, 'error');
    } finally { button.disabled = false; }
  });
  initCommon();
});
