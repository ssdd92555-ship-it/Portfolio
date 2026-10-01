# Opera

```
index.html            الصفحة الرئيسية (الملف الوحيد في الجذر مع package.json و vercel.json)
pages/                باقي الصفحات: about, gallery, services, tools, faq, login, register, forgot, 404
assets/
  css/styles.css      التنسيق
  js/                 الناتج بعد الترجمة من TypeScript (يُستخدم في الصفحات، لا تعدّله يدوياً)
  icons/              الأيقونات وصورة المشاركة
  manifest.webmanifest, sw.js   تطبيق PWA والعمل بدون إنترنت
src/                  الكود المصدري (TypeScript)
  main.ts             نقطة البداية
  core/               utils, i18n (كشف اللغة), lang-en (الترجمة), lock (قفل الزوم والتحريك)
  components/         gallery, ui, features, login, auth (نماذج الدخول والتسجيل واستعادة كلمة السر)
  effects/            particles, shapes, robot (مرشد الموقع: روبوت ثلاثي الأبعاد بقائمة اختصارات)
config/tsconfig.json  إعدادات TypeScript
docs/                 هذا الملف
```

بعد تعديل أي ملف في `src` شغّل: `npm i` ثم `npm run build`.
للتجربة المحلية: `npm start` (الوحدات تحتاج خادماً، لا تعمل بفتح الملف مباشرة).

## اللغة
يكشف الموقع لغة الجهاز: عربي → عربي (RTL)، غير ذلك → إنجليزي (LTR). الزر أعلى الصفحة يبدّل يدوياً ويحفظ الاختيار.
النصوص العربية في HTML هي الأصل، وترجمتها الإنجليزية في `src/core/lang-en.ts` (المفتاح هو النص العربي كما هو في الصفحة).
عند إضافة نص جديد في الصفحة أضف ترجمته هناك، وإلا يبقى عربياً في النسخة الإنجليزية.

## ملاحظات النشر
`vercel.json` يضبط صفحة 404 المخصصة وترويسة `Service-Worker-Allowed` لأن `sw.js` داخل `assets/`.
على استضافة غير Vercel قد لا يعمل وضع "بدون إنترنت" (باقي الموقع يعمل عادي).
