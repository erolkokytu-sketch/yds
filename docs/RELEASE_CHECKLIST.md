# Release Candidate Checklist

| Kontrol | Durum | Not |
|---|---|---|
| Production build | PASS | Vite build temiz |
| Unit/integration tests | PASS | Schema, PDF, UI, PWA |
| Development E2E | PASS | Mobil Chromium |
| Production preview E2E | PASS | Build → preview → tam akış |
| Manifest | PASS | Standalone, start URL, scope, theme |
| Service worker | PASS | Versioned shell cache |
| 192/512 icons | PASS | Normal + maskable |
| Production base path | PASS | `/YDS/` doğrulandı |
| External runtime dependency | PASS | API/CDN/font/analytics yok |
| `.ydspack` file import | PASS | Online ve offline otomasyon |
| IndexedDB persistence | PASS | Update cache temizliği DB'ye dokunmuyor |
| Timer / pause / resume | PASS | Unit + E2E |
| Result / review | PASS | Unit + E2E |
| HTTPS deploy | MANUAL REQUIRED | GitHub Pages ilk deploy |
| Desktop installability UI | MANUAL REQUIRED | Chrome menüsünde doğrula |
| Android install | MANUAL REQUIRED | Fiziksel cihaz |
| Android standalone launch | MANUAL REQUIRED | Ana ekran ikonu |
| Android app close/open restore | MANUAL REQUIRED | OS lifecycle |
| Android offline launch | MANUAL REQUIRED | Uçak modu |
| Safari smoke test | MANUAL REQUIRED | İsteğe bağlı ikincil hedef |

Post-release backlog: full backup/restore. Bu release'e dahil değildir.
