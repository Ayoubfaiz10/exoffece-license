# LexOffece License Server

سيرفر التراخيص + لوحة التحكم لتطبيق LexOffece.

## النشر على Render (بدون GitHub)

1. زور [render.com](https://render.com) → سجل حساب مجاني
2. من [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**
3. **Public repository** → الصق رابط مستودع GitHub (أو ارفع المشروع يدوياً)
4. Render سيقرأ `render.yaml` تلقائياً ويجهز كل شيء
5. أول ما يشتغل، سيطلب منك تحديد `ADMIN_PASSWORD` في إعدادات الخدمة → Environment

## التشغيل المحلي

```bash
cd license-server
npm install
ADMIN_PASSWORD=YOUR_STRONG_PASSWORD npm start
```

- API: `http://localhost:4001`
- لوحة التحكم: `http://localhost:4001/admin`

## التنصيب على Render (مجاني)

1. ارفع مجلد `license-server` كمشروع جديد على [render.com](https://render.com) → **New Web Service**
2. Runtime: **Node**, Build Command: `npm install`, Start Command: `npm start`
3. أضف Environment Variable:
   - `ADMIN_PASSWORD` = كلمة مرور قوية للوحة التحكم (مثال: `Xk9#mQ2!vL`)
   - `MAX_MACHINES` = عدد الأجهزة المسموحة لكل مفتاح (اختياري، افتراضياً 1)
   - `LICENSE_DEFAULT_DAYS` = المدة الافتراضية بالمفاتيح (اختياري، افتراضياً 365)
4. بعد النشر ستحصل على رابط مثل `https://lexoffece-lic.onrender.com`
5. ضع هذا الرابط في التطبيق (ملف `license-client.js` → `LICENSE_SERVER_URL`)

## التنصيب على Railway

1. `railway up` من مجلد `license-server` أو اربطه بمستودع GitHub
2. أضف نفس Environment Variables
3. احصل على الرابط من Railway

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

البيانات تُحفظ في `license-server/data/licenses.json` (أضفه إلى persistent disk في Render/Railway حتى لا تضيع عند إعادة النشر).
