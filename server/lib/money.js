// Money is always integer cents. Prices are GST-inclusive: GST is one eleventh of the total.
export const gstFromTotal = (totalCents) => Math.round(totalCents / 11);
export const percentOf = (cents, percent) => Math.round((cents * percent) / 100);
