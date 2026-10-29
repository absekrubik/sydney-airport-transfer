// Shows one booking, read with the private link the customer received when they booked.
import { api, ApiError } from '../api.js';
import { formatMoney, toast, confirmDialog } from '../ui/ui.js';
import { initCommon } from '../common.js';
import { successBurst } from '../motion.js';

const root = document.getElementById('confirm-root');
const params = new URLSearchParams(window.location.search);
const ref = params.get('ref') || '';
const token = params.get('t') || '';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const STATUS_TEXT = {
  pending: 'Request received. We are reviewing it and will confirm it with you.',
  confirmed: 'Confirmed. Your transfer is booked.',
  declined: 'We could not accept this booking. Please contact us.',
  cancelled: 'This booking has been cancelled.',
  completed: 'This trip is complete.',
};

function notFound(message) {
  root.replaceChildren(el('h1', '', 'We could not find that booking.'), el('p', 'text-muted', message || 'Check the link you were given, or contact us with your reference.'));
  const a = el('a', 'btn btn--primary', 'Start a new booking'); a.href = 'booking.html'; root.appendChild(el('p')).appendChild(a);
}

let paying = false;
function renderPayment(b) {
  const p = b.payment; if (!p) return;
  const box = el('section', 'card pay-box');
  if (p.canPay) {
    box.appendChild(el('h2', '', p.label === 'Pay deposit' ? 'Pay your deposit' : 'Pay online'));
    box.appendChild(el('p', 'text-muted', p.label === 'Pay deposit'
      ? `Your deposit is ${formatMoney(p.dueCents)}. You pay the rest (${formatMoney(p.remainingCents - p.dueCents)}) to the driver. Card details are entered on Stripe’s secure page; we never see them.`
      : `${formatMoney(p.dueCents)} by card. Card details are entered on Stripe’s secure page; we never see them.`));
    const btn = el('button', 'btn btn--primary', `${p.label} ${formatMoney(p.dueCents)}`); btn.type = 'button';
    btn.addEventListener('click', async () => {
      if (paying) return; paying = true; btn.disabled = true; btn.textContent = 'Taking you to Stripe…';
      try { const out = await api('POST', `/api/bookings/${encodeURIComponent(ref)}/pay`, { t: token }); window.location.href = out.url; }
      catch (e) { toast(e.message, 'error'); paying = false; btn.disabled = false; btn.textContent = `${p.label} ${formatMoney(p.dueCents)}`; }
    });
    box.appendChild(btn);
    if (p.awaiting) box.appendChild(el('p', 'text-muted', 'We are still waiting to hear back from your last payment attempt. If you already paid, this page updates in a moment.'));
  } else if (['card_online', 'deposit'].includes(b.paymentPreference) && !p.stripeReady && p.netPaidCents === 0 && ['pending', 'confirmed'].includes(b.status)) {
    box.appendChild(el('h2', '', 'Payment'));
    box.appendChild(el('p', 'text-muted', 'Online card payment is not available at the moment. We will contact you to arrange payment.'));
  } else if (p.netPaidCents > 0 && p.remainingCents === 0 && ['pending', 'confirmed', 'completed'].includes(b.status)) {
    box.appendChild(el('h2', '', 'Paid in full'));
    box.appendChild(el('p', 'text-muted', `Thank you. We received ${formatMoney(p.netPaidCents)}.`));
  } else if (b.status === 'cancelled' || b.status === 'declined') {
    if (p.refundedCents) box.appendChild(el('p', '', `Refunded to your card: ${formatMoney(p.refundedCents)}. It can take 5 to 10 business days to appear.`));
    else if (p.paidCents) box.appendChild(el('p', 'text-muted', 'We are processing your refund. If you do not see it within a few days, please contact us.'));
    if (p.feeOwedCents) box.appendChild(el('p', 'text-muted', `A cancellation fee of ${formatMoney(p.feeOwedCents)} is still owing. We will contact you.`));
    if (!box.children.length) return;
  } else return;
  root.appendChild(box);
}

