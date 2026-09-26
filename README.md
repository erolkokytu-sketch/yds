# Hızlı Kullanım

## Uygulamayı çalıştırmak

```bash
npm install
npm run dev
```

Telefondan aynı Wi-Fi üzerinden denemek için:

```bash
npm run dev -- --host
```

Terminalde gösterilen LAN adresini telefonda aç. Bu yöntem fonksiyon kontrolü içindir; PWA
kurulum/service worker için önerilen yol HTTPS production adresidir.

## Production build

```bash
npm test
npm run test:e2e
npm run test:e2e:production
npm run build
```

Çıktı `dist/` klasöründedir. Yerel production önizleme:

```bash
npm run preview -- --host
```

## Deploy

Seçilen sağlayıcı GitHub Pages'dir. Gerçek sınav dosyalarını repoya koyma.

1. Bu klasörü bir GitHub repository'sine gönder.
2. Repository **Settings → Pages** altında source olarak **GitHub Actions** seç.
3. `main` branch'e push et veya **Deploy YDS PWA to GitHub Pages** workflow'unu çalıştır.
4. Actions tamamlanınca verilen `https://<kullanıcı>.github.io/<repo>/` adresini aç.

Workflow repository adına göre `VITE_BASE_PATH` ayarlar. Uygulama hash routing kullandığından
static hosting refresh'i 404 üretmez. Başka bir path için:

```bash
VITE_BASE_PATH=/benim-path/ npm run build
```

## Android'e yüklemek

HTTPS production linkini Android Chrome'da aç, tarayıcı menüsündeki **Uygulamayı yükle** veya
**Ana ekrana ekle** seçeneğini kullan. Ayrıntılı adımlar: [Android Install](docs/ANDROID_INSTALL.md).

## Sınav paketi eklemek

Uygulamada **Sınav Paketi Ekle** düğmesine dokun ve telefondaki `.ydspack` dosyasını seç.
Dosya seçme ve import işlemi çevrimdışı çalışır. Gerçek sınav paketleri repository ve deployment
çıktısına dahil edilmez.

## PDF'den sınav paketi oluşturmak

```bash
npm run import:pdf -- imports/exam.pdf --answer-key imports/key.pdf
npm run finalize:exam -- work/<import-id>/prepared-exam.json
```

Önce `work/<import-id>/review.html` dosyasını kontrol et. Ayrıntılar:
[PDF Import Guide](docs/PDF_IMPORT_GUIDE.md).

# YDS Çalışma

Sürüm: `0.1.0`

Yerel-first, installable ve çevrimdışı çalışan kişisel YDS sınav oynatıcısıdır. Production'daki
yerleşik içerik yalnızca açıkça **Örnek Sınav (Sentetik)** olarak etiketlenen özgün test
içeriğidir.

## Gizlilik

Sınavlar ve cevaplar cihazınızda saklanır. Login, backend, analytics, telemetry, cloud sync veya
runtime API çağrısı yoktur. Tarayıcı site verisini silersen yerel sınav ve oturum verileri de
silinir.

## PWA güncelleme modeli

Production build manifest ve versioned service worker üretir. İlk başarılı ziyarette uygulama
shell'i cache'lenir. Yeni deploy geldiğinde yeni worker arka planda kurulur; açık uygulamalar
kapatıldıktan sonra etkinleşir. Eski shell cache'i silinir fakat IndexedDB'deki sınavlar ve
oturumlar değiştirilmez.

## Yapılandırma

```bash
VITE_APP_NAME="YDS Çalışma" \
VITE_APP_SHORT_NAME="YDS Çalışma" \
VITE_BASE_PATH=/YDS/ \
npm run build
```

## Release ve cihaz testi

- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Android Install](docs/ANDROID_INSTALL.md)
- [Exam Pack Guide](docs/EXAM_PACK_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)

Full backup/restore ilk cihaz release'i için kapsam dışıdır ve post-release backlog'dadır.
