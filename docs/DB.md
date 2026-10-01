# قاعدة بيانات Opera

SQLite عبر `node:sqlite` (يحتاج Node 22.5+). الترحيلات في `db/migrations` وتُطبَّق تلقائياً داخل معاملات.

## التشغيل
```
npm run db:init   # ينشئ db/opera.db ويطبّق كل الترحيلات
npm run db:test   # 110 اختبارات (القديمة + الميزات)
```
مسار القاعدة يتغير بالمتغير `DB_FILE`.

## المالك الوحيد
القاعدة تحفظ مستخدماً واحداً فقط: `grykj249@gmail.com` (دور admin + developer). كلمة السر مخزّنة كـ **scrypt hash** فقط (`server/password.ts`)، ولا توجد نصاً في أي ملف.
- أي `INSERT` لمستخدم ثانٍ يُرفض، وكذلك حذف المالك أو إيقافه أو سحب دور المطور منه.
- القفل يعمل بالإعداد `security.single_owner` (والتسجيل مغلق `auth.registration_open=false`). تغييره يُسجَّل في `audit_log`.
- لتغيير كلمة السر: `hashPassword('الجديدة')` ثم `UPDATE users SET password_hash=? WHERE email=?`.

## حساب الطوارئ للمطور (D11)
إن حُذف حساب المالك أو أُوقف أو قُفل، يدخل المطور من صفحة تسجيل الدخول العادية ببريد وكلمة سر حساب الطوارئ (الجدول `recovery_accounts`).
- عند النجاح تستعيد `recoverOwner()` في `server/dev.ts` المالك: تعيد تفعيله، أو تنشئه من جديد (وتطلب تغيير كلمة السر) إن اختفى صفّه، وتضمن دوري admin وdeveloper، ثم تُنشئ له جلسة ليوم واحد.
- ليس مستخدماً في جدول `users`، فلا يخالف قفل المالك الوحيد. كلمة سره scrypt hash فقط ولا تظهر نصاً في أي ملف.
- كل دخول به يُسجَّل في `audit_log` (`recovery.login`)، و5 محاولات فاشلة خلال 15 دقيقة تقفله مؤقتاً، ولا يُحذف آخر حساب طوارئ.
- لتغيير كلمته: `UPDATE recovery_accounts SET password_hash=? WHERE email=?` مع `hashPassword('الجديدة')`.

## الخادم وربط الواجهة
`npm start` يشغّل `server/serve.ts` (منفذ 3000): يقدّم ملفات الموقع ويكشف `POST /api/auth/login` و`GET /api/auth/me` و`POST /api/auth/logout`. الجلسة في كوكي `HttpOnly; SameSite=Strict`، والطلبات المغيّرة تُرفض من أي أصل آخر. خلف HTTPS اضبط `NODE_ENV=production`، وخلف وكيل عكسي `TRUST_PROXY=1`.

## ميزات المطور فقط (D01–D11)
تتطلب دور `developer` (صلاحيات `dev.*`)، ولا يُمنح إلا لمن يملك دور admin. دوال `server/dev.ts` تتحقق من ذلك بالبريد.

## الميزات (111) — مأخوذة من جدول `db_features`

### المحتوى
| الرمز | الميزة | الكائن |
|---|---|---|
| F01 | نسخ المشاريع عند كل تعديل | `project_revisions` |
| F02 | الاحتفاظ بآخر 20 نسخة فقط | `trg_project_revision_trim` |
| F03 | تاريخ الروابط القديمة للمشاريع | `project_slug_history` |
| F04 | عرض تحويلات الروابط القديمة | `v_slug_redirects` |
| F05 | أحداث مشاهدة المشروع وعدّاد تلقائي | `project_view_events` |
| F06 | مجموعات المشاريع | `collections` |
| F07 | عناصر المجموعات مع الترتيب | `collection_items` |
| F08 | روابط إضافية للمشروع | `project_links` |
| F09 | وسائط متعددة لكل مشروع | `project_media` |
| F10 | الخط الزمني للمشروع | `project_milestones` |
| F11 | المهارات | `skills` |
| F12 | ربط المشاريع بالمهارات | `project_skills` |
| F13 | الخبرات العملية | `experience` |
| F14 | التعليم | `education` |
| F15 | الشهادات | `certificates` |
| F16 | روابط التواصل الاجتماعي | `social_links` |
| F17 | صفحات ثابتة قابلة للتحرير | `static_pages` |
| F18 | قوائم التنقل | `menu_items` |
| F19 | تحويلات المسارات وعدّاد الزيارات | `redirects` |
| F20 | شريط الإعلانات بفترة زمنية | `announcements` |
| F21 | الإعلانات الفعّالة الآن | `v_active_announcements` |
| F22 | كتل نصوص قابلة لإعادة الاستخدام | `content_blocks` |

