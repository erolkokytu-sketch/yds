# Android'e yükleme

1. Sana gönderilen uygulama linkini Android telefonda Chrome ile aç.
2. Sayfa ilk kez tamamen açıldıktan sonra Chrome menüsünü aç.
3. Tarayıcı sürümüne göre **Uygulamayı yükle** veya **Ana ekrana ekle** seçeneğini kullan.
4. Ana ekrandaki **YDS Çalışma** ikonunu aç.
5. **Sınav Paketi Ekle** düğmesine dokun.
6. WhatsApp'tan indirdiğin `.ydspack` dosyasını Dosyalar/İndirilenler içinden seç.
7. Önizlemeyi kontrol et, **Sınavı Ekle** ve ardından **Sınava Git** seç.

Kurulum seçeneği görünmüyorsa sayfayı bir kez yenile, birkaç saniye bekle ve menüyü tekrar
kontrol et. Asıl kurulum testi HTTPS production linkinde yapılmalıdır; yerel ağdaki HTTP adresi
Android'de service worker/PWA kurulumu için güvenli origin sayılmayabilir.

## Çevrimdışı kontrol

Uygulamayı ve bir sınav paketini önce online aç. Uygulamayı kapat, uçak modunu aç ve ana ekran
ikonundan tekrar başlat. Kütüphane, sınav, süre, duraklat/devam, sonuç ve review çalışmalıdır.

Uygulama hesap açmaz ve veri yüklemez. Sınavlar, cevaplar ve oturumlar yalnızca cihazın
IndexedDB alanında saklanır. Tarayıcı/site verisini silmek bu verileri de siler.
