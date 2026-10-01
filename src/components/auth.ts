import { $, RM } from '../core/utils.js';
import { t } from '../core/i18n.js';

const AU_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** اهتزاز النموذج عند الخطأ (يُلغى لمن يفضّل تقليل الحركة) */
function shake(form: HTMLElement): void {
  form.classList.remove('shake'); void form.offsetWidth; if (!RM) form.classList.add('shake');
}

/** أزرار العين (data-eye): إظهار/إخفاء الحقل المجاور */
function wireEyes(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('.eye[data-eye]').forEach(btn => {
    const inp = btn.parentElement?.querySelector('input');
    if (!inp) return;
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.onclick = () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', t(show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'));
    };
  });
}

/** تحقق مباشر من صيغة البريد: يظهر التنبيه بعد مغادرة الحقل (بتأخير قصير كي لا تنزاح الأزرار تحت الإصبع) */
function wireEmail(em: HTMLInputElement, hint: HTMLElement): void {
  let touched = false;
  const paint = () => {
    const v = em.value.trim(), ok = AU_EMAIL.test(v), bad = touched && !!v && !ok;
    em.classList.toggle('bad', bad); em.classList.toggle('good', !!v && ok);
    em.setAttribute('aria-invalid', String(bad));
    hint.textContent = bad ? t('صيغة البريد الإلكتروني غير صحيحة.') : '';
  };
  em.addEventListener('input', () => { if (AU_EMAIL.test(em.value.trim())) touched = true; paint(); });
  em.addEventListener('blur', () => setTimeout(() => { if (document.activeElement === em) return; touched = true; paint(); }, 180));
  em.addEventListener('paintnow', () => { touched = true; paint(); });
}

/** إرسال تجريبي: مؤشر تحميل ثم رسالة (لا يوجد خادم بعد) */
function demoSend(go: HTMLButtonElement, msg: HTMLElement): void {
  go.disabled = true; go.classList.add('ld'); msg.textContent = '';
  setTimeout(() => {
    go.disabled = false; go.classList.remove('ld');
    msg.textContent = t('هذه واجهة تجريبية: لا يوجد خادم بعد.');
  }, 1100);
}

function fail(form: HTMLElement, msg: HTMLElement, field: HTMLElement, text: string): void {
  msg.textContent = t(text); shake(form); field.focus();
}

/** قوة كلمة المرور من 1 إلى 4 (0 إذا كانت فارغة) */
function strength(v: string): number {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v) || v.length >= 14) s++;
  return Math.max(1, s);
}

function initRegister(form: HTMLFormElement): void {
  const nm = $('rgn') as HTMLInputElement, em = $('rge') as HTMLInputElement;
  const pw = $('rgp') as HTMLInputElement, cf = $('rgc') as HTMLInputElement, tr = $('rgt') as HTMLInputElement;
  const hCf = $('rgch'), msg = $('lgm'), sw = $('rgsw'), bar = $('rgsb'), lab = $('rgst');
  const go = form.querySelector('button[type=submit]') as HTMLButtonElement;
  let tCf = false, busy = false;
  wireEyes(form); wireEmail(em, $('rgeh'));

  const paintCf = () => {
    const bad = tCf && !!cf.value && cf.value !== pw.value;
    cf.classList.toggle('bad', bad); cf.classList.toggle('good', !!cf.value && cf.value === pw.value);
    hCf.textContent = bad ? t('كلمتا المرور غير متطابقتين.') : '';
  };
  pw.addEventListener('input', () => {
    const s = strength(pw.value);
    sw.hidden = !s; bar.dataset.s = String(s);
    lab.textContent = s ? t(['', 'ضعيفة', 'متوسطة', 'جيدة', 'قوية'][s]) : '';
    paintCf();
  });
  cf.addEventListener('input', () => { tCf = true; paintCf(); });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy) return;
    em.dispatchEvent(new Event('paintnow')); tCf = true; paintCf();
    if (!nm.value.trim()) return fail(form, msg, nm, 'أدخل اسمك.');
    if (!AU_EMAIL.test(em.value.trim())) return fail(form, msg, em, 'أدخل بريداً إلكترونياً صحيحاً.');
    if (pw.value.length < 8) return fail(form, msg, pw, 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
    if (cf.value !== pw.value) return fail(form, msg, cf, 'كلمتا المرور غير متطابقتين.');
    if (!tr.checked) return fail(form, msg, tr, 'وافق على الشروط للمتابعة.');
    busy = true; demoSend(go, msg); setTimeout(() => { busy = false; }, 1100);
  });
}

function initForgot(form: HTMLFormElement): void {
  const em = $('fge') as HTMLInputElement, msg = $('lgm');
  const go = form.querySelector('button[type=submit]') as HTMLButtonElement;
  let busy = false;
  wireEmail(em, $('fgeh'));
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy) return;
    em.dispatchEvent(new Event('paintnow'));
    if (!AU_EMAIL.test(em.value.trim())) return fail(form, msg, em, 'أدخل بريداً إلكترونياً صحيحاً.');
    busy = true; demoSend(go, msg); setTimeout(() => { busy = false; }, 1100);
  });
  if (matchMedia('(pointer:fine)').matches) em.focus();
}

/** صفحتا «مستخدم جديد» و«نسيت كلمة السر» (واجهة فقط، لا يوجد خادم) */
export function initAuth(): void {
  const rg = document.getElementById('rgf') as HTMLFormElement | null;
  const fg = document.getElementById('fgf') as HTMLFormElement | null;
  if (rg) initRegister(rg);
  if (fg) initForgot(fg);
}