### البحث والاكتشاف
| الرمز | الميزة | الكائن |
|---|---|---|
| F23 | بحث نصي كامل في الخدمات | `services_fts` |
| F24 | بحث نصي كامل في الأسئلة الشائعة | `faqs_fts` |
| F25 | سجل عمليات البحث | `search_log` |
| F26 | مرادفات البحث | `search_synonyms` |
| F27 | المشاريع الأكثر شعبية | `v_popular_projects` |
| F28 | المشاريع المتشابهة بالوسوم | `v_related_projects` |
| F29 | استخدام الوسوم | `v_tag_usage` |
| F30 | المشروع كاملاً بالترجمتين والوسوم | `v_project_full` |

### التفاعل والتواصل
| الرمز | الميزة | الكائن |
|---|---|---|
| F31 | تصويت التعليقات ومجموع تلقائي | `comment_votes` |
| F32 | بلاغات التعليقات | `comment_reports` |
| F33 | إخفاء التعليق بعد 3 بلاغات | `trg_comment_autohide` |
| F34 | حد عمق الردود | `trg_comment_depth` |
| F35 | الرد من نفس المشروع فقط | `trg_comment_same_project` |
| F36 | منع التعليقات عند إيقاف الميزة | `trg_comments_enabled` |
| F37 | إشعار المديرين برسالة تواصل | `trg_notify_contact` |
| F38 | إشعار المديرين بتعليق جديد | `trg_notify_comment` |
| F39 | المفضلة | `bookmarks` |
| F40 | أحداث المشاركة | `share_events` |
| F41 | الشهادات المعتمدة للعرض العام | `v_public_testimonials` |
| F42 | الخدمات الفعّالة للعرض العام | `v_public_services` |
| F43 | الأسئلة الشائعة للعرض العام | `v_public_faqs` |
| F44 | لوحة ما ينتظر المراجعة | `v_pending_moderation` |
| F45 | الحملات البريدية | `newsletter_campaigns` |
| F46 | تسليم الحملة لكل مشترك | `campaign_deliveries` |
| F47 | كشف الرسائل المزعجة | `trg_contact_spam` |
| F48 | حد معدل رسائل التواصل | `trg_contact_rate` |
| F49 | ردود الرسائل وتحديث الحالة | `message_replies` |
| F50 | وقت معالجة الرسالة تلقائياً | `trg_contact_handled` |

### الأمان
| الرمز | الميزة | الكائن |
|---|---|---|
| F51 | رفض كلمة سر غير مشفّرة | `trg_pw_hashed_ins` |
| F52 | تاريخ تغيير البريد | `user_email_history` |
| F53 | أسماء مستخدمين محجوزة | `reserved_usernames` |
| F54 | تعبئة deleted_at تلقائياً | `trg_user_deleted_at` |
| F55 | منع دخول حساب غير نشط | `trg_login_active_only` |
| F56 | منع جلسة لحساب غير نشط | `trg_session_active_only` |
| F57 | حد أقصى 10 جلسات نشطة | `trg_session_cap` |
| F58 | كشف إعادة استخدام رمز التجديد | `trg_refresh_reuse` |
| F59 | إنهاء الجلسة ينهي رموزها | `trg_session_revoke_tokens` |
| F60 | حظر IP تلقائي بعد 20 فشل | `trg_ip_autoblock` |
| F61 | رفض محاولات من IP محظور | `trg_ip_blocked` |
| F72 | الدخول الفاشل آخر 24 ساعة | `v_failed_logins_24h` |
| F73 | عناوين IP المشبوهة | `v_suspicious_ips` |
| F74 | مفاتيح API القريبة من الانتهاء | `v_expiring_api_keys` |
| F75 | مديرون بدون مصادقة ثنائية | `v_admins_without_mfa` |
| F76 | جلسات قديمة بلا نشاط | `v_stale_sessions` |

