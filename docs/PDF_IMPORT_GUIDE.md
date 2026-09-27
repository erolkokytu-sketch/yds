# Bir YDS PDF'sini uygulamaya ekleme

1. PDF'yi `imports/` klasörüne koy.
2. Hazırlık komutunu çalıştır:

   ```bash
   npm run import:pdf -- imports/exam.pdf --answer-key imports/key.pdf
   ```

3. Komutun gösterdiği `work/<import-id>/review.html` dosyasını tarayıcıda aç. Önce
   **Errors** ve **Warnings** filtrelerini kontrol et.
4. Gerekirse aynı klasördeki `prepared-exam.json` dosyasını düzelt. Doğru cevap asla tahmin
   edilmemeli; bilinmiyorsa `UNKNOWN` kalmalı ve final paket üretilmemelidir.
5. Hata yoksa finalize et:

   ```bash
   npm run finalize:exam -- work/<import-id>/prepared-exam.json
   ```

6. `exam-packs/` altındaki `.ydspack` dosyasını telefona gönder ve uygulamadaki
   **Sınav Paketi Ekle** işlemini kullan.

## Metadata

Basit import güvenli `practice` varsayılanları kullanır. Resmî kimlik veya kesin metadata
tahmin edilmez. Gerektiğinde açıkça ver:

```bash
npm run import:pdf -- imports/exam.pdf \
  --answer-key imports/key.pdf \
  --title "2013 YDS İlkbahar" \
  --id 2013-yds-ilkbahar \
  --year 2013 --term İlkbahar --duration 150 \
  --expected-questions 80 \
  --kind official --publisher ÖSYM \
  --source-url https://example.invalid/questions.pdf \
  --answer-key-url https://example.invalid/answers.pdf \
  --retrieved-at 2026-09-26T00:00:00Z \
  --completeness full --source-verification verified
```

`--official` benzeri bir bypass yoktur. `official` paket mevcut schema'nın provenance
kurallarını aynen geçmek zorundadır.

## Pipeline ve statüler

Araç sırasıyla dosya güvenliği, PDF inceleme, layout-aware text extraction, güvenli
normalization, soru/seçenek/pasaj ayrıştırma, cevap anahtarı eşleme ve review üretimi yapar.
Statüler:

- `READY`: beklenen soru, A-E seçenek ve cevap sayısı tam; heuristic uyarı yok.
- `REVIEW_REQUIRED`: eksik/şüpheli alan var; otomatik final paket yok.
- `OCR_REQUIRED`: sayfaların çoğunda yeterli selectable text yok. Bu faz OCR veya AI
  çalıştırmaz; sadece gerekli durumu bildirir.
- `FAILED`: dosya yok, imza/geçerlilik/boyut sorunu veya parser hatası.

TEXT/MIXED/SCANNED sınıflaması sayfa başına çıkarılabilen karakter miktarına göre
deterministiktir. Her PDF otomatik OCR'a sokulmaz. PDF JavaScript'i, action'ları, linkleri ve
attachment'ları yürütülmez; yalnızca sayfa glyph/text içeriği okunur.

## Çalışma klasörü

Her import kaynak SHA-256 digest'inden türeyen kararlı bir klasör oluşturur:

```text
work/<import-id>/
├── inspection.json
├── layout-debug/            # yalnız --debug ile
├── raw-pages/
├── normalized-pages/
├── removed-margins.json
├── detected-questions.json
├── prepared-exam.json
├── validation-report.json
├── review-sample.json
├── review.html
└── manifest.json
```

`prepared-exam.json`, final Exam Pack'e yakın `examPack` alanını ve yalnızca hazırlık için
`_preparation` metadata'sını taşır. Kaynak sayfalar ve rule-based warning'ler burada tutulur;
final `.ydspack` içine girmez.

## Review ve düzeltme

`review.html` statik ve yereldir. Extract edilen bütün içerik HTML-escape edilir. All/Warnings/
Errors filtreleri, doğru cevap ve kaynak sayfa izini gösterir. Düzeltmeler editable
`prepared-exam.json` üzerinde yapılır.

Warning bulunan bir taslak finalize edilirken bilinçli onay gerekir:

```bash
npm run finalize:exam -- work/<id>/prepared-exam.json --reviewed
```

`--reviewed` eksik soru, seçenek, cevap veya schema hatasını atlatamaz. Sadece insanın
heuristic uyarıları kontrol ettiğini bildirir.

## Finalization güvenlik kapısı

Finalizer hazırlık metadata'sını temizler, cevapların A-E arasında ve eksiksiz olduğunu
kontrol eder, mevcut Phase 2 JSON Schema + semantic validator'ı çalıştırır, canonical SHA-256
fingerprint hesaplar ve ancak bundan sonra `.ydspack` yazar. Başlık output path olamaz; filename
sanitize edilir. Player PDF kaynağına özel hiçbir kod içermez.

## CLI yardımı

```bash
npm run import:pdf -- --help
npm run finalize:exam -- --help
```

Detaylı sayfa karakter sayılarını görmek için import komutuna `--debug` ekle.

## Çok sütunlu sayfalar

Importer her sayfayı kelime koordinatlarından `SINGLE_COLUMN`, `MULTI_COLUMN` veya
`MIXED_LAYOUT` olarak sınıflandırır. Orta bölgede en düşük glyph kesişimi ve dengeli iki
taraf sağlayan gutter deterministik olarak seçilir. Çok sütunlu içerik solda yukarıdan
aşağıya, sonra sağda yukarıdan aşağıya okunur; gutter'ı geçen tam genişlik başlıkları tek
kopya olarak korunur. Yan yana basılan A–E işaretleri ayrı yapısal satırlara çevrilir.

`review-sample.json` ilk üç, sütun sınırındaki üç, sayfa sınırındaki üç, bir pasaj sorusu ve
son üç soruyu kaynak sayfa/cevap iziyle toplar. `_preparation.errors` içindeki kritik
extraction hataları `--reviewed` ile dahi geçersiz kılınamaz.
