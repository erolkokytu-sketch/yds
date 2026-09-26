# Exam Pack Guide

## Sınav paketi nedir?

`.ydspack`, Exam Pack schema v1'e uyan UTF-8 JSON dosyasıdır. Soru metinlerini, seçenekleri,
paylaşılan pasajları, canonical cevap anahtarını, süreyi ve doğrulanmışsa puanlama metadata'sını
içerir. Kullanıcı cevapları, süre, flag'ler, session ID'leri ve sonuç geçmişi pakete dahil değildir.

## `.ydspack` nasıl import edilir?

1. Ana ekranda **Sınav Paketi Ekle** seçilir.
2. En fazla 10 MB boyutunda `.ydspack` dosyası açılır (`.json` development için kabul edilir).
3. Başlık, soru sayısı, süre, dil ve tür preview ekranında kontrol edilir.
4. **Sınavı Ekle** seçilir.

Dosya önce UTF-8/JSON, schema version, JSON Schema ve semantic kurallardan geçer. Tüm paket
geçerliyse tek IndexedDB transaction'ıyla kurulur; hata varsa hiçbir parçası yazılmaz.

## Nasıl export edilir?

Yüklü sınav kartındaki **Sınav Paketini Dışa Aktar** düğmesi canonical Exam Pack'i güvenli bir
`.ydspack` adıyla indirir. Export yalnızca sınav içeriğidir; çalışma ilerlemesi ve sonuçlar için
backup değildir.

## Duplicate ne demek?

Kimlik filename'dan değil `exam.id` alanından belirlenir. Aynı ID ve aynı SHA-256 fingerprint
varsa paket zaten yüklüdür ve ikinci kopya oluşturulmaz. Aynı ID farklı içerikle gelirse güvenlik
için mevcut paket değiştirilmez. Bu sürüm overwrite/replace yapmaz.

## Invalid pack ne demek?

Eksik metadata, eksik seçenek, tekrarlanan soru ID/numarası, geçersiz cevap, kırık referans,
bozuk JSON veya semantic invariant ihlali paketi geçersiz yapar. UI kısa bir hata özeti gösterir;
geliştirme konsolu ayrıntıları içerir. Mevcut sınavlar ve attempt'ler etkilenmez.

## Schema version ne demek?

`schemaVersion`, dosya yapısının sürümüdür. Bu uygulama şu anda yalnızca `1` sürümünü destekler.
Daha yeni/bilinmeyen sürümler tahmin edilmez veya kısmen import edilmez.

CLI doğrulaması:

```bash
npm run validate:exam -- ./my-exam.ydspack
```
