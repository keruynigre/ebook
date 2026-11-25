# Ebook

Web roman sitelerinde okuduğunuz romanları telefonunuza indirip **EPUB** dosyasına çeviren Android uygulaması.

Plan:

1. **İlk sürüm (bu sürüm):** bağlantı → bölüm listesi → bölüm indirme → EPUB oluşturma, paylaşma ve kaydetme
2. **Okuyucu ve hikâye defteri:** uygulama içi okuma, karakter listesi, özetler, sözlük
3. **Görseller:** bölüm başına yaklaşık 15 kare, çizgi roman tarzı ve tutarlı karakterler

## Kurulum (telefondan)

1. GitHub'da bu reponun **Releases** sayfasını açın.
2. En üstteki sürümdeki `ebook-….apk` dosyasını indirin ve açın.
3. Android, tarayıcıya "bilinmeyen uygulamaları yükleme" izni vermenizi ister. İzin verip kurun.

Yeni sürümler eskisinin üstüne kurulur; kitaplığınız silinmez.

## Kullanım

1. Romanın ana sayfasını (bölüm listesinin olduğu sayfayı) tarayıcıda açın ve adresini kopyalayın.
2. Uygulamada **+ Ekle** → **Yapıştır** → **Bul** → **Kitaplığa ekle**.
3. Bölüm aralığını seçin (ör. 1–50) → **İndir**.
4. **EPUB oluştur** → **Paylaş** (okuma uygulamanızı seçin), **Aç** ya da **Klasöre kaydet**.

İndirilen bölümler telefonda saklanır. İndirme yarıda kalırsa tekrar **İndir**'e basın; zaten indirilmiş bölümler atlanır.

### Desteklenen siteler

- **NovelFull** ve aynı temayı kullanan siteler: tam destek
- Diğer siteler: deneysel genel okuyucu

Site bir güvenlik kontrolü ("Just a moment…") gösterirse uygulama kontrolü gizli bir tarayıcıda geçmeye çalışır. Gerekirse sayfayı size gösterir; kutucuğa dokunduğunuzda indirme kendiliğinden devam eder.

Uygulama yalnızca kişisel okuma içindir. Oluşturulan EPUB dosyalarını paylaşmayın. Bölümler siteyi yormamak için birkaç saniye arayla indirilir.

## Geliştirme

Expo (SDK 58) + React Native + TypeScript.

```bash
npm install
npm run typecheck
npm test              # ayrıştırıcı ve EPUB testleri
npx expo start        # geliştirme sunucusu
```

- `src/app/`: ekranlar (Expo Router)
- `src/lib/sources/`: site ayrıştırıcıları (`novelfull.ts`, `generic.ts`)
- `src/lib/epub.ts`: EPUB 3 oluşturucu
- `src/lib/downloads.ts`: bölüm indirme kuyruğu
- `src/components/BrowserHost.tsx`: site doğrulamalarını geçen gizli WebView

`main` dalına yapılan her gönderimde GitHub Actions APK'yı derler ve **Releases** sayfasında yayınlar (`.github/workflows/android.yml`).

APK, Expo şablonundaki sabit hata ayıklama anahtarıyla imzalanır. Böylece her sürüm öncekinin üstüne kurulabilir. Bu anahtar herkese açıktır; uygulama mağazaya konacaksa kendi anahtarınıza geçilmelidir.
