# YDS Personal Exam App

## Günlük kullanım

Uygulamayı başlat:

```bash
npm run dev
```

Yerel bir YDS PDF'sini hazırla ve incele:

```bash
npm run import:pdf -- imports/exam.pdf --answer-key imports/key.pdf
```

Komutun yazdığı `work/<import-id>/review.html` dosyasını aç. Hata yoksa paketi üret:

```bash
npm run finalize:exam -- work/<import-id>/prepared-exam.json
```

Üretilen `.ydspack` dosyası `exam-packs/` altındadır ve uygulamanın **Sınav Paketi Ekle**
işlemiyle yüklenebilir. Ayrıntılar için [PDF Import Guide](docs/PDF_IMPORT_GUIDE.md) belgesine bak.

## Geliştirme

```bash
npm test
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

PDF aracı Python 3 ve `pdfplumber` kullanır. Codex runtime dışında ilk kurulum:

```bash
python3 -m pip install -r tools/requirements-pdf.txt
```