### التدقيق
| الرمز | الميزة | الكائن |
|---|---|---|
| F62 | تدقيق تفعيل المصادقة الثنائية | `trg_audit_mfa` |
| F63 | تدقيق مفاتيح API | `trg_audit_apikey_new` |
| F64 | تدقيق مفاتيح المرور | `trg_audit_passkey_add` |
| F65 | تدقيق ربط الحسابات الاجتماعية | `trg_audit_oauth` |
| F66 | تدقيق تغيير الإعدادات | `trg_audit_settings` |
| F67 | تدقيق حالة المشروع | `trg_audit_project_status` |
| F68 | تدقيق إشراف التعليقات | `trg_audit_comment_status` |
| F69 | تدقيق سحب الأدوار | `trg_audit_role_revoked` |
| F70 | تدقيق تغيير البريد | `trg_audit_email` |
| F71 | آخر 200 حدث تدقيق | `v_audit_recent` |

### التحليلات
| الرمز | الميزة | الكائن |
|---|---|---|
| F77 | نظرة صحة الموقع | `v_site_health` |
| F78 | الزيارات حسب الدولة | `v_traffic_by_country` |
| F79 | الزيارات حسب الجهاز | `v_traffic_by_device` |
| F80 | أهم المصادر المُحيلة | `v_top_referrers` |
| F81 | الزيارات بالساعة | `v_hourly_views` |
| F82 | أكثر الصفحات زيارة 7 أيام | `v_top_pages_7d` |
| F83 | الزيارات الشهرية | `v_monthly_views` |
| F84 | تجميع يومي للزيارات | `daily_stats` |
| F85 | تحديث التجميع تلقائياً | `trg_daily_stats` |
| F86 | تجاهل زيارات الروبوتات | `trg_views_ignore_bots` |
| F87 | فحص مسار الزيارة | `trg_views_path` |

### الخصوصية
| الرمز | الميزة | الكائن |
|---|---|---|
| F88 | سياسات الاحتفاظ بالبيانات | `data_retention_policies` |
| F89 | طلبات تصدير البيانات | `data_export_requests` |
| F90 | طلبات حذف الحساب بمهلة | `account_deletion_requests` |
| F91 | سجل الموافقات | `consent_log` |

### العمليات
| الرمز | الميزة | الكائن |
|---|---|---|
| F92 | أعلام الميزات | `feature_flags` |
| F93 | استثناءات الأعلام للمستخدم | `user_feature_flags` |
| F94 | الويب هوك | `webhooks` |
| F95 | تسليم الويب هوك | `webhook_deliveries` |
| F96 | ويب هوك عند نشر مشروع | `trg_webhook_project_published` |
| F97 | مهام مجدولة | `scheduled_tasks` |
| F98 | إعادة محاولة المهام الفاشلة | `trg_job_retry` |
| F99 | المهام العالقة | `v_stuck_jobs` |
| F100 | قائمة منع البريد | `email_suppressions` |

### المطور فقط
| الرمز | الميزة | الكائن |
|---|---|---|
| D01 | دور المطور وصلاحيات dev.* | `v_developer_access` |
| D02 | سجل أخطاء المطور | `dev_logs` |
| D03 | سجل الاستعلامات البطيئة | `slow_queries` |
| D04 | ملاحظات ومهام المطور | `dev_notes` |
| D05 | سجل النسخ الاحتياطية | `db_snapshots` |
| D06 | إعدادات البيئات بدون أسرار | `env_config` |
| D07 | نظرة على بنية القاعدة | `v_dev_schema` |
| D08 | فحص سلامة القاعدة healthCheck | `fn:healthCheck` |
| D09 | مفتش القاعدة rowCounts/explain | `fn:inspector` |
| D10 | بيانات تجريبية seedDemo | `fn:seedDemo` |
| D11 | حساب طوارئ للمطور يستعيد المالك عند حذفه | `recovery_accounts` |