function render(b) {
  root.replaceChildren();
  const head = el('div', 'confirm');
  if (['pending', 'confirmed', 'completed'].includes(b.status)) head.appendChild(successBurst(b.status === 'pending' ? '' : 'ok'));
  head.append(el('p', 'eyebrow', 'Booking reference'), el('h1', '', b.reference), el('p', '', STATUS_TEXT[b.status] || b.status));
  const badge = el('span', `badge badge--${b.status}`, b.status.replace('_', ' ')); head.appendChild(badge);
  head.appendChild(el('p', 'text-muted', 'Keep this page’s link: it is how you view, pay for or cancel your booking. We do not email it in this version.'));
  root.appendChild(head);

  const dl = el('dl', 'review');
  const add = (t, v) => { dl.append(el('dt', '', t), el('dd', '', v || '—')); };
  add('Name', b.customerName); add('Vehicle', b.vehicle);
  add('Party', `${b.passengers} ${b.passengers === 1 ? 'passenger' : 'passengers'}, ${b.luggage} ${b.luggage === 1 ? 'bag' : 'bags'}${b.childSeats ? `, ${b.childSeats} child ${b.childSeats === 1 ? 'seat' : 'seats'}` : ''}`);
  if (b.flight) add('Flight', b.flight);
  b.legs.forEach((l) => add(b.legs.length > 1 ? (l.type === 'return' ? 'Return trip' : 'Outbound trip') : 'Trip', `${l.pickupLocal}: ${l.from} to ${l.to}`));
  if (b.notes) add('Your notes', b.notes);
  add('Payment', { card_online: 'Online by card', deposit: 'Deposit online, balance to the driver', cash_to_driver: 'Pay the driver' }[b.paymentPreference] || b.paymentPreference);
  add('Payment status', b.paymentStatus.replace('_', ' '));
  if (b.payment?.netPaidCents) add('Paid so far', formatMoney(b.payment.netPaidCents));
  root.appendChild(dl);

  const lines = el('ul', 'quote-lines');
  b.quote.lines.forEach((l) => { const li = el('li'); li.append(el('span', '', l.label), el('span', '', formatMoney(l.cents))); lines.appendChild(li); });
  const total = el('div', 'quote-total'); total.append(el('span', '', 'Total'), el('span', '', formatMoney(b.quote.total)));
  root.append(lines, total, el('div', 'quote-gst', `Includes GST of ${formatMoney(b.quote.gst)}${b.business.abn ? `. ABN ${b.business.abn}` : ''}`));
  if (b.quote.sample) root.appendChild(el('p', 'alert alert--dev', 'Development preview: this fare is sample data.'));

  renderPayment(b);
  if (b.status === 'cancelled' && b.cancellation.feeCentsCharged) root.appendChild(el('p', 'text-muted', `Cancellation fee: ${formatMoney(b.cancellation.feeCentsCharged)}.`));
  if (b.cancellation.allowed) {
    const fee = b.cancellation.feeCents;
    root.appendChild(el('p', 'text-muted', fee ? `Your driver is on the way, so cancelling now costs ${formatMoney(fee)} (${b.cancellation.feePercent}% of the fare).` : 'You can cancel for free until your driver is on the way.'));
    const btn = el('button', 'btn btn--ghost', 'Cancel booking'); btn.type = 'button';
    btn.addEventListener('click', async () => {
      const yes = await confirmDialog({ title: 'Cancel this booking?', message: fee ? `A cancellation fee of ${formatMoney(fee)} applies.` : 'This cannot be undone.', confirmLabel: fee ? 'Cancel and accept the fee' : 'Yes, cancel', danger: true });
      if (!yes) return;
      btn.disabled = true;
      try { await api('POST', `/api/bookings/${encodeURIComponent(ref)}/cancel`, { t: token, acceptFee: fee > 0 }); toast('Your booking is cancelled.', 'success'); load(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    });
    root.appendChild(btn);
  } else if (b.cancellation.reason && !['cancelled', 'declined', 'completed'].includes(b.status)) root.appendChild(el('p', 'text-muted', b.cancellation.reason));
  const contact = [b.business.phone && `call ${b.business.phone}`, b.business.email && `email ${b.business.email}`].filter(Boolean).join(' or ');
  root.appendChild(el('p', 'text-muted', contact ? `Questions? You can ${contact}, or use the contact page.` : 'Questions? Use the contact page.'));
}

const fetchBooking = () => api('GET', `/api/bookings/${encodeURIComponent(ref)}?t=${encodeURIComponent(token)}`);

async function load() {
  if (!ref || !token) { notFound('This page needs the private link from your booking.'); return; }
  try {
    let b = await fetchBooking();
    // Just back from Stripe: confirm the payment with Stripe, then wait briefly for it to show.
    if (params.get('paid') === '1' && b.payment && b.paymentStatus !== 'paid' && b.payment.netPaidCents < b.payment.totalCents) {
      root.replaceChildren(el('p', 'text-muted', 'Confirming your payment…'));
      for (let i = 0; i < 6; i += 1) {
        try { await api('POST', `/api/bookings/${encodeURIComponent(ref)}/pay/sync`, { t: token }); } catch { /* try again */ }
        b = await fetchBooking();
        if (b.payment.netPaidCents > 0 && !b.payment.awaiting) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      history.replaceState(null, '', `confirmation.html?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`);
      if (b.payment.netPaidCents > 0) toast('Payment received. Thank you!', 'success');
    }
    render(b);
  } catch (e) { notFound(e instanceof ApiError && e.status === 404 ? '' : e.message); }
}

window.addEventListener('DOMContentLoaded', () => { load(); initCommon(); });
