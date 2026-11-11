// Printable certificate: PNG (canvas) and PDF (jsPDF), both with the verify QR.
import QRCode from 'qrcode';

const W = 1754, H = 1240; // A4 landscape at 150 dpi

export async function qrDataUrl(url, size = 600) {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: size });
}

function fitText(ctx, text, maxW, startPx, weight = '700', family = 'Georgia, serif') {
  let px = startPx;
  do { ctx.font = `${weight} ${px}px ${family}`; px -= 2; } while (ctx.measureText(text).width > maxW && px > 18);
}

/** Draw the certificate on a canvas and return it. */
export async function renderCanvas({ fields, verifyUrl, txHash, network }) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#0b1d3a'; ctx.lineWidth = 14; ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 3; ctx.strokeRect(70, 70, W - 140, H - 140);
  ctx.textAlign = 'center'; ctx.fillStyle = '#0b1d3a';
  ctx.font = '600 40px Helvetica, Arial, sans-serif'; ctx.fillText(fields.issuer.toUpperCase(), W / 2, 190);
  ctx.font = '700 84px Georgia, serif'; ctx.fillText('Certificate of Completion', W / 2, 320);
  ctx.font = '400 36px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#444'; ctx.fillText('This certifies that', W / 2, 410);
  ctx.fillStyle = '#0b1d3a'; fitText(ctx, fields.recipient_name, W - 360, 96); ctx.fillText(fields.recipient_name, W / 2, 530);
  ctx.font = '400 36px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#444'; ctx.fillText('has successfully completed', W / 2, 610);
  ctx.fillStyle = '#0b1d3a'; fitText(ctx, fields.course, W - 360, 64); ctx.fillText(fields.course, W / 2, 700);
  ctx.font = '400 32px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#333';
  const meta = [`Awarded ${fields.date_awarded}`, fields.grade ? `Grade ${fields.grade}` : null, fields.expires ? `Valid until ${fields.expires}` : null, `No. ${fields.cert_no}`].filter(Boolean).join('   ·   ');
  ctx.fillText(meta, W / 2, 780);

  const qr = new Image();
  qr.src = await qrDataUrl(verifyUrl, 360);
  await qr.decode();
  ctx.drawImage(qr, W - 110 - 300, H - 110 - 300, 300, 300);
  ctx.textAlign = 'left'; ctx.fillStyle = '#333'; ctx.font = '600 28px Helvetica, Arial, sans-serif';
  ctx.fillText('Scan to verify on Cardano', 140, H - 330);
  ctx.font = '400 24px Helvetica, Arial, sans-serif';
  ctx.fillText(network === 'mainnet' ? 'Network: Cardano mainnet' : `Network: ${network} (TEST NETWORK, not real-world proof)`, 140, H - 285);
  ctx.fillText(`Tx: ${txHash.slice(0, 20)}…${txHash.slice(-8)}`, 140, H - 250);
  ctx.fillText('Only a salted fingerprint is on-chain. Editing this certificate breaks the check.', 140, H - 215);
  return c;
}

export async function renderPng(args) {
  const c = await renderCanvas(args);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export async function renderPdf(args) {
  const { jsPDF } = await import('jspdf');
  const c = await renderCanvas(args);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210);
  pdf.link(((W - 410) / W) * 297, ((H - 410) / H) * 210, (300 / W) * 297, (300 / H) * 210, { url: args.verifyUrl });
  pdf.setProperties({ title: `Certificate ${args.fields.cert_no}`, subject: `Cardano-stamped certificate (${args.network})` });
  return pdf.output('blob');
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
