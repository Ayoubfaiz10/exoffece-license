# LexOffece License Server

سيرفر التراخيص + لوحة التحكم لتطبيق LexOffece — مصمم للنشر على **Vercel** (مجاناً، بلا بطاقة بنكية).

## النشر على Vercel (خطوة بخطوة)

### المتطلبات
- حساب GitHub (مجاني)
- حساب Vercel (مجاني) — سجّل عبر GitHub على [vercel.com](https://vercel.com)
- قاعدة بيانات **Neon Postgres مجانية** (لأن Vercel لا يخزن الملفات)

### الخطوة 1: ارفع الكود على GitHub
1. أنشئ مستودع (Repository) جديد **Public** اسمه مثلاً `lexoffece-license`
2. ارفع عبر المتصفح (Uploading an existing file) هذه الملفات:
   - `app.js`، `server.js`، `store.js`، `package.json`، `vercel.json`
   - مجلد `public` (فيه `admin.html`)
   - مجلد `api` (فيه `index.js`)
   - `README.md`

### الخطوة 2: أنشئ قاعدة بيانات Neon (مجانية)
1. ادخل [neon.tech](https://neon.tech) → سجّل بحساب GitHub
2. **Create a project** → اختر المنطقة القريبة منك
3. خذ الـ **Connection String** (يبدأ بـ `postgresql://...`) — انسخه واحفظه

### الخطوة 3: اربط المشروع بـ Vercel
1. [vercel.com](https://vercel.com) → **Add New** → **Project**
2. اربط حساب GitHub → اختر مستودع `lexoffece-license`
3. Vercel سيكتشف `vercel.json` تلقائياً
4. في شاشة الإعدادات أضف **Environment Variables**:
   - `DATABASE_URL` = سلسلة الاتصال من Neon
   - `ADMIN_PASSWORD` = كلمة مرور قوية للوحة التحكم (مثال: `Xk9#mQ2!vLp7`)
   - `MAX_MACHINES` = عدد الأجهزة لكل مفتاح (اختياري، افتراضياً 1)
5. **Deploy** → انتظر 1-2 دقيقة

### الخطوة 4: خذ الرابط
- بعد النشر ستحصل على رابط مثل `https://lexoffece-license.vercel.app`
- لوحة التحكم: `https://lexoffece-license.vercel.app/admin`
- ضع الرابط في `license-client.js` (سطر 7) بدل `http://localhost:4001`

## التشغيل المحلي

```bash
npm install
npm start
```

- API: `http://localhost:4001`
- لوحة التحكم: `http://localhost:4001/admin`
- كلمة المرور الافتراضية: `admin123` (غيّرها عبر متغير `ADMIN_PASSWORD`)

## الـ API

| المسار | الاستعمال |
|---|---|
| `POST /api/activate` | تفعيل مفتاح من التطبيق `{key, machineId}` |
| `POST /api/validate` | تحقق دوري `{key, machineId}` |
| `POST /api/deactivate` | فك الجهاز `{key, machineId}` |
| `POST /api/admin/login` | دخول اللوحة `{password}` |
| `GET /api/admin/licenses` | قائمة التراخيص |
| `POST /api/admin/licenses` | توليد مفاتيح |
| `POST /api/admin/licenses/revoke` | تعطيل/تفعيل |
| `POST /api/admin/licenses/extend` | تمديد |
| `DELETE /api/admin/licenses/:key` | حذف |
| `GET /api/admin/stats` | إحصائيات |

## تخزين البيانات

- **على Vercel**: في قاعدة بيانات Neon (لا تضيع أبداً)
- **محلياً**: في `data/licenses.json`

## حل المشاكل

### 500: FUNCTION_INVOCATION_FAILED
أغلب الظن أن `DATABASE_URL` غير موجود أو خاطئ:
1. تحقق من Vercel → **Project Settings → Environment Variables** — تأكد أن `DATABASE_URL` مضاف في البيئة **Production**
2. بعد إضافة أي متغير يجب إعادة النشر (Redeploy) — المتغيرات الجديدة لا تعمل في النسخة القديمة
3. جرّب الرابط `https://YOUR-APP.vercel.app/health`
4. شاهد الأخطاء المفصلة: Vercel → المشروع → **Logs** (أو **Functions**)

### مفتاح `LX-...` لا يفعّل مع أن السيرفر شغال
تأكد أن الرابط في `license-client.js` (سطر 7) بدون `/` في النهاية، مثل:
```
https://lexoffece-license.vercel.app
```
وليس `https://lexoffece-license.vercel.app/`
